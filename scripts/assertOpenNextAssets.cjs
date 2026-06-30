"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const nextServerAppDir = path.join(root, ".next", "server", "app");
const openNextAssetsDir = path.join(root, ".open-next", "assets");

function walkHtmlFiles(dir, collector) {
  if (!fs.existsSync(dir)) return;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkHtmlFiles(absolutePath, collector);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".html")) {
      collector.push(absolutePath);
    }
  }
}

const htmlCandidates = [];
walkHtmlFiles(nextServerAppDir, htmlCandidates);

function readAssetsFromHtml(html) {
  const pattern = /(?:src|href)="(\/_next\/static\/[^"]+\.(?:js|css))"/g;
  const assets = new Set();
  for (const match of html.matchAll(pattern)) {
    const ref = match[1];
    if (ref) assets.add(ref);
  }
  return [...assets];
}

if (!htmlCandidates.length) {
  console.log("[assertOpenNextAssets] no app HTML files emitted; skipping static asset reference check.");
  process.exit(0);
}

if (!fs.existsSync(openNextAssetsDir)) {
  console.error("[assertOpenNextAssets] missing .open-next/assets");
  process.exit(1);
}

const refs = new Set();
for (const htmlPath of htmlCandidates) {
  const html = fs.readFileSync(htmlPath, "utf8");
  for (const ref of readAssetsFromHtml(html)) refs.add(ref);
}

const missing = [];
for (const ref of refs) {
  const local = path.join(openNextAssetsDir, ref.replace(/^\//, ""));
  if (!fs.existsSync(local)) missing.push(ref);
}

if (missing.length) {
  console.error(`[assertOpenNextAssets] missing ${missing.length} static asset(s):`);
  for (const ref of missing) console.error(`  - ${ref}`);
  process.exit(1);
}

console.log(`[assertOpenNextAssets] verified ${refs.size} static asset(s).`);
