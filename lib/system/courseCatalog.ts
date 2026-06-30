export const SYSTEM_ADVANCED_COURSE_FALLBACK_MAX_ID = 0;
export const SYSTEM_COGNITIVE_COURSE_FALLBACK_MAX_ID = 9;
export const SYSTEM_COURSE_FALLBACK_MAX_ID = SYSTEM_ADVANCED_COURSE_FALLBACK_MAX_ID;

export const SYSTEM_COGNITIVE_COURSE_TITLES_ZH = [
  "\u95f2\u804a",
  "\u5e38\u8bc6",
  "\u9632\u8303",
  "\u5fe0\u544a",
  "\u771f\u76f8",
  "\u8f6e\u56de",
  "\u8def\u5f84",
  "\u6cd5\u95e8",
  "\u5151\u73b0"
] as const;

export const SYSTEM_COGNITIVE_COURSE_TITLES_EN = [
  "Opening Talk",
  "Common Sense",
  "Risk Awareness",
  "Advice",
  "Truth",
  "Cycles",
  "Path",
  "Method",
  "Realization"
] as const;

export function normalizeSystemCourseMaxId(
  value: unknown,
  fallback = SYSTEM_COURSE_FALLBACK_MAX_ID
) {
  const normalizedFallback = Math.max(0, Math.floor(Number(fallback) || 0));
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return normalizedFallback;
  }
  return Math.max(normalizedFallback, Math.floor(numeric));
}

export function buildSystemCourseIdRange(maxCourseId: number) {
  const normalized = normalizeSystemCourseMaxId(maxCourseId);
  if (normalized <= 0) return [];
  return Array.from({ length: normalized }, (_, index) => index + 1);
}

export function buildCognitiveCourseSeedRows(now = new Date().toISOString()) {
  return SYSTEM_COGNITIVE_COURSE_TITLES_ZH.map((title, index) => {
    const id = index + 1;
    return {
      id,
      course_type: "cognitive",
      sort_order: id,
      title_zh: title,
      title_en: SYSTEM_COGNITIVE_COURSE_TITLES_EN[index] || `Cognitive ${id}`,
      summary_zh: `\u8ba4\u77e5\u8bfe\u7a0b\u7b2c ${id} \u8282\uff1a${title}`,
      summary_en: `Cognitive course lesson ${id}: ${SYSTEM_COGNITIVE_COURSE_TITLES_EN[index] || title}`,
      published: false,
      created_at: now,
      updated_at: now
    };
  });
}
