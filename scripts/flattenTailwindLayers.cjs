"use strict";

const fs = require("node:fs");
const path = require("node:path");
const postcss = require("postcss");

const root = process.cwd();
const cssDir = path.join(root, ".next", "static", "css");

function walkFiles(dir, collector) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(absolutePath, collector);
      continue;
    }
    if (entry.isFile() && absolutePath.endsWith(".css")) collector.push(absolutePath);
  }
}

function unwrapLayerRules(rootNode) {
  rootNode.walkAtRules("layer", (atRule) => {
    if (!atRule.nodes || !atRule.nodes.length) {
      atRule.remove();
      return;
    }

    const clones = atRule.nodes.map((node) => node.clone());
    atRule.replaceWith(...clones);
  });
}

if (!fs.existsSync(cssDir)) {
  console.log("[flattenTailwindLayers] skip: .next/static/css not found");
  process.exit(0);
}

const files = [];
walkFiles(cssDir, files);

let changedCount = 0;
for (const filePath of files) {
  const original = fs.readFileSync(filePath, "utf8");
  if (!original.includes("@layer")) continue;

  const rootNode = postcss.parse(original, { from: filePath });
  unwrapLayerRules(rootNode);

  const next = rootNode.toResult({ map: false }).css;
  if (next !== original) {
    fs.writeFileSync(filePath, next);
    changedCount += 1;
  }
}

console.log(`[flattenTailwindLayers] updated ${changedCount} CSS file(s).`);
