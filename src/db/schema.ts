import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  real,
  date,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const pk = () => serial("id").primaryKey();
const tsCreated = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const tsUpdated = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const tstz = (name: string) => timestamp(name, { withTimezone: true });

/* ---------- Identity & access ---------- */

export const users = pgTable(
  "users",
  {
    id: pk(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    fullName: text("full_name").notNull(),
    role: text("role").notNull(), // admin | teacher | student | guardian
    status: text("status").notNull().default("active"), // pending | active | suspended
    avatarUrl: text("avatar_url"),
    phone: text("phone"),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: tstz("locked_until"),
    lastLoginAt: tstz("last_login_at"),
    createdAt: tsCreated(),
    updatedAt: tsUpdated(),
  },
  (t) => [index("users_role_idx").on(t.role)],
);

export const authSessions = pgTable(
  "sessions",
  {
    id: pk(),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: tstz("expires_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: tsCreated(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: pk(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: tstz("expires_at").notNull(),
  usedAt: tstz("used_at"),
  createdAt: tsCreated(),
});

export const loginEvents = pgTable(
  "login_events",
  {
    id: pk(),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    email: text("email").notNull(),
    success: boolean("success").notNull(),
    ipAddress: text("ip_address"),
    reason: text("reason"),
    createdAt: tsCreated(),
  },
  (t) => [index("login_events_user_idx").on(t.userId)],
);

/* ---------- Institution ---------- */

export const departments = pgTable("departments", {
  id: pk(),
  name: text("name").notNull().unique(),
  code: text("code").notNull().unique(),
  description: text("description"),
  createdAt: tsCreated(),
});

export const courses = pgTable("courses", {
  id: pk(),
  departmentId: integer("department_id").notNull().references(() => departments.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  durationSemesters: integer("duration_semesters").notNull().default(6),
  createdAt: tsCreated(),
});

export const academicYears = pgTable("academic_years", {
  id: pk(),
  label: text("label").notNull().unique(),
  startDate: date("start_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }).notNull(),
  isCurrent: boolean("is_current").notNull().default(false),
  createdAt: tsCreated(),
});

export const classes = pgTable(
  "classes",
  {
    id: pk(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    courseId: integer("course_id").notNull().references(() => courses.id, { onDelete: "restrict" }),
    academicYearId: integer("academic_year_id").references(() => academicYears.id, { onDelete: "set null" }),
    semester: integer("semester").notNull(),
    division: text("division").notNull().default("A"),
    createdAt: tsCreated(),
  },
  (t) => [uniqueIndex("classes_course_sem_div_uq").on(t.courseId, t.semester, t.division, t.academicYearId)],
);

export const subjects = pgTable(
  "subjects",
  {
    id: pk(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    courseId: integer("course_id").notNull().references(() => courses.id, { onDelete: "restrict" }),
    semester: integer("semester").notNull(),
    credits: integer("credits").notNull().default(4),
    passMarks: real("pass_marks").notNull().default(40),
    maxInternalMarks: real("max_internal_marks").notNull().default(40),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: tsCreated(),
  },
  (t) => [index("subjects_course_sem_idx").on(t.courseId, t.semester)],
);

export const topics = pgTable(
  "topics",
  {
    id: pk(),
    subjectId: integer("subject_id").notNull().references(() => subjects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    chapterNo: integer("chapter_no").notNull().default(1),
    createdAt: tsCreated(),
  },
  (t) => [uniqueIndex("topics_subject_name_uq").on(t.subjectId, t.name)],
);

export const academicEvents = pgTable("academic_events", {
  id: pk(),
  title: text("title").notNull(),
  eventType: text("event_type").notNull(), // holiday | exam | deadline | event
  eventDate: date("event_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }),
  description: text("description"),
  classId: integer("class_id").references(() => classes.id, { onDelete: "set null" }),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: tsCreated(),
});

/* ---------- People ---------- */

export const students = pgTable(
  "students",
  {
    id: pk(),
    studentCode: text("student_code").notNull().unique(),
    userId: integer("user_id").unique().references(() => users.id, { onDelete: "set null" }),
    fullName: text("full_name").notNull(),
    email: text("email"),
    phone: text("phone"),
    courseId: integer("course_id").notNull().references(() => courses.id, { onDelete: "restrict" }),
    classId: integer("class_id").references(() => classes.id, { onDelete: "set null" }),
    academicYearId: integer("academic_year_id").references(() => academicYears.id, { onDelete: "set null" }),
    currentSemester: integer("current_semester").notNull().default(1),
    guardianName: text("guardian_name"),
    guardianPhone: text("guardian_phone"),
    guardianEmail: text("guardian_email"),
    dailyStudyGoalMinutes: integer("daily_study_goal_minutes").notNull().default(60),
    status: text("status").notNull().default("active"), // active | archived
    archivedAt: tstz("archived_at"),
    createdAt: tsCreated(),
    updatedAt: tsUpdated(),
  },
  (t) => [index("students_class_idx").on(t.classId), index("students_course_idx").on(t.courseId)],
);

export const teachers = pgTable("teachers", {
  id: pk(),
  teacherCode: text("teacher_code").notNull().unique(),
  userId: integer("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  departmentId: integer("department_id").notNull().references(() => departments.id, { onDelete: "restrict" }),
  designation: text("designation"),
  phone: text("phone"),
  createdAt: tsCreated(),
});

export const teacherAssignments = pgTable(
  "teacher_assignments",
  {
    id: pk(),
    teacherId: integer("teacher_id").notNull().references(() => teachers.id, { onDelete: "cascade" }),
    subjectId: integer("subject_id").notNull().references(() => subjects.id, { onDelete: "cascade" }),
    classId: integer("class_id").notNull().references(() => classes.id, { onDelete: "cascade" }),
    createdAt: tsCreated(),
  },
  (t) => [uniqueIndex("teacher_assign_uq").on(t.teacherId, t.subjectId, t.classId)],
);

export const studentSubjects = pgTable(
  "student_subjects",
  {
    id: pk(),
    studentId: integer("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
    subjectId: integer("subject_id").notNull().references(() => subjects.id, { onDelete: "cascade" }),
    createdAt: tsCreated(),
  },
  (t) => [uniqueIndex("student_subject_uq").on(t.studentId, t.subjectId)],
);

export const guardians = pgTable("guardians", {
  id: pk(),
  userId: integer("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  fullName: text("full_name").notNull(),
  relation: text("relation"),
  phone: text("phone"),
  createdAt: tsCreated(),
});

export const guardianLinks = pgTable(
  "guardian_links",
  {
    id: pk(),
    guardianId: integer("guardian_id").notNull().references(() => guardians.id, { onDelete: "cascade" }),
    studentId: integer("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
    approved: boolean("approved").notNull().default(false),
    approvedAt: tstz("approved_at"),
    createdAt: tsCreated(),
  },
  (t) => [uniqueIndex("guardian_link_uq").on(t.guardianId, t.studentId)],
);

/* ---------- Attendance ---------- */

export const attendanceSessions = pgTable(
  "attendance_sessions",
  {
    id: pk(),
    subjectId: integer("subject_id").notNull().references(() => subjects.id, { onDelete: "cascade" }),
    classId: integer("class_id").notNull().references(() => classes.id, { onDelete: "cascade" }),
    teacherId: integer("teacher_id").references(() => teachers.id, { onDelete: "set null" }),
    sessionDate: date("session_date", { mode: "string" }).notNull(),
    topicId: integer("topic_id").references(() => topics.id, { onDelete: "set null" }),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: tsCreated(),
    updatedAt: tsUpdated(),
  },
  (t) => [uniqueIndex("attendance_session_uq").on(t.subjectId, t.classId, t.sessionDate)],
);

export const attendanceRecords = pgTable(
  "attendance_records",
  {
    id: pk(),
    sessionId: integer("session_id").notNull().references(() => attendanceSessions.id, { onDelete: "cascade" }),
    studentId: integer("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    remarks: text("remarks"),
    updatedAt: tsUpdated(),
  },
  (t) => [
    uniqueIndex("attendance_record_uq").on(t.sessionId, t.studentId),
    index("attendance_student_idx").on(t.studentId),
  ],
);

export const attendanceCorrections = pgTable("attendance_corrections", {
  id: pk(),
  recordId: integer("record_id").notNull().references(() => attendanceRecords.id, { onDelete: "cascade" }),
  oldStatus: text("old_status").notNull(),
  newStatus: text("new_status").notNull(),
  reason: text("reason").notNull(),
  changedBy: integer("changed_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: tsCreated(),
});

/* ---------- Examinations & assignments ---------- */

export const exams = pgTable("exams", {
  id: pk(),
  name: text("name").notNull(),
  examType: text("exam_type").notNull(),
  subjectId: integer("subject_id").notNull().references(() => subjects.id, { onDelete: "cascade" }),
  classId: integer("class_id").references(() => classes.id, { onDelete: "set null" }),
  examDate: date("exam_date", { mode: "string" }).notNull(),
  maxMarks: real("max_marks").notNull(),
  passMarks: real("pass_marks").notNull(),
  status: text("status").notNull().default("scheduled"), // scheduled | marks_entry | published
  publishedAt: tstz("published_at"),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: tsCreated(),
});

export const examResults = pgTable(
  "exam_results",
  {
    id: pk(),
    examId: integer("exam_id").notNull().references(() => exams.id, { onDelete: "cascade" }),
    studentId: integer("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
    marksObtained: real("marks_obtained"), // NULL = not yet entered (never treated as zero)
    attendanceStatus: text("attendance_status").notNull().default("present"), // present | absent
    remarks: text("remarks"),
    enteredBy: integer("entered_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: tsUpdated(),
  },
  (t) => [uniqueIndex("exam_result_uq").on(t.examId, t.studentId), index("exam_result_student_idx").on(t.studentId)],
);

export const examCorrections = pgTable("exam_corrections", {
  id: pk(),
  resultId: integer("result_id").notNull().references(() => examResults.id, { onDelete: "cascade" }),
  requestedBy: integer("requested_by").references(() => users.id, { onDelete: "set null" }),
  oldMarks: real("old_marks"),
  newMarks: real("new_marks"),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("pending"), // pending | approved | rejected
  decidedBy: integer("decided_by").references(() => users.id, { onDelete: "set null" }),
  decidedAt: tstz("decided_at"),
  createdAt: tsCreated(),
});

export const assignments = pgTable("assignments", {
  id: pk(),
  title: text("title").notNull(),
  subjectId: integer("subject_id").notNull().references(() => subjects.id, { onDelete: "cascade" }),
  classId: integer("class_id").references(() => classes.id, { onDelete: "set null" }),
  topicId: integer("topic_id").references(() => topics.id, { onDelete: "set null" }),
  instructions: text("instructions").notNull(),
  deadline: tstz("deadline").notNull(),
  maxMarks: real("max_marks").notNull().default(10),
  allowResubmission: boolean("allow_resubmission").notNull().default(false),
  attachmentPath: text("attachment_path"),
  attachmentName: text("attachment_name"),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: tsCreated(),
});

export const assignmentSubmissions = pgTable(
  "assignment_submissions",
  {
    id: pk(),
    assignmentId: integer("assignment_id").notNull().references(() => assignments.id, { onDelete: "cascade" }),
    studentId: integer("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
    submissionText: text("submission_text"),
    filePath: text("file_path"),
    fileName: text("file_name"),
    mimeType: text("mime_type"),
    fileSize: integer("file_size"),
    submittedAt: tstz("submitted_at").notNull().defaultNow(),
    isLate: boolean("is_late").notNull().default(false),
    attemptNo: integer("attempt_no").notNull().default(1),
    status: text("status").notNull().default("submitted"), // submitted | graded | resubmission_requested
    marks: real("marks"),
    feedback: text("feedback"),
    gradedAt: tstz("graded_at"),
    gradedBy: integer("graded_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: tsUpdated(),
  },
  (t) => [uniqueIndex("submission_uq").on(t.assignmentId, t.studentId)],
);

/* ---------- Quizzes, question bank, mastery ---------- */

export const questions = pgTable(
  "questions",
  {
    id: pk(),
    subjectId: integer("subject_id").notNull().references(() => subjects.id, { onDelete: "cascade" }),
    topicId: integer("topic_id").notNull().references(() => topics.id, { onDelete: "cascade" }),
    questionType: text("question_type").notNull(), // mcq | true_false | short_answer
    difficulty: integer("difficulty").notNull().default(2), // 1 easy, 2 medium, 3 hard
    prompt: text("prompt").notNull(),
    options: jsonb("options").$type<string[]>().notNull().default([]),
    correctAnswer: text("correct_answer").notNull(),
    acceptedAnswers: jsonb("accepted_answers").$type<string[]>().notNull().default([]),
    explanation: text("explanation").notNull().default(""),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: tsCreated(),
  },
  (t) => [index("questions_topic_idx").on(t.topicId)],
);

export const quizzes = pgTable("quizzes", {
  id: pk(),
  title: text("title").notNull(),
  subjectId: integer("subject_id").notNull().references(() => subjects.id, { onDelete: "cascade" }),
  topicId: integer("topic_id").references(() => topics.id, { onDelete: "cascade" }),
  timeLimitSeconds: integer("time_limit_seconds").notNull().default(600),
  questionCount: integer("question_count").notNull().default(5),
  isPublished: boolean("is_published").notNull().default(true),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: tsCreated(),
});

export const quizAttempts = pgTable(
  "quiz_attempts",
  {
    id: pk(),
    quizId: integer("quiz_id").notNull().references(() => quizzes.id, { onDelete: "cascade" }),
    studentId: integer("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("in_progress"), // in_progress | submitted | expired
    startedAt: tstz("started_at").notNull().defaultNow(),
    deadline: tstz("deadline").notNull(),
    submittedAt: tstz("submitted_at"),
    score: real("score"),
    maxScore: real("max_score"),
    percentage: real("percentage"),
    startDifficulty: integer("start_difficulty"),
    endDifficulty: integer("end_difficulty"),
    createdAt: tsCreated(),
  },
  (t) => [index("quiz_attempt_student_idx").on(t.studentId)],
);

export const quizAnswers = pgTable(
  "quiz_answers",
  {
    id: pk(),
    attemptId: integer("attempt_id").notNull().references(() => quizAttempts.id, { onDelete: "cascade" }),
    questionId: integer("question_id").notNull().references(() => questions.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    difficulty: integer("difficulty").notNull(),
    givenAnswer: text("given_answer"),
    isCorrect: boolean("is_correct"),
    marksAwarded: real("marks_awarded"),
    needsReview: boolean("needs_review").notNull().default(false),
  },
  (t) => [uniqueIndex("quiz_answer_uq").on(t.attemptId, t.questionId)],
);

export const topicMastery = pgTable(
  "topic_mastery",
  {
    id: pk(),
    studentId: integer("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
    topicId: integer("topic_id").notNull().references(() => topics.id, { onDelete: "cascade" }),
    subjectId: integer("subject_id").notNull().references(() => subjects.id, { onDelete: "cascade" }),
    attempted: integer("attempted").notNull().default(0),
    correct: integer("correct").notNull().default(0),
    masteryScore: real("mastery_score").notNull().default(0),
    level: text("level").notNull().default("needs_improvement"),
    trend: text("trend").notNull().default("stable"), // improving | stable | declining
    history: jsonb("history").$type<{ date: string; accuracy: number; attempted: number }[]>().notNull().default([]),
    updatedAt: tsUpdated(),
  },
  (t) => [uniqueIndex("topic_mastery_uq").on(t.studentId, t.topicId)],
);

/* ---------- Learning activity & resources ---------- */

export const learningActivities = pgTable(
  "learning_activities",
  {
    id: pk(),
    studentId: integer("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
    subjectId: integer("subject_id").references(() => subjects.id, { onDelete: "set null" }),
    activityType: text("activity_type").notNull(), // study_session | video | reading | practice | quiz | login
    minutes: integer("minutes").notNull(),
    activityDate: date("activity_date", { mode: "string" }).notNull(),
    createdAt: tsCreated(),
  },
  (t) => [index("activity_student_date_idx").on(t.studentId, t.activityDate)],
);

export const learningResources = pgTable("learning_resources", {
  id: pk(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  resourceType: text("resource_type").notNull(),
  externalUrl: text("external_url"),
  filePath: text("file_path"),
  fileName: text("file_name"),
  subjectId: integer("subject_id").notNull().references(() => subjects.id, { onDelete: "cascade" }),
  topicId: integer("topic_id").references(() => topics.id, { onDelete: "set null" }),
  difficulty: text("difficulty").notNull().default("medium"), // easy | medium | hard
  status: text("status").notNull().default("pending"), // pending | approved | rejected
  uploadedBy: integer("uploaded_by").references(() => users.id, { onDelete: "set null" }),
  approvedBy: integer("approved_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: tsCreated(),
});

export const resourceBookmarks = pgTable(
  "resource_bookmarks",
  {
    id: pk(),
    studentId: integer("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
    resourceId: integer("resource_id").notNull().references(() => learningResources.id, { onDelete: "cascade" }),
    bookmarked: boolean("bookmarked").notNull().default(false),
    completed: boolean("completed").notNull().default(false),
    completedAt: tstz("completed_at"),
    updatedAt: tsUpdated(),
  },
  (t) => [uniqueIndex("bookmark_uq").on(t.studentId, t.resourceId)],
);

/* ---------- Machine learning & risk ---------- */

export const modelVersions = pgTable("model_versions", {
  id: pk(),
  name: text("name").notNull(),
  algorithm: text("algorithm").notNull(),
  datasetSize: integer("dataset_size").notNull(),
  positiveCount: integer("positive_count").notNull(),
  labelSource: text("label_source").notNull(), // synthetic-demo | institutional | mixed
  metrics: jsonb("metrics").$type<Record<string, unknown>>().notNull().default({}),
  comparison: jsonb("comparison").$type<Record<string, unknown>[]>().notNull().default([]),
  featureNames: jsonb("feature_names").$type<string[]>().notNull().default([]),
  params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
  dataQuality: jsonb("data_quality").$type<Record<string, unknown>>().notNull().default({}),
  threshold: real("threshold").notNull(),
  isActive: boolean("is_active").notNull().default(false),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: tsCreated(),
});

export const academicOutcomes = pgTable(
  "academic_outcomes",
  {
    id: pk(),
    studentId: integer("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
    semester: integer("semester").notNull(),
    outcome: text("outcome").notNull(), // at_risk | on_track
    source: text("source").notNull(), // synthetic | institutional
    averagePct: real("average_pct"),
    createdAt: tsCreated(),
  },
  (t) => [uniqueIndex("outcome_uq").on(t.studentId, t.semester, t.source)],
);

export const riskPredictions = pgTable(
  "risk_predictions",
  {
    id: pk(),
    studentId: integer("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
    modelVersionId: integer("model_version_id").references(() => modelVersions.id, { onDelete: "set null" }),
    method: text("method").notNull(), // ml | rule_screening
    riskCategory: text("risk_category").notNull(),
    ruleCategory: text("rule_category").notNull(),
    probability: real("probability"),
    riskScore: integer("risk_score").notNull(),
    features: jsonb("features").$type<Record<string, number | null>>().notNull().default({}),
    missingFeatures: jsonb("missing_features").$type<string[]>().notNull().default([]),
    explanation: jsonb("explanation").$type<Record<string, unknown>>().notNull().default({}),
    suggestedIntervention: text("suggested_intervention").notNull().default(""),
    labelSource: text("label_source").notNull().default("synthetic-demo"),
    isDemo: boolean("is_demo").notNull().default(true),
    predictedAt: tstz("predicted_at").notNull().defaultNow(),
  },
  (t) => [index("risk_student_idx").on(t.studentId, t.predictedAt)],
);

export const recommendations = pgTable(
  "recommendations",
  {
    id: pk(),
    studentId: integer("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
    subjectId: integer("subject_id").references(() => subjects.id, { onDelete: "set null" }),
    topicId: integer("topic_id").references(() => topics.id, { onDelete: "set null" }),
    category: text("category").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    priority: integer("priority").notNull().default(2), // 1 high, 2 medium, 3 low
    status: text("status").notNull().default("suggested"), // suggested | in_progress | completed | dismissed
    dedupeKey: text("dedupe_key").notNull(),
    resourceId: integer("resource_id").references(() => learningResources.id, { onDelete: "set null" }),
    source: text("source").notNull().default("rules"),
    baselineScore: real("baseline_score"),
    followUpScore: real("follow_up_score"),
    effectiveness: real("effectiveness"),
    feedbackRating: integer("feedback_rating"),
    feedbackText: text("feedback_text"),
    startedAt: tstz("started_at"),
    completedAt: tstz("completed_at"),
    createdAt: tsCreated(),
    updatedAt: tsUpdated(),
  },
  (t) => [uniqueIndex("recommendation_dedupe_uq").on(t.studentId, t.dedupeKey)],
);

export const interventions = pgTable("interventions", {
  id: pk(),
  studentId: integer("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  subjectId: integer("subject_id").references(() => subjects.id, { onDelete: "set null" }),
  status: text("status").notNull().default("pending"),
  plan: text("plan").notNull(), // visible to student
  target: text("target").notNull().default(""),
  improvementTargetPct: real("improvement_target_pct"),
  followUpDate: date("follow_up_date", { mode: "string" }),
  closedAt: tstz("closed_at"),
  createdAt: tsCreated(),
  updatedAt: tsUpdated(),
});

export const interventionHistory = pgTable("intervention_history", {
  id: pk(),
  interventionId: integer("intervention_id").notNull().references(() => interventions.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  kind: text("kind").notNull(), // status_change | support_session | follow_up | revision_task | update
  note: text("note").notNull().default(""),
  changedBy: integer("changed_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: tsCreated(),
});

export const teacherObservations = pgTable("teacher_observations", {
  id: pk(),
  studentId: integer("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  authorId: integer("author_id").references(() => users.id, { onDelete: "set null" }),
  interventionId: integer("intervention_id").references(() => interventions.id, { onDelete: "set null" }),
  body: text("body").notNull(),
  visibility: text("visibility").notNull().default("private"), // private (staff only)
  createdAt: tsCreated(),
});

export const studyTasks = pgTable(
  "study_tasks",
  {
    id: pk(),
    studentId: integer("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    subjectId: integer("subject_id").references(() => subjects.id, { onDelete: "set null" }),
    topicId: integer("topic_id").references(() => topics.id, { onDelete: "set null" }),
    taskDate: date("task_date", { mode: "string" }).notNull(),
    minutes: integer("minutes").notNull().default(45),
    source: text("source").notNull().default("planner"), // planner | teacher | recommendation
    status: text("status").notNull().default("planned"), // planned | completed
    completedAt: tstz("completed_at"),
    rescheduleCount: integer("reschedule_count").notNull().default(0),
    createdAt: tsCreated(),
  },
  (t) => [index("study_tasks_student_date_idx").on(t.studentId, t.taskDate)],
);

export const earlyWarningAlerts = pgTable(
  "early_warning_alerts",
  {
    id: pk(),
    studentId: integer("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
    subjectId: integer("subject_id").references(() => subjects.id, { onDelete: "set null" }),
    category: text("category").notNull(),
    severity: text("severity").notNull(), // low | medium | high
    title: text("title").notNull(),
    factors: jsonb("factors").$type<string[]>().notNull().default([]),
    recommendedAction: text("recommended_action").notNull(),
    status: text("status").notNull().default("open"), // open | acknowledged | resolved
    acknowledgedBy: integer("acknowledged_by").references(() => users.id, { onDelete: "set null" }),
    acknowledgedAt: tstz("acknowledged_at"),
    resolvedBy: integer("resolved_by").references(() => users.id, { onDelete: "set null" }),
    resolvedAt: tstz("resolved_at"),
    createdAt: tsCreated(),
  },
  (t) => [index("alerts_student_idx").on(t.studentId, t.status)],
);

/* ---------- Notifications, timetable, audit, settings ---------- */

export const notifications = pgTable(
  "notifications",
  {
    id: pk(),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    message: text("message").notNull(),
    category: text("category").notNull().default("general"),
    link: text("link"),
    isRead: boolean("is_read").notNull().default(false),
    createdAt: tsCreated(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.isRead)],
);

export const notificationPreferences = pgTable("notification_preferences", {
  userId: integer("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  categories: jsonb("categories").$type<Record<string, boolean>>().notNull().default({}),
  updatedAt: tsUpdated(),
});

export const timetableEntries = pgTable(
  "timetable_entries",
  {
    id: pk(),
    classId: integer("class_id").notNull().references(() => classes.id, { onDelete: "cascade" }),
    subjectId: integer("subject_id").notNull().references(() => subjects.id, { onDelete: "cascade" }),
    teacherId: integer("teacher_id").notNull().references(() => teachers.id, { onDelete: "cascade" }),
    dayOfWeek: integer("day_of_week").notNull(), // 1 Mon .. 6 Sat
    startTime: text("start_time").notNull(), // HH:MM
    endTime: text("end_time").notNull(),
    room: text("room").notNull().default(""),
    createdAt: tsCreated(),
  },
  (t) => [index("timetable_class_idx").on(t.classId), index("timetable_teacher_idx").on(t.teacherId)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: pk(),
    actorId: integer("actor_id").references(() => users.id, { onDelete: "set null" }),
    actorRole: text("actor_role"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    ipAddress: text("ip_address"),
    createdAt: tsCreated(),
  },
  (t) => [index("audit_created_idx").on(t.createdAt)],
);

export const systemSettings = pgTable("system_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: integer("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: tsUpdated(),
});

export const reportLogs = pgTable("report_logs", {
  id: pk(),
  userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
  reportType: text("report_type").notNull(),
  format: text("format").notNull(),
  filters: jsonb("filters").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: tsCreated(),
});

/* ---------- Discussion ---------- */

export const discussionThreads = pgTable("discussion_threads", {
  id: pk(),
  subjectId: integer("subject_id").notNull().references(() => subjects.id, { onDelete: "cascade" }),
  authorId: integer("author_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  body: text("body").notNull(),
  category: text("category").notNull().default("concept"), // concept | assignment | exam | resource | other
  status: text("status").notNull().default("open"), // open | answered | closed
  isFlagged: boolean("is_flagged").notNull().default(false),
  flagReason: text("flag_reason"),
  createdAt: tsCreated(),
  updatedAt: tsUpdated(),
});

export const discussionReplies = pgTable("discussion_replies", {
  id: pk(),
  threadId: integer("thread_id").notNull().references(() => discussionThreads.id, { onDelete: "cascade" }),
  authorId: integer("author_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  isStaff: boolean("is_staff").notNull().default(false),
  isFlagged: boolean("is_flagged").notNull().default(false),
  flagReason: text("flag_reason"),
  createdAt: tsCreated(),
});
