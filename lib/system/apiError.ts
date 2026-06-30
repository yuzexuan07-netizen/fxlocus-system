export type SystemApiError = {
  code: string;
  status: number;
};

const AUTH_CODES = new Set(["UNAUTHORIZED", "FORBIDDEN", "FROZEN"]);

function extractCode(error: unknown) {
  const rawCode = String((error as any)?.code || "").trim().toUpperCase();
  if (AUTH_CODES.has(rawCode)) return rawCode;

  const rawMessage = String((error as any)?.message || "").trim().toUpperCase();
  if (AUTH_CODES.has(rawMessage)) return rawMessage;
  return null;
}

function isDbBusy(error: unknown) {
  const text = `${String((error as any)?.code || "")} ${String((error as any)?.message || "")}`.toLowerCase();
  return (
    text.includes("sqlite_busy") ||
    text.includes("database is locked") ||
    text.includes("database is busy")
  );
}

function isDbError(error: unknown) {
  const text = `${String((error as any)?.code || "")} ${String((error as any)?.message || "")}`.toLowerCase();
  return (
    text.includes("sqlite_error") ||
    text.includes("no such table") ||
    text.includes("no such column") ||
    text.includes("syntax error") ||
    text.includes("constraint failed")
  );
}

export function mapSystemApiError(error: unknown, fallbackCode = "INTERNAL_ERROR"): SystemApiError {
  const code = extractCode(error);
  if (code === "UNAUTHORIZED") return { code, status: 401 };
  if (code === "FORBIDDEN" || code === "FROZEN") return { code, status: 403 };
  if (isDbBusy(error)) return { code: "DB_BUSY", status: 503 };
  if (isDbError(error)) return { code: "DB_ERROR", status: 500 };
  return { code: fallbackCode, status: 500 };
}

