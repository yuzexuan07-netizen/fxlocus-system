export function getCourseDisplayTitle(
  locale: "zh" | "en",
  input: { id?: number | null; title_zh?: string | null; title_en?: string | null }
) {
  const localizedTitle = String(locale === "zh" ? input.title_zh || "" : input.title_en || "").trim();
  if (localizedTitle) return localizedTitle;
  const fallbackId = Number(input.id || 0);
  return locale === "zh" ? `课程 #${fallbackId || "-"}` : `Course #${fallbackId || "-"}`;
}

export function getCourseDisplayCode(locale: "zh" | "en", courseId: number | null | undefined) {
  const normalizedId = Number(courseId || 0);
  return locale === "zh" ? `课程编号 #${normalizedId || "-"}` : `Course ID #${normalizedId || "-"}`;
}
