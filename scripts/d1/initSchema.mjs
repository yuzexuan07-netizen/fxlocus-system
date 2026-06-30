import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const rawArgs = process.argv.slice(2);
const target = rawArgs.includes("--local") ? "--local" : "--remote";
const dbName = readArgValue("--db") || process.env.D1_NAME || "fxlocus-system";
const schemaPath = path.join(root, "d1", "schema.sql");
const migrationsDir = path.join(root, "d1", "migrations");
const isWindows = process.platform === "win32";

function readArgValue(name) {
  const inline = rawArgs.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1).trim();
  const index = rawArgs.indexOf(name);
  if (index >= 0) return rawArgs[index + 1]?.trim() || "";
  return "";
}

function sqlQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function runWrangler(args) {
  let normalizedArgs = [...args];
  const isD1Execute =
    normalizedArgs[0] === "wrangler" &&
    normalizedArgs[1] === "d1" &&
    normalizedArgs[2] === "execute";
  if (isD1Execute && !normalizedArgs.includes("--yes")) normalizedArgs = [...normalizedArgs, "--yes"];

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

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw new Error(`Failed to execute wrangler: ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function checksumFile(filePath) {
  const content = readFileSync(filePath, "utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function stampCurrentMigrations() {
  if (!existsSync(migrationsDir)) return;
  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  if (!files.length) return;

  runWrangler([
    "wrangler",
    "d1",
    "execute",
    dbName,
    target,
    "--command",
    "create table if not exists schema_migrations (version text primary key, name text not null, checksum text not null, applied_at text not null default (CURRENT_TIMESTAMP))"
  ]);

  for (const file of files) {
    const version = path.basename(file, ".sql");
    const checksum = checksumFile(path.join(migrationsDir, file));
    runWrangler([
      "wrangler",
      "d1",
      "execute",
      dbName,
      target,
      "--command",
      [
        "insert into schema_migrations (version, name, checksum, applied_at)",
        `values (${sqlQuote(version)}, ${sqlQuote(file)}, ${sqlQuote(checksum)}, CURRENT_TIMESTAMP)`,
        "on conflict(version) do update set checksum = excluded.checksum, applied_at = schema_migrations.applied_at"
      ].join(" ")
    ]);
  }
}

function main() {
  if (!existsSync(schemaPath)) throw new Error(`Missing schema file: ${schemaPath}`);
  console.log(`[d1:init] Target DB: ${dbName} (${target.replace("--", "")})`);
  runWrangler(["wrangler", "d1", "execute", dbName, target, "--file", schemaPath]);
  stampCurrentMigrations();
  console.log("[d1:init] Database schema is ready.");
}

main();
