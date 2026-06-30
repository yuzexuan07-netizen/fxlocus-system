export const SYSTEM_REALTIME_EVENT = "system:realtime";

export type SidebarPendingKey =
  | "courseAccess"
  | "fileAccess"
  | "tradeLogs"
  | "tradeStrategies"
  | "classicTrades"
  | "weeklySummaries"
  | "weeklySummariesStudent"
  | "weeklySummariesAssistant"
  | "weeklySummariesLeader"
  | "courseSummaries"
  | "ladderRequests"
  | "studentDocuments"
  | "enrollments"
  | "contacts"
  | "donations";

export type SidebarDelta = {
  unread?: number;
  consultUnread?: number;
  pending?: Partial<Record<SidebarPendingKey, number>>;
  holdMs?: number;
};

export type SystemRealtimeDetail = {
  table?: string;
  action?: string;
  ts?: number;
  sidebarDelta?: SidebarDelta;
};

export function dispatchSystemRealtime(detail?: SystemRealtimeDetail) {
  if (typeof window === "undefined") return;
  const payload: SystemRealtimeDetail = { ts: Date.now(), ...detail };
  window.dispatchEvent(new CustomEvent(SYSTEM_REALTIME_EVENT, { detail: payload }));
}

export function dispatchSidebarDelta(delta: SidebarDelta, action = "delta") {
  if (typeof window === "undefined") return;
  const hasPending =
    delta.pending && typeof delta.pending === "object" && Object.keys(delta.pending).length > 0;
  const hasUnread = Number(delta.unread || 0) !== 0;
  const hasConsultUnread = Number(delta.consultUnread || 0) !== 0;
  if (!hasPending && !hasUnread && !hasConsultUnread) return;
  dispatchSystemRealtime({
    table: "sidebar_counts",
    action,
    sidebarDelta: delta
  });
}

export function dispatchPendingDelta(
  pending: Partial<Record<SidebarPendingKey, number>>,
  holdMs = 1_200,
  action = "pending_delta"
) {
  dispatchSidebarDelta({ pending, holdMs }, action);
}
