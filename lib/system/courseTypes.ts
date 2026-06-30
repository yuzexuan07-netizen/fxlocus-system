export const COURSE_TYPE_COGNITIVE = "cognitive";
export const COURSE_TYPE_ADVANCED = "advanced";
export const COURSE_TYPE_MODEL = "model";
export const COURSE_TYPE_MOJING = "mojing";

export const COURSE_TYPES = [
  COURSE_TYPE_COGNITIVE,
  COURSE_TYPE_ADVANCED,
  COURSE_TYPE_MODEL,
  COURSE_TYPE_MOJING
] as const;

export type CourseType = (typeof COURSE_TYPES)[number];

const COURSE_TYPE_ALIASES: Record<string, CourseType> = {
  cognitive: COURSE_TYPE_COGNITIVE,
  cognition: COURSE_TYPE_COGNITIVE,
  "\u8ba4\u77e5\u8bfe\u7a0b": COURSE_TYPE_COGNITIVE,
  "\u8ba4\u77e5": COURSE_TYPE_COGNITIVE,
  advanced: COURSE_TYPE_ADVANCED,
  advance: COURSE_TYPE_ADVANCED,
  "\u8fdb\u9636\u8bfe\u7a0b": COURSE_TYPE_ADVANCED,
  "\u8fdb\u9636": COURSE_TYPE_ADVANCED,
  "\u4ea4\u6613\u8bfe\u7a0b": COURSE_TYPE_ADVANCED,
  "\u4ea4\u6613": COURSE_TYPE_ADVANCED,
  model: COURSE_TYPE_MODEL,
  models: COURSE_TYPE_MODEL,
  "\u6a21\u578b\u8bfe\u7a0b": COURSE_TYPE_MODEL,
  "\u6a21\u578b": COURSE_TYPE_MODEL,
  mojing: COURSE_TYPE_MOJING,
  magic: COURSE_TYPE_MOJING,
  "\u9b54\u7ecf": COURSE_TYPE_MOJING
};

export function normalizeCourseType(value: unknown): CourseType {
  const raw = String(value || "").trim();
  if (!raw) return COURSE_TYPE_ADVANCED;
  const lower = raw.toLowerCase();
  return COURSE_TYPE_ALIASES[raw] || COURSE_TYPE_ALIASES[lower] || COURSE_TYPE_ADVANCED;
}

export function isBundleCourseType(value: unknown) {
  const type = normalizeCourseType(value);
  return type === COURSE_TYPE_MODEL || type === COURSE_TYPE_MOJING;
}

export function isIndividualCourseType(value: unknown) {
  return !isBundleCourseType(value);
}

export function getCourseTypeLabel(type: CourseType, locale: "zh" | "en") {
  if (type === COURSE_TYPE_COGNITIVE) return locale === "zh" ? "\u8ba4\u77e5\u8bfe\u7a0b" : "Cognitive Courses";
  if (type === COURSE_TYPE_MODEL) return locale === "zh" ? "\u6a21\u578b\u8bfe\u7a0b" : "Model Courses";
  if (type === COURSE_TYPE_MOJING) return locale === "zh" ? "\u9b54\u7ecf\u8bfe\u7a0b" : "Mojing Courses";
  return locale === "zh" ? "\u4ea4\u6613\u8bfe\u7a0b" : "Trading Courses";
}

export function getCourseTypeDescription(type: CourseType, locale: "zh" | "en") {
  if (type === COURSE_TYPE_COGNITIVE) {
    return locale === "zh"
      ? "\u8ba4\u77e5\u8bfe\u7a0b\u5171 9 \u8282\uff0c\u5148\u63d0\u4ea4\u4e2a\u4eba\u8d44\u6599\uff0c\u518d\u6309\u987a\u5e8f\u9010\u8bfe\u5b66\u4e60\u3002"
      : "Cognitive courses have 9 lessons. Submit profile documents first, then unlock lessons in order.";
  }
  if (type === COURSE_TYPE_MODEL) {
    return locale === "zh"
      ? "\u6a21\u578b\u8bfe\u7a0b\u6309\u5206\u7c7b\u4e00\u6b21\u6388\u6743\uff0c\u5f00\u901a\u540e\u8be5\u5206\u7c7b\u4e0b\u5168\u90e8\u8bfe\u7a0b\u53ef\u5b66\u4e60\u3002"
      : "Model courses are granted as one bundle.";
  }
  if (type === COURSE_TYPE_MOJING) {
    return locale === "zh"
      ? "\u9b54\u7ecf\u8bfe\u7a0b\u6309\u5206\u7c7b\u4e00\u6b21\u6388\u6743\uff0c\u5f00\u901a\u540e\u8be5\u5206\u7c7b\u4e0b\u5168\u90e8\u8bfe\u7a0b\u53ef\u5b66\u4e60\u3002"
      : "Mojing courses are granted as one bundle.";
  }
  return locale === "zh"
    ? "\u4ea4\u6613\u8bfe\u7a0b\u9700\u5b8c\u6210\u8ba4\u77e5\u8bfe\u7a0b\u540e\u624d\u80fd\u7533\u8bf7\uff0c\u53ef\u6309\u5355\u8282\u6216\u524d N \u8282\u5f00\u901a\u3002"
    : "Trading courses require completing cognitive courses first and can be granted by lesson or prefix.";
}
