import "server-only";

type GlobalCacheStore = {
  __fx_sidebar_counts_cache?: Map<string, unknown>;
  __fx_sidebar_counts_inflight?: Map<string, unknown>;
  __fx_pending_counts_cache?: Map<string, unknown>;
  __fx_pending_counts_inflight?: Map<string, unknown>;
  __fx_admin_course_requests_cache?: Map<string, unknown>;
  __fx_admin_course_requests_inflight?: Map<string, unknown>;
  __fx_admin_file_requests_cache?: Map<string, unknown>;
  __fx_admin_file_requests_inflight?: Map<string, unknown>;
  __fx_admin_trade_submissions_cache?: Map<string, unknown>;
  __fx_admin_trade_submissions_inflight?: Map<string, unknown>;
  __fx_admin_weekly_summaries_cache?: Map<string, unknown>;
  __fx_admin_weekly_summaries_inflight?: Map<string, unknown>;
  __fx_admin_student_documents_cache?: Map<string, unknown>;
  __fx_admin_student_documents_inflight?: Map<string, unknown>;
  __fx_admin_course_notes_cache?: Map<string, unknown>;
  __fx_admin_course_notes_inflight?: Map<string, unknown>;
  __fx_admin_records_list_cache?: Map<string, unknown>;
  __fx_admin_records_list_inflight?: Map<string, unknown>;
  __fx_consult_recipients_cache?: Map<string, unknown>;
  __fx_consult_recipients_inflight?: Map<string, unknown>;
  __fx_consult_allowed_cache?: Map<string, unknown>;
  __fx_consult_allowed_inflight?: Map<string, unknown>;
  __fx_consult_recipients_route_cache?: Map<string, unknown>;
  __fx_consult_recipients_route_inflight?: Map<string, unknown>;
  __fx_consult_unread_count_cache?: Map<string, unknown>;
  __fx_consult_unread_count_inflight?: Map<string, unknown>;
  __fx_consult_unread_by_peer_cache?: Map<string, unknown>;
  __fx_consult_unread_by_peer_inflight?: Map<string, unknown>;
};

function clearMap(map?: Map<string, unknown>) {
  map?.clear();
}

function g() {
  return globalThis as GlobalCacheStore;
}

export function invalidateSidebarCountsCache() {
  const global = g();
  clearMap(global.__fx_sidebar_counts_cache);
  clearMap(global.__fx_sidebar_counts_inflight);
  clearMap(global.__fx_pending_counts_cache);
  clearMap(global.__fx_pending_counts_inflight);
}

export function invalidateCourseRequestsCache() {
  const global = g();
  clearMap(global.__fx_admin_course_requests_cache);
  clearMap(global.__fx_admin_course_requests_inflight);
}

export function invalidateFileRequestsCache() {
  const global = g();
  clearMap(global.__fx_admin_file_requests_cache);
  clearMap(global.__fx_admin_file_requests_inflight);
}

export function invalidateTradeSubmissionsCache() {
  const global = g();
  clearMap(global.__fx_admin_trade_submissions_cache);
  clearMap(global.__fx_admin_trade_submissions_inflight);
}

export function invalidateWeeklySummariesCache() {
  const global = g();
  clearMap(global.__fx_admin_weekly_summaries_cache);
  clearMap(global.__fx_admin_weekly_summaries_inflight);
}

export function invalidateStudentDocumentsCache() {
  const global = g();
  clearMap(global.__fx_admin_student_documents_cache);
  clearMap(global.__fx_admin_student_documents_inflight);
}

export function invalidateCourseNotesCache() {
  const global = g();
  clearMap(global.__fx_admin_course_notes_cache);
  clearMap(global.__fx_admin_course_notes_inflight);
}

export function invalidateAdminRecordsCache() {
  const global = g();
  clearMap(global.__fx_admin_records_list_cache);
  clearMap(global.__fx_admin_records_list_inflight);
}

export function invalidateConsultCache() {
  const global = g();
  clearMap(global.__fx_consult_recipients_cache);
  clearMap(global.__fx_consult_recipients_inflight);
  clearMap(global.__fx_consult_allowed_cache);
  clearMap(global.__fx_consult_allowed_inflight);
  clearMap(global.__fx_consult_recipients_route_cache);
  clearMap(global.__fx_consult_recipients_route_inflight);
  clearMap(global.__fx_consult_unread_count_cache);
  clearMap(global.__fx_consult_unread_count_inflight);
  clearMap(global.__fx_consult_unread_by_peer_cache);
  clearMap(global.__fx_consult_unread_by_peer_inflight);
  invalidateSidebarCountsCache();
}
