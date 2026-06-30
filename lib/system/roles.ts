export type SystemRole = "student" | "trader" | "coach" | "assistant" | "leader" | "super_admin";

const ROLE_ALIASES: Record<string, SystemRole> = {
  student: "student",
  trader: "trader",
  coach: "coach",
  assistant: "assistant",
  leader: "leader",
  "team_leader": "leader",
  "teamleader": "leader",
  super_admin: "super_admin",
  superadmin: "super_admin",
  "\u5b66\u5458": "student",
  "\u4ea4\u6613\u5458": "trader",
  "\u6559\u7ec3": "coach",
  "\u52a9\u6559": "assistant",
  "\u56e2\u961f\u957f": "leader",
  "\u8d85\u7ba1": "super_admin"
};

export function normalizeSystemRole(input: unknown): SystemRole | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  return ROLE_ALIASES[raw] || ROLE_ALIASES[lower] || null;
}

export function isAdminRole(role: SystemRole) {
  return role === "leader" || role === "super_admin";
}

export function isSuperAdmin(role: SystemRole) {
  return role === "super_admin";
}

export function isLearnerRole(role: SystemRole) {
  return role === "student" || role === "trader" || role === "coach" || role === "assistant";
}
