import { randomBytes } from "crypto";

// Match D1 default id style: lower(hex(randomblob(16))).
export function createD1TextId() {
  return randomBytes(16).toString("hex");
}
