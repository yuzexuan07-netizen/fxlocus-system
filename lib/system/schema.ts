export function getSchemaErrorMessage(error: unknown) {
  return String((error as { message?: unknown } | null)?.message || "").trim();
}

export function isMissingSchemaError(error: unknown) {
  const message = getSchemaErrorMessage(error).toLowerCase();
  if (!message) return false;
  return (
    message.includes("no such table") ||
    message.includes("no such column") ||
    message.includes("has no column named")
  );
}

export function toSchemaWarning(error: unknown) {
  const message = getSchemaErrorMessage(error);
  if (!message) return "SCHEMA_MISMATCH";
  return `SCHEMA_MISMATCH:${message}`;
}

