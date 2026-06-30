"use strict";

const fs = require("node:fs");
const path = require("node:path");

const targets = [".next", ".open-next"];

for (const relativeTarget of targets) {
  const absoluteTarget = path.join(process.cwd(), relativeTarget);
  fs.rmSync(absoluteTarget, { recursive: true, force: true });
}
