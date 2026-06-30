import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const dbName = String(process.env.D1_NAME || "fxlocus-system").trim();
const migrationsDir = path.join(root, "d1", "migrations");
const rawArgs = process.argv.slice(2);
const target = rawArgs.includes("--local") ? "--local" : "--remote";
const passthrough = rawArgs.filter((arg) => arg !== "--local" && arg !== "--remote");
const isWindows = process.platform === "win32";

function sqlQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function checksumFile(filePath) {
  const content = readFileSync(filePath, "utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function runWrangler(args, expectJson = false) {
  let normalizedArgs = [...args];
  const isD1Execute =
    normalizedArgs[0] === "wrangler" &&
    normalizedArgs[1] === "d1" &&
    normalizedArgs[2] === "execute";
  if (isD1Execute && !normalizedArgs.includes("--yes")) {
    normalizedArgs = [...normalizedArgs, "--yes"];
  }
  if (isD1Execute && !normalizedArgs.includes("--json")) {
    normalizedArgs = [...normalizedArgs, "--json"];
  }
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

  if (result.error) {
    throw new Error(`Failed to execute wrangler: ${result.error.message}`);
  }
  if (!expectJson) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }
  if (result.status !== 0) {
    if (expectJson) {
      throw new Error(
        `Wrangler failed (exit ${result.status}): ${(result.stderr || result.stdout || "").trim()}`
      );
    }
    process.exit(result.status ?? 1);
  }

  if (!expectJson) return null;
  const stdout = String(result.stdout || "").trim();
  if (!stdout) return [];
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Failed to parse wrangler JSON output: ${error?.message || error}\n${stdout}`);
  }
}

function flattenRows(jsonPayload) {
  const statements = Array.isArray(jsonPayload) ? jsonPayload : [jsonPayload];
  const rows = [];
  for (const statement of statements) {
    if (!statement) continue;
    const statementRows = Array.isArray(statement.results) ? statement.results : [];
    rows.push(...statementRows);
  }
  return rows;
}

function ensureMigrationTable() {
  runWrangler(
    [
      "wrangler",
      "d1",
      "execute",
      dbName,
      target,
      "--command",
      "create table if not exists schema_migrations (version text primary key, name text not null, checksum text not null, applied_at text not null default (CURRENT_TIMESTAMP))",
      ...passthrough
    ],
    false
  );
}

function fetchAppliedMigrations() {
  const payload = runWrangler(
    [
      "wrangler",
      "d1",
      "execute",
      dbName,
      target,
      "--command",
      "select version, checksum from schema_migrations order by version asc",
      "--json",
      ...passthrough
    ],
    true
  );
  const rows = flattenRows(payload);
  const out = new Map();
  for (const row of rows) {
    const version = String(row?.version || "").trim();
    if (!version) continue;
    out.set(version, {
      version,
      checksum: String(row?.checksum || "").trim()
    });
  }
  return out;
}

function insertAppliedMigration(version, name, checksum) {
  const sql = [
    "insert into schema_migrations (version, name, checksum, applied_at)",
    `values (${sqlQuote(version)}, ${sqlQuote(name)}, ${sqlQuote(checksum)}, CURRENT_TIMESTAMP)`
  ].join(" ");
  runWrangler(
    [
      "wrangler",
      "d1",
      "execute",
      dbName,
      target,
      "--command",
      sql,
      ...passthrough
    ],
    false
  );
}

function main() {
  if (!existsSync(migrationsDir)) {
    throw new Error(`Missing migrations directory: ${migrationsDir}`);
  }

  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  if (!files.length) {
    console.log("[d1:migrate] No migration files found, skipping.");
    return;
  }

  console.log(`[d1:migrate] Target DB: ${dbName} (${target.replace("--", "")})`);
  ensureMigrationTable();
  const applied = fetchAppliedMigrations();

  for (const file of files) {
    const version = path.basename(file, ".sql");
    const name = file;
    const filePath = path.join(migrationsDir, file);
    const checksum = checksumFile(filePath);
    const exists = applied.get(version);
    if (exists) {
      if (exists.checksum && exists.checksum !== checksum) {
        throw new Error(
          `[d1:migrate] Checksum mismatch for ${version}. Applied=${exists.checksum}, Current=${checksum}`
        );
      }
      console.log(`[d1:migrate] Skip ${version} (already applied).`);
      continue;
    }

    console.log(`[d1:migrate] Apply ${version} ...`);
    runWrangler(
      [
        "wrangler",
        "d1",
        "execute",
        dbName,
        target,
        "--file",
        filePath,
        ...passthrough
      ],
      false
    );
    insertAppliedMigration(version, name, checksum);
    console.log(`[d1:migrate] Applied ${version}.`);
  }

  console.log("[d1:migrate] Done.");
}

main();
