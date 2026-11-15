export const ROLES = ["admin", "teacher", "student", "guardian"] as const;
export type Role = (typeof ROLES)[number];

export const ATTENDANCE_STATUSES = ["present", "absent", "late", "excused"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const EXAM_TYPES = [
  "internal_assessment",
  "class_test",
  "mid_semester",
  "end_semester",
  "practical",
  "project",
] as const;
export type ExamType = (typeof EXAM_TYPES)[number];

export const RESOURCE_TYPES = [
  "pdf",
  "note",
  "presentation",
  "video",
  "external_link",
  "practice",
  "reference",
] as const;

export const RECOMMENDATION_CATEGORIES = [
  "study_material",
  "subject_revision",
  "topic_revision",
  "practice_exercises",
  "mock_test",
  "video_tutorial",
  "assignment_completion",
  "attendance_improvement",
  "study_schedule",
  "teacher_assistance",
  "time_management",
  "additional_resource",
] as const;

export const INTERVENTION_STATUSES = ["pending", "in_progress", "follow_up_required", "completed"] as const;
export type InterventionStatus = (typeof INTERVENTION_STATUSES)[number];

export const MASTERY_LEVELS = ["needs_improvement", "developing", "proficient", "strong"] as const;
export type MasteryLevel = (typeof MASTERY_LEVELS)[number];

export const QUESTION_TYPES = ["mcq", "true_false", "short_answer"] as const;

export const ALERT_CATEGORIES = [
  "falling_marks",
  "attendance_decline",
  "missed_assignments",
  "quiz_failures",
  "reduced_activity",
  "subject_deterioration",
] as const;

export const RISK_CATEGORIES = ["low", "medium", "high"] as const;
export type RiskCategory = (typeof RISK_CATEGORIES)[number];

export const MAX_LOGIN_FAILURES = 5;
export const LOCKOUT_MINUTES = 15;
export const SESSION_HOURS = 8;
