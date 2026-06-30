"use client";

import React from "react";

type SystemLoadingScreenProps = {
  locale?: "zh" | "en";
  label?: string;
};

const BRAND_TEXT = {
  zh: "系统",
  en: "System"
};

const DEFAULT_LABEL = {
  zh: "加载中...",
  en: "Loading..."
};

export function SystemLoadingScreen({ locale = "zh", label }: SystemLoadingScreenProps) {
  const brand = BRAND_TEXT[locale] || BRAND_TEXT.zh;
  const status = label || DEFAULT_LABEL[locale] || DEFAULT_LABEL.zh;

  return (
    <div className="system-loading-screen" role="status" aria-live="polite" aria-busy="true">
      <div className="system-loading-card">
        <div className="system-loading-logo" aria-hidden="true">
          <span>{locale === "zh" ? "系" : "S"}</span>
        </div>
        <div className="system-loading-brand">{brand}</div>
        <div className="system-loading-status">{status}</div>
        <div className="system-loading-bar" aria-hidden="true">
          <span />
        </div>
      </div>
    </div>
  );
}
