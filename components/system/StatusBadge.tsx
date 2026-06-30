import React from "react";

export function StatusBadge({
  value,
  locale
}: {
  value: string;
  locale: "zh" | "en";
}) {
  const label =
    locale === "zh"
      ? ({
          requested: "已申请",
          approved: "已通过",
          rejected: "已拒绝",
          completed: "已完成",
          active: "正常",
          frozen: "冻结"
        } as Record<string, string>)[value] || value
      : ({
          requested: "Requested",
          approved: "Approved",
          rejected: "Rejected",
          completed: "Completed",
          active: "Active",
          frozen: "Frozen"
        } as Record<string, string>)[value] || value;

  const cls =
    value === "approved" || value === "active"
      ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100"
      : value === "rejected" || value === "frozen"
        ? "border-rose-400/20 bg-rose-500/10 text-rose-100"
        : value === "requested"
          ? "border-amber-300/20 bg-amber-500/10 text-amber-100"
          : "border-white/10 bg-white/5 text-white/80";

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs ${cls}`}>
      {label}
    </span>
  );
}

