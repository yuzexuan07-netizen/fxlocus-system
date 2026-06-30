"use client";

import React from "react";

type ClientDateTimeProps = {
  value?: string | number | Date | null;
  locale?: string;
  fallback?: string;
  className?: string;
  format?: "date" | "datetime";
  formatter?: (date: Date, locale?: string) => string;
};

function parseClientDateValue(value: string | number | Date) {
  if (value instanceof Date) return value;

  if (typeof value === "number") {
    // Heuristic: 10-digit timestamps are seconds; 13-digit are milliseconds.
    const ms = Math.abs(value) < 1e12 ? value * 1000 : value;
    return new Date(ms);
  }

  const raw = String(value || "").trim();
  if (!raw) return new Date(NaN);

  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    const numeric = Number(raw);
    const ms = Math.abs(numeric) < 1e12 ? numeric * 1000 : numeric;
    return new Date(ms);
  }

  // SQLite CURRENT_TIMESTAMP format: "YYYY-MM-DD HH:MM:SS[.sss]" (UTC).
  const sqliteLike = raw.match(
    /^(\d{4}-\d{2}-\d{2})[ ](\d{2}:\d{2}:\d{2})(\.\d{1,6})?$/
  );
  if (sqliteLike) {
    const iso = `${sqliteLike[1]}T${sqliteLike[2]}${sqliteLike[3] || ""}Z`;
    return new Date(iso);
  }

  // ISO-like string without timezone suffix; treat as UTC for consistency.
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw) && !/[zZ]|[+\-]\d{2}:?\d{2}$/.test(raw)) {
    return new Date(`${raw}Z`);
  }

  return new Date(raw);
}

export function ClientDateTime({
  value,
  locale,
  fallback = "",
  className,
  format = "datetime",
  formatter
}: ClientDateTimeProps) {
  const hasValue = value !== null && value !== undefined && value !== "";
  const [text, setText] = React.useState(hasValue ? "" : fallback);

  React.useEffect(() => {
    if (!hasValue) {
      setText(fallback);
      return;
    }
    const date = parseClientDateValue(value as string | number | Date);
    if (Number.isNaN(date.getTime())) {
      setText(fallback);
      return;
    }
    const next = formatter
      ? formatter(date, locale)
      : format === "date"
        ? date.toLocaleDateString(locale)
        : date.toLocaleString(locale);
    setText(next);
  }, [fallback, format, formatter, hasValue, locale, value]);

  if (!hasValue) {
    return fallback ? <span className={className}>{fallback}</span> : null;
  }

  return (
    <span className={className} suppressHydrationWarning>
      {text}
    </span>
  );
}
