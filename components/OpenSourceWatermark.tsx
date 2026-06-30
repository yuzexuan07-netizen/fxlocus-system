import type { Locale } from "@/i18n/routing";

export function OpenSourceWatermark({ locale }: { locale: Locale }) {
  const label = locale === "en" ? "fxlocus open source - MIT" : "fxlocus 开源版 - MIT";

  return (
    <div className="fx-open-source-watermark" aria-label={label}>
      <span className="fx-open-source-watermark-mark">OSS</span>
      <span>{label}</span>
    </div>
  );
}
