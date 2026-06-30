export type CourseRequestBlockCode =
  | "PROFILE_SUBMISSION_REQUIRED"
  | "COGNITIVE_COMPLETION_REQUIRED"
  | "PREV_COMPLETION_AND_SUMMARY_REQUIRED"
  | "PREV_COURSE_INCOMPLETE"
  | "PREV_SUMMARY_REQUIRED";

export function resolveCourseRequestBlockCode(input: {
  courseId: number;
  courseType?: string | null;
  profileSubmitted: boolean;
  cognitiveCompleted?: boolean;
  previousCourseCompleted: boolean;
  previousSummarySubmitted: boolean;
}): CourseRequestBlockCode | null {
  if (!input.profileSubmitted) return "PROFILE_SUBMISSION_REQUIRED";
  if (String(input.courseType || "") === "advanced" && !input.cognitiveCompleted) {
    return "COGNITIVE_COMPLETION_REQUIRED";
  }
  if (input.courseId <= 1) return null;
  if (!input.previousCourseCompleted && !input.previousSummarySubmitted) {
    return "PREV_COMPLETION_AND_SUMMARY_REQUIRED";
  }
  if (!input.previousCourseCompleted) return "PREV_COURSE_INCOMPLETE";
  if (!input.previousSummarySubmitted) return "PREV_SUMMARY_REQUIRED";
  return null;
}

export function getCourseRequestBlockMessage(
  code: CourseRequestBlockCode | null,
  locale: "zh" | "en"
): string | null {
  if (!code) return null;
  if (locale === "zh") {
    if (code === "PROFILE_SUBMISSION_REQUIRED") return "\u8bf7\u5148\u4e0a\u4f20\u5e76\u63d0\u4ea4\u4e2a\u4eba\u8d44\u6599\u3002";
    if (code === "COGNITIVE_COMPLETION_REQUIRED") return "\u8bf7\u5148\u5b8c\u6210\u8ba4\u77e5\u8bfe\u7a0b\uff0c\u518d\u7533\u8bf7\u4ea4\u6613\u8bfe\u7a0b\u3002";
    if (code === "PREV_COMPLETION_AND_SUMMARY_REQUIRED") {
      return "\u8bf7\u5148\u5b8c\u6210\u4e0a\u4e00\u8bfe\u5e76\u63d0\u4ea4\u6536\u83b7\u3002";
    }
    if (code === "PREV_COURSE_INCOMPLETE") return "\u8bf7\u5148\u5b8c\u6210\u4e0a\u4e00\u8bfe\u3002";
    return "\u8bf7\u5148\u63d0\u4ea4\u4e0a\u4e00\u8bfe\u6536\u83b7\u3002";
  }
  if (code === "PROFILE_SUBMISSION_REQUIRED") return "Upload and submit your profile documents first.";
  if (code === "COGNITIVE_COMPLETION_REQUIRED") return "Complete the cognitive courses before requesting trading courses.";
  if (code === "PREV_COMPLETION_AND_SUMMARY_REQUIRED") {
    return "Finish the previous lesson and submit your takeaways first.";
  }
  if (code === "PREV_COURSE_INCOMPLETE") return "Finish the previous lesson first.";
  return "Submit the previous lesson takeaways first.";
}
