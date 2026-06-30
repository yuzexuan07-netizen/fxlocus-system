"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const staticAssetsDir = path.join(root, ".open-next", "assets", "_next", "static");

function walkFiles(dir, collector) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(absolutePath, collector);
      continue;
    }
    if (entry.isFile()) collector.push(absolutePath);
  }
}

function encodeSegment(segment) {
  if (!segment.includes("[") && !segment.includes("]")) return segment;
  return segment.replace(/\[/g, "%5B").replace(/\]/g, "%5D");
}

if (!fs.existsSync(staticAssetsDir)) {
  console.log("[normalizeOpenNextAssetPaths] skip: .open-next/assets/_next/static not found");
  process.exit(0);
}

const files = [];
walkFiles(staticAssetsDir, files);

let createdAliases = 0;
for (const filePath of files) {
  const relativePath = path.relative(staticAssetsDir, filePath);
  const segments = relativePath.split(path.sep);
  const encodedRelativePath = segments.map(encodeSegment).join(path.sep);

  if (encodedRelativePath === relativePath) continue;

  const encodedFilePath = path.join(staticAssetsDir, encodedRelativePath);
  if (fs.existsSync(encodedFilePath)) continue;

  fs.mkdirSync(path.dirname(encodedFilePath), { recursive: true });
  fs.copyFileSync(filePath, encodedFilePath);
  createdAliases += 1;
}

console.log(`[normalizeOpenNextAssetPaths] created ${createdAliases} encoded alias file(s).`);
