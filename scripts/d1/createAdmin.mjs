import { randomUUID } from "node:crypto";
import path from "node:path";
import { spawnSync } from "node:child_process";
import bcrypt from "bcryptjs";

const root = process.cwd();
const rawArgs = process.argv.slice(2);
const target = rawArgs.includes("--local") ? "--local" : "--remote";
const dbName = readArgValue("--db") || process.env.D1_NAME || "fxlocus-system";
const email = normalizeEmail(readArgValue("--email") || process.env.ADMIN_EMAIL || "");
const password = readArgValue("--password") || process.env.ADMIN_PASSWORD || "";
const fullName = (readArgValue("--name") || process.env.ADMIN_NAME || "System Admin").trim();
const isWindows = process.platform === "win32";
const NORMAL_STUDENT_STATUS = "\u666e\u901a\u5b66\u5458";

function readArgValue(name) {
  const inline = rawArgs.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1).trim();
  const index = rawArgs.indexOf(name);
  if (index >= 0) return rawArgs[index + 1]?.trim() || "";
  return "";
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function sqlQuote(value) {
  if (value === null) return "null";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function runWrangler(args, expectJson = false) {
  let normalizedArgs = [...args];
  const isD1Execute =
    normalizedArgs[0] === "wrangler" &&
    normalizedArgs[1] === "d1" &&
    normalizedArgs[2] === "execute";
  if (isD1Execute && !normalizedArgs.includes("--yes")) normalizedArgs = [...normalizedArgs, "--yes"];
  if (isD1Execute && expectJson && !normalizedArgs.includes("--json")) normalizedArgs = [...normalizedArgs, "--json"];

  const cmd = isWindows ? process.execPath : "npx";
  const cmdArgs = isWindows
    ? [
        path.join(root, "node_modules", "wrangler", "bin", "wrangler.js"),
        ...normalizedArgs.filter((arg, index) => !(index === 0 && arg === "wrangler"))
      ]
    : normalizedArgs;
  const result = spawnSync(cmd, cmdArgs, {
    encoding: "utf8",
    stdio: "pipe"
  });

  if (!expectJson) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }
  if (result.error) throw new Error(`Failed to execute wrangler: ${result.error.message}`);
  if (result.status !== 0) {
    const output = (result.stderr || result.stdout || "").trim();
    throw new Error(`Wrangler failed: ${output}`);
  }
  if (!expectJson) return null;
  const stdout = String(result.stdout || "").trim();
  return stdout ? JSON.parse(stdout) : [];
}

function flattenRows(jsonPayload) {
  const statements = Array.isArray(jsonPayload) ? jsonPayload : [jsonPayload];
  const rows = [];
  for (const statement of statements) {
    if (Array.isArray(statement?.results)) rows.push(...statement.results);
  }
  return rows;
}

async function main() {
  if (!email || !email.includes("@")) {
    throw new Error("Missing admin email. Use --email=admin@example.com or set ADMIN_EMAIL.");
  }
  if (password.length < 8) {
    throw new Error("Missing admin password, or password is shorter than 8 characters. Use --password=...");
  }

  const fallbackId = randomUUID();
  const passwordHash = await bcrypt.hash(password, 6);
  console.log(`[d1:create-admin] Target DB: ${dbName} (${target.replace("--", "")})`);

  runWrangler([
    "wrangler",
    "d1",
    "execute",
    dbName,
    target,
    "--command",
    [
      "insert into profiles (id, email, full_name, role, student_status, status, created_at, updated_at)",
      `values (${sqlQuote(fallbackId)}, ${sqlQuote(email)}, ${sqlQuote(fullName)}, 'super_admin', ${sqlQuote(
        NORMAL_STUDENT_STATUS
      )}, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      "on conflict(email) do update set full_name = excluded.full_name, role = 'super_admin', status = 'active', updated_at = CURRENT_TIMESTAMP"
    ].join(" ")
  ]);

  const profileRows = flattenRows(
    runWrangler(
      [
        "wrangler",
        "d1",
        "execute",
        dbName,
        target,
        "--command",
        `select id from profiles where lower(email) = lower(${sqlQuote(email)}) limit 1`
      ],
      true
    )
  );
  const userId = String(profileRows[0]?.id || "").trim();
  if (!userId) throw new Error("Failed to find the admin profile after upsert.");

  runWrangler([
    "wrangler",
    "d1",
    "execute",
    dbName,
    target,
    "--command",
    [
      "insert into local_auth_users (user_id, email, password_hash, password_updated_at, created_at, updated_at)",
      `values (${sqlQuote(userId)}, ${sqlQuote(email)}, ${sqlQuote(
        passwordHash
      )}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      "on conflict(user_id) do update set email = excluded.email, password_hash = excluded.password_hash, password_updated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP"
    ].join(" ")
  ]);

  console.log(`[d1:create-admin] Super admin is ready: ${email}`);
}

main().catch((error) => {
  console.error(`[d1:create-admin] ${error?.message || error}`);
  process.exit(1);
});
