const STUDENT_STATUS_NORMAL = "\u666e\u901a\u5b66\u5458";
const STUDENT_STATUS_PASSED = "\u8003\u6838\u901a\u8fc7";
const STUDENT_STATUS_LEARNING = "\u5b66\u4e60\u4e2d";
const STUDENT_STATUS_DONATION = "\u6350\u8d60\u5b66\u5458";
const STUDENT_STATUS_PASSED_DONATION = "\u8003\u6838\u901a\u8fc7+\u6350\u8d60\u5b66\u5458";

const STUDENT_STATUS_VALUES = [
  STUDENT_STATUS_NORMAL,
  STUDENT_STATUS_PASSED,
  STUDENT_STATUS_LEARNING,
  STUDENT_STATUS_DONATION,
  STUDENT_STATUS_PASSED_DONATION
] as const;

export type CanonicalStudentStatus = (typeof STUDENT_STATUS_VALUES)[number];

const EN_ALIAS_MAP: Record<string, CanonicalStudentStatus> = {
  normal: STUDENT_STATUS_NORMAL,
  normal_student: STUDENT_STATUS_NORMAL,
  "normal-student": STUDENT_STATUS_NORMAL,
  passed: STUDENT_STATUS_PASSED,
  approved: STUDENT_STATUS_PASSED,
  learning: STUDENT_STATUS_LEARNING,
  studying: STUDENT_STATUS_LEARNING,
  donation: STUDENT_STATUS_DONATION,
  donor: STUDENT_STATUS_DONATION,
  donation_student: STUDENT_STATUS_DONATION,
  "donation-student": STUDENT_STATUS_DONATION,
  "passed+donation": STUDENT_STATUS_PASSED_DONATION,
  passed_donation: STUDENT_STATUS_PASSED_DONATION,
  "passed-donation": STUDENT_STATUS_PASSED_DONATION,
  "pass+donation": STUDENT_STATUS_PASSED_DONATION
};

const MOJIBAKE_STATUS_PASSED_DONATION = "\u9470\u51a9\u7273\u95ab\u6c33\u7e43\u002b\u93b9\u612f\u7992\u701b\ufe40\u61b3";
const MOJIBAKE_STATUS_PASSED_DONATION_ALT = "\u95bc\u677f\u556f\u9417\u62bd\u67c5\u59d8\u5d07\u7b96";
const MOJIBAKE_STATUS_DONATION = "\u93b9\u612f\u7992\u701b\ufe40\u61b3";
const MOJIBAKE_STATUS_DONATION_ALT = "\u95b9\u89c4\u5298\u7ec2\u6394\u20ac\u6db3\u7b91\u93b2";
const MOJIBAKE_STATUS_PASSED = "\u9470\u51a9\u7273\u95ab\u6c33\u7e43";
const MOJIBAKE_STATUS_PASSED_ALT = "\u95bc\u677f\u556f\u9417\u62bd\u67c5\u59d8\u5d07\u7b96";
const MOJIBAKE_STATUS_LEARNING = "\u701b\ufe3f\u7bc4\u6d93";
const MOJIBAKE_STATUS_LEARNING_ALT = "\u940e\u6db3\u7f1a\u7ee1";
const MOJIBAKE_STATUS_NORMAL = "\u93c5\ue1c0\u20ac\u6c2c\ue11f\u935b";
const MOJIBAKE_STATUS_NORMAL_ALT = "\u95ba\u5481\u5663";
const PASSED_DONATION_STATUS_CANDIDATES = Array.from(
  new Set([
    STUDENT_STATUS_PASSED_DONATION,
    "passed+donation",
    "passed_donation",
    "passed-donation",
    "pass+donation",
    MOJIBAKE_STATUS_PASSED_DONATION,
    MOJIBAKE_STATUS_PASSED_DONATION_ALT
  ])
);

function normalizeMojibakeStatus(raw: string): CanonicalStudentStatus | null {
  if (!raw) return null;

  if (
    raw.includes(MOJIBAKE_STATUS_PASSED_DONATION) ||
    (raw.includes(MOJIBAKE_STATUS_PASSED_DONATION_ALT) && raw.includes(MOJIBAKE_STATUS_DONATION_ALT))
  ) {
    return STUDENT_STATUS_PASSED_DONATION;
  }
  if (raw.includes(MOJIBAKE_STATUS_DONATION) || raw.includes(MOJIBAKE_STATUS_DONATION_ALT)) {
    return STUDENT_STATUS_DONATION;
  }
  if (raw.includes(MOJIBAKE_STATUS_PASSED) || raw.includes(MOJIBAKE_STATUS_PASSED_ALT)) {
    return STUDENT_STATUS_PASSED;
  }
  if (raw.includes(MOJIBAKE_STATUS_LEARNING) || raw.includes(MOJIBAKE_STATUS_LEARNING_ALT)) {
    return STUDENT_STATUS_LEARNING;
  }
  if (raw.includes(MOJIBAKE_STATUS_NORMAL) || raw.includes(MOJIBAKE_STATUS_NORMAL_ALT)) {
    return STUDENT_STATUS_NORMAL;
  }

  return null;
}

export function normalizeStudentStatus(
  value: string | null | undefined,
  fallback: CanonicalStudentStatus = STUDENT_STATUS_NORMAL
): CanonicalStudentStatus | string {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  if ((STUDENT_STATUS_VALUES as readonly string[]).includes(raw)) return raw as CanonicalStudentStatus;

  const lower = raw.toLowerCase();
  if (EN_ALIAS_MAP[lower]) return EN_ALIAS_MAP[lower];

  const mojibake = normalizeMojibakeStatus(raw);
  if (mojibake) return mojibake;

  return raw;
}

export function isDonationStudentStatus(value: string | null | undefined) {
  const normalized = normalizeStudentStatus(value);
  return normalized === STUDENT_STATUS_DONATION || normalized === STUDENT_STATUS_PASSED_DONATION;
}

export function isPassedDonationStudentStatus(value: string | null | undefined) {
  return normalizeStudentStatus(value) === STUDENT_STATUS_PASSED_DONATION;
}

export function getPassedDonationStatusCandidates() {
  return [...PASSED_DONATION_STATUS_CANDIDATES];
}

export {
  STUDENT_STATUS_DONATION,
  STUDENT_STATUS_LEARNING,
  STUDENT_STATUS_NORMAL,
  STUDENT_STATUS_PASSED,
  STUDENT_STATUS_PASSED_DONATION,
  STUDENT_STATUS_VALUES
};
