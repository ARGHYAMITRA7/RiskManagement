/* eslint-disable @typescript-eslint/no-explicit-any */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import * as S from "@/db/schema";
import { hashPassword } from "@/lib/security";
import { mulberry32 } from "@/lib/ml/logistic";
import { computeMasteryUpdate } from "@/lib/mastery";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { trainRiskModel } from "@/lib/ml/train";
import { runRiskAssessments } from "@/lib/ml/predict";
import { runEarlyWarningScan } from "@/lib/early-warning";
import { generateRecommendations } from "@/lib/recommendations";
import { audit } from "@/lib/events";

/**
 * SYNTHETIC demonstration dataset generator.
 * Every generated student has a studentCode beginning with "SYN-" and every outcome label has source "synthetic".
 * The data is generated from a latent ability model so that the ML pipeline has realistic structure to learn.
 * It has NO real-world predictive validity; it exists to demonstrate the platform end to end.
 */

export const SYNTHETIC_PREFIX = "SYN-";
export const DEMO_STUDENT_CODE = "SYN-0001";
const SEED = 20260101;

const TABLE_NAMES = [
  "users", "sessions", "password_reset_tokens", "login_events", "departments", "courses", "academic_years", "classes",
  "subjects", "topics", "academic_events", "students", "teachers", "teacher_assignments", "student_subjects", "guardians",
  "guardian_links", "attendance_sessions", "attendance_records", "attendance_corrections", "exams", "exam_results",
  "exam_corrections", "assignments", "assignment_submissions", "questions", "quizzes", "quiz_attempts", "quiz_answers",
  "topic_mastery", "learning_activities", "learning_resources", "resource_bookmarks", "model_versions", "academic_outcomes",
  "risk_predictions", "recommendations", "interventions", "intervention_history", "teacher_observations", "study_tasks",
  "early_warning_alerts", "notifications", "notification_preferences", "timetable_entries", "audit_logs", "system_settings",
  "report_logs", "discussion_threads", "discussion_replies",
];

export async function resetAllData() {
  await db.execute(sql.raw(`TRUNCATE ${TABLE_NAMES.join(", ")} RESTART IDENTITY CASCADE`));
}

const SUBJECTS = [
  { code: "BCA101", name: "Mathematics I", sem: 1, course: "BCA" },
  { code: "BCA102", name: "Programming in C", sem: 1, course: "BCA" },
  { code: "BCA103", name: "Computer Fundamentals", sem: 1, course: "BCA" },
  { code: "BCA104", name: "Communication Skills", sem: 1, course: "BCA" },
  { code: "BCA201", name: "Discrete Mathematics", sem: 2, course: "BCA" },
  { code: "BCA202", name: "Data Structures", sem: 2, course: "BCA" },
  { code: "BCA203", name: "Digital Electronics", sem: 2, course: "BCA" },
  { code: "BCA204", name: "Environmental Studies", sem: 2, course: "BCA" },
  { code: "BCA301", name: "Database Systems", sem: 3, course: "BCA" },
  { code: "BCA302", name: "Operating Systems", sem: 3, course: "BCA" },
  { code: "BCA303", name: "Web Technologies", sem: 3, course: "BCA" },
  { code: "BCA304", name: "Software Engineering", sem: 3, course: "BCA" },
  { code: "BBA101", name: "Principles of Management", sem: 1, course: "BBA" },
  { code: "BBA102", name: "Business Economics", sem: 1, course: "BBA" },
];

type Q = { d: number; type: "mcq" | "true_false" | "short_answer"; prompt: string; options?: string[]; correct: string; accepted?: string[]; why: string };

const TOPIC_BANK: Record<string, { subject: string; questions: Q[] }> = {
  "ER Modelling": {
    subject: "BCA301",
    questions: [
      { d: 1, type: "mcq", prompt: "Which ER component represents a real-world object such as a Student?", options: ["Attribute", "Entity", "Relationship", "Key"], correct: "Entity", why: "An entity is an object with independent existence, such as a Student." },
      { d: 2, type: "true_false", prompt: "A weak entity can be uniquely identified without a key from its owner entity.", options: ["True", "False"], correct: "False", why: "A weak entity depends on its identifying owner entity for identification." },
      { d: 3, type: "mcq", prompt: "How is a many-to-many relationship between Student and Course best implemented?", options: ["Add course_id to student", "Create a separate junction table", "Store courses as a list in student", "Merge both tables"], correct: "Create a separate junction table", why: "A junction table holds foreign keys to both entities." },
    ],
  },
  Normalization: {
    subject: "BCA301",
    questions: [
      { d: 1, type: "mcq", prompt: "What is the main goal of normalization?", options: ["Increase redundancy", "Reduce redundancy and anomalies", "Speed up every query", "Encrypt data"], correct: "Reduce redundancy and anomalies", why: "Normalization removes redundancy that causes update, insert and delete anomalies." },
      { d: 2, type: "mcq", prompt: "A table is in 2NF when it is in 1NF and every non-key attribute depends on:", options: ["Any attribute", "The whole primary key", "A foreign key", "No attribute"], correct: "The whole primary key", why: "Partial dependencies on part of a composite key are removed in 2NF." },
      { d: 3, type: "short_answer", prompt: "Name the normal form that removes transitive dependencies.", correct: "3NF", accepted: ["Third Normal Form", "3rd normal form"], why: "Third Normal Form (3NF) removes transitive dependencies between non-key attributes." },
    ],
  },
  "SQL Queries": {
    subject: "BCA301",
    questions: [
      { d: 1, type: "mcq", prompt: "Which clause filters groups after aggregation?", options: ["WHERE", "GROUP BY", "HAVING", "ORDER BY"], correct: "HAVING", why: "HAVING filters groups produced by GROUP BY; WHERE filters rows before grouping." },
      { d: 2, type: "true_false", prompt: "A LEFT JOIN returns only rows that match in both tables.", options: ["True", "False"], correct: "False", why: "LEFT JOIN keeps all rows from the left table, with NULLs where there is no match." },
      { d: 3, type: "mcq", prompt: "Which query returns the number of distinct departments in a staff table?", options: ["SELECT COUNT(department) FROM staff", "SELECT COUNT(DISTINCT department) FROM staff", "SELECT DISTINCT COUNT(*) FROM staff", "SELECT SUM(department) FROM staff"], correct: "SELECT COUNT(DISTINCT department) FROM staff", why: "COUNT(DISTINCT column) counts unique non-null values." },
    ],
  },
  "Process Scheduling": {
    subject: "BCA302",
    questions: [
      { d: 1, type: "mcq", prompt: "Which non-preemptive algorithm runs the job with the smallest burst time next?", options: ["FCFS", "SJF", "Round Robin", "Priority inversion"], correct: "SJF", why: "Shortest Job First selects the process with the smallest next CPU burst." },
      { d: 2, type: "true_false", prompt: "Round Robin scheduling uses a fixed time quantum.", options: ["True", "False"], correct: "True", why: "Each process receives the CPU for at most one time quantum per turn." },
      { d: 3, type: "mcq", prompt: "Which state describes a process waiting for an I/O event to complete?", options: ["Ready", "Running", "Blocked (waiting)", "New"], correct: "Blocked (waiting)", why: "A blocked process cannot run until its awaited event occurs." },
    ],
  },
  "Memory Management": {
    subject: "BCA302",
    questions: [
      { d: 1, type: "mcq", prompt: "What does virtual memory allow?", options: ["Running programs larger than physical RAM", "Removing the need for disks", "Unlimited CPU speed", "Storing data without addresses"], correct: "Running programs larger than physical RAM", why: "Pages are swapped between RAM and disk, so the logical space can exceed RAM." },
      { d: 2, type: "true_false", prompt: "Paging divides physical memory into fixed-size frames.", options: ["True", "False"], correct: "True", why: "Physical memory is divided into frames that match the page size." },
      { d: 3, type: "mcq", prompt: "Which page replacement algorithm evicts the page unused for the longest time?", options: ["FIFO", "LRU", "MRU", "Random"], correct: "LRU", why: "Least Recently Used evicts the page whose last use is furthest in the past." },
    ],
  },
  Deadlocks: {
    subject: "BCA302",
    questions: [
      { d: 1, type: "mcq", prompt: "Which is NOT one of the four necessary conditions for deadlock?", options: ["Mutual exclusion", "Hold and wait", "Preemptive allocation", "Circular wait"], correct: "Preemptive allocation", why: "Deadlock requires NO preemption; preemptive allocation is not a deadlock condition." },
      { d: 2, type: "true_false", prompt: "Deadlock prevention can break the hold-and-wait condition.", options: ["True", "False"], correct: "True", why: "Requiring all resources at once removes hold-and-wait." },
      { d: 3, type: "short_answer", prompt: "Name the graph used to detect deadlock from resource allocation.", correct: "Resource allocation graph", accepted: ["RAG", "resource allocation graph (RAG)", "wait-for graph"], why: "A cycle in the resource allocation graph indicates deadlock for single-instance resources." },
    ],
  },
  "HTML and CSS": {
    subject: "BCA303",
    questions: [
      { d: 1, type: "mcq", prompt: "Which tag defines the largest heading?", options: ["<h6>", "<h1>", "<head>", "<header>"], correct: "<h1>", why: "<h1> is the highest-level heading; <h6> is the lowest." },
      { d: 2, type: "true_false", prompt: "In CSS, an ID selector is written with a leading # character.", options: ["True", "False"], correct: "True", why: "#identifier selects the element with that id." },
      { d: 3, type: "mcq", prompt: "Which CSS declaration creates a flexible one-dimensional layout?", options: ["display: flex", "position: fixed", "float: none", "overflow: hidden"], correct: "display: flex", why: "display: flex creates a flex container for one-dimensional layouts." },
    ],
  },
  "JavaScript Basics": {
    subject: "BCA303",
    questions: [
      { d: 1, type: "mcq", prompt: "What does typeof null return in JavaScript?", options: ["null", "object", "undefined", "number"], correct: "object", why: "This is a long-standing quirk of JavaScript; null is a primitive." },
      { d: 2, type: "true_false", prompt: "Variables declared with const can be reassigned.", options: ["True", "False"], correct: "False", why: "const prevents reassignment of the binding (object contents may still change)." },
      { d: 3, type: "mcq", prompt: "Which array method adds an element to the end?", options: ["push()", "pop()", "shift()", "slice()"], correct: "push()", why: "push() appends; pop() removes from the end." },
    ],
  },
  "Server-side Routing": {
    subject: "BCA303",
    questions: [
      { d: 1, type: "mcq", prompt: "Which HTTP method is conventionally used to create a resource?", options: ["GET", "POST", "DELETE", "HEAD"], correct: "POST", why: "POST submits data to create a new resource." },
      { d: 2, type: "true_false", prompt: "HTTP status 404 means the server failed unexpectedly.", options: ["True", "False"], correct: "False", why: "404 means the resource was not found; 500 indicates a server error." },
      { d: 3, type: "short_answer", prompt: "Name the HTTP status code returned when a request is not authenticated.", correct: "401", accepted: ["401 Unauthorized", "Unauthorized"], why: "401 Unauthorized indicates missing or invalid authentication." },
    ],
  },
  "SDLC Models": {
    subject: "BCA304",
    questions: [
      { d: 1, type: "mcq", prompt: "Which SDLC model proceeds in strictly sequential phases?", options: ["Spiral", "Waterfall", "Agile", "Prototype"], correct: "Waterfall", why: "Waterfall completes each phase before starting the next." },
      { d: 2, type: "true_false", prompt: "The spiral model emphasises risk analysis in each iteration.", options: ["True", "False"], correct: "True", why: "Each spiral loop includes risk analysis." },
      { d: 3, type: "mcq", prompt: "Which model delivers software in short iterations and welcomes changing requirements?", options: ["Waterfall", "V-model", "Agile", "Big bang"], correct: "Agile", why: "Agile uses short iterations and adapts to change." },
    ],
  },
  "Requirement Analysis": {
    subject: "BCA304",
    questions: [
      { d: 1, type: "mcq", prompt: "Which is a functional requirement?", options: ["The system must respond within 2 seconds", "The system shall allow students to submit assignments", "The system must be available 99% of the time", "Code must follow a style guide"], correct: "The system shall allow students to submit assignments", why: "Functional requirements describe what the system does." },
      { d: 2, type: "true_false", prompt: "A use case diagram describes the internal database schema.", options: ["True", "False"], correct: "False", why: "Use case diagrams show actors and interactions, not storage structure." },
      { d: 3, type: "short_answer", prompt: "Name the document that formally records all agreed system requirements.", correct: "Software Requirement Specification", accepted: ["SRS"], why: "The SRS is the agreed record of requirements." },
    ],
  },
  "Testing Strategies": {
    subject: "BCA304",
    questions: [
      { d: 1, type: "mcq", prompt: "Which testing checks individual modules in isolation?", options: ["Unit testing", "Acceptance testing", "Load testing", "Regression testing"], correct: "Unit testing", why: "Unit tests verify the smallest testable parts in isolation." },
      { d: 2, type: "true_false", prompt: "Regression testing re-runs earlier tests after code changes.", options: ["True", "False"], correct: "True", why: "Regression tests detect unintended side effects of changes." },
      { d: 3, type: "mcq", prompt: "Which metric describes the share of code executed by tests?", options: ["Code coverage", "Cyclomatic complexity", "Defect density", "Throughput"], correct: "Code coverage", why: "Coverage measures executed lines or branches." },
    ],
  },
};

const FIRST = ["Aarav", "Vihaan", "Diya", "Ananya", "Ishaan", "Meera", "Kabir", "Saanvi", "Arjun", "Riya", "Rohan", "Priya", "Aditya", "Kavya", "Nikhil", "Sneha", "Rahul", "Pooja", "Karan", "Tanvi", "Siddharth", "Neha", "Yash", "Ishita", "Dev", "Anika", "Manav", "Sara", "Harsh", "Lakshmi"];
const LAST = ["Sharma", "Patel", "Reddy", "Iyer", "Nair", "Gupta", "Singh", "Kumar", "Das", "Menon", "Joshi", "Rao", "Verma", "Mehta", "Shah", "Pillai", "Chopra", "Bose", "Kaur", "Desai"];

async function bulkInsert(table: any, rows: Record<string, unknown>[], size = 1000) {
  for (let i = 0; i < rows.length; i += size) {
    await db.insert(table).values(rows.slice(i, i + size) as any);
  }
}

async function bulkReturning<T>(table: any, rows: Record<string, unknown>[], size = 1000): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < rows.length; i += size) {
    const res = await db.insert(table).values(rows.slice(i, i + size) as any).returning();
    out.push(...(res as T[]));
  }
  return out;
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const dayFromNow = (days: number) => new Date(Date.now() + days * 86400000);

export type SeedSummary = {
  students: number;
  teachers: number;
  subjects: number;
  exams: number;
  examResults: number;
  attendanceRecords: number;
  assignments: number;
  submissions: number;
  quizAttempts: number;
  learningActivities: number;
  labelledOutcomes: number;
  model: string | null;
  riskAssessments: number;
  alertsCreated: number;
};

/** Creates the synthetic demonstration dataset, demo accounts, a trained model and first risk assessments. */
export async function seedSyntheticDataset(opts: { reset: boolean; demoPassword: string }): Promise<SeedSummary> {
  if (!opts.demoPassword || opts.demoPassword.length < 8) throw new Error("DEMO_PASSWORD must be set to at least 8 characters");
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(S.users);
  if (n > 0 && !opts.reset) throw new Error("Data already exists. Confirm a reset to regenerate the synthetic dataset.");
  if (opts.reset) await resetAllData();

  const rand = mulberry32(SEED);
  const R = () => rand();
  const gauss = () => {
    const u = Math.max(R(), 1e-9);
    const v = R();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
  const sig = (x: number) => 1 / (1 + Math.exp(-x));
  const pick = <T,>(arr: T[]): T => arr[Math.floor(R() * arr.length)];

  const passwordHash = await hashPassword(opts.demoPassword);

  /* Institution */
  const depts = await db
    .insert(S.departments)
    .values([
      { name: "Computer Applications", code: "CA", description: "Undergraduate computing programmes" },
      { name: "Management Studies", code: "MGT", description: "Business and management programmes" },
    ])
    .returning();
  const deptCA = depts[0];
  const deptMGT = depts[1];
  const courses = await db
    .insert(S.courses)
    .values([
      { departmentId: deptCA.id, name: "Bachelor of Computer Applications", code: "BCA", durationSemesters: 6 },
      { departmentId: deptMGT.id, name: "Bachelor of Business Administration", code: "BBA", durationSemesters: 6 },
    ])
    .returning();
  const courseBy: Record<string, number> = { BCA: courses[0].id, BBA: courses[1].id };
  const now = new Date();
  const startYear = now.getMonth() >= 5 ? now.getFullYear() : now.getFullYear() - 1;
  const [year] = await db
    .insert(S.academicYears)
    .values({ label: `${startYear}-${startYear + 1}`, startDate: `${startYear}-07-01`, endDate: `${startYear + 1}-06-30`, isCurrent: true })
    .returning();

  const classDefs = [
    { code: "BCA-S1-A", name: "BCA Semester 1 - Division A", sem: 1, div: "A", course: "BCA", count: 120 },
    { code: "BCA-S2-A", name: "BCA Semester 2 - Division A", sem: 2, div: "A", course: "BCA", count: 140 },
    { code: "BCA-S3-A", name: "BCA Semester 3 - Division A", sem: 3, div: "A", course: "BCA", count: 130 },
    { code: "BCA-S3-B", name: "BCA Semester 3 - Division B", sem: 3, div: "B", course: "BCA", count: 130 },
    { code: "BBA-S1-A", name: "BBA Semester 1 - Division A", sem: 1, div: "A", course: "BBA", count: 0 },
  ];
  const classRows = await db
    .insert(S.classes)
    .values(classDefs.map((c) => ({ code: c.code, name: c.name, courseId: courseBy[c.course], academicYearId: year.id, semester: c.sem, division: c.div })))
    .returning();
  const classBy = new Map(classRows.map((c, i) => [classDefs[i].code, { id: c.id, sem: classDefs[i].sem }]));

  const subjRows = await db
    .insert(S.subjects)
    .values(SUBJECTS.map((s) => ({ code: s.code, name: s.name, courseId: courseBy[s.course], semester: s.sem, credits: 4, passMarks: 40, maxInternalMarks: 40 })))
    .returning();
  const subjBy = new Map(subjRows.map((s) => [s.code, s]));

  const topicRows = await db
    .insert(S.topics)
    .values(
      Object.entries(TOPIC_BANK).map(([name, t], i) => ({
        subjectId: subjBy.get(t.subject)!.id,
        name,
        chapterNo: (i % 3) + 1,
      })),
    )
    .returning();
  const topicBy = new Map(topicRows.map((t) => [t.name, t]));

  /* Users and demo accounts */
  const [admin, teacherUser, teacher2User, studentUser, guardianUser] = await db
    .insert(S.users)
    .values([
      { email: "admin@demo.edu", passwordHash, fullName: "System Administrator", role: "admin" },
      { email: "teacher@demo.edu", passwordHash, fullName: "Dr. Ananya Rao", role: "teacher" },
      { email: "vikram.iyer@demo.edu", passwordHash, fullName: "Prof. Vikram Iyer", role: "teacher" },
      { email: "student@demo.edu", passwordHash, fullName: "Aarav Sharma", role: "student" },
      { email: "guardian@demo.edu", passwordHash, fullName: "Priya Sharma", role: "guardian" },
    ])
    .returning();
  const [teacher1, teacher2] = await db
    .insert(S.teachers)
    .values([
      { teacherCode: "TCH-001", userId: teacherUser.id, departmentId: deptCA.id, designation: "Associate Professor", phone: "+91-90000-00001" },
      { teacherCode: "TCH-002", userId: teacher2User.id, departmentId: deptCA.id, designation: "Assistant Professor", phone: "+91-90000-00002" },
    ])
    .returning();

  /* Teacher allocations: teacher 1 -> DB & OS; teacher 2 -> Web & SE (both sem-3 divisions) */
  const allocs: { teacherId: number; subjectId: number; classId: number }[] = [];
  for (const cls of ["BCA-S3-A", "BCA-S3-B"]) {
    const c = classBy.get(cls)!;
    allocs.push({ teacherId: teacher1.id, subjectId: subjBy.get("BCA301")!.id, classId: c.id });
    allocs.push({ teacherId: teacher1.id, subjectId: subjBy.get("BCA302")!.id, classId: c.id });
    allocs.push({ teacherId: teacher2.id, subjectId: subjBy.get("BCA303")!.id, classId: c.id });
    allocs.push({ teacherId: teacher2.id, subjectId: subjBy.get("BCA304")!.id, classId: c.id });
  }
  await bulkInsert(S.teacherAssignments, allocs.map((a) => ({ ...a })));
  const teacherForSubject = (code: string) => (code === "BCA301" || code === "BCA302" ? teacher1.id : teacher2.id);
  const teacherUserFor = (code: string) => (code === "BCA301" || code === "BCA302" ? teacherUser.id : teacher2User.id);

  /* Synthetic students */
  const studentPlan: { cls: string; sem: number }[] = [];
  for (const c of classDefs) for (let i = 0; i < c.count; i++) studentPlan.push({ cls: c.code, sem: c.sem });
  // The demonstration student (SYN-0001) is placed in a semester-3 class so that quizzes, mastery and assignments are populated.
  studentPlan[0] = { cls: "BCA-S3-A", sem: 3 };
  const latent = studentPlan.map((_, i) => ({
    a: i === 0 ? 0.2 : clamp(gauss() * 0.9, -2.2, 2.2),
    g: i === 0 ? 0.85 : R(),
  }));
  const studentValues = studentPlan.map((p, i) => ({
    studentCode: i === 0 ? DEMO_STUDENT_CODE : `${SYNTHETIC_PREFIX}${String(i + 1).padStart(4, "0")}`,
    userId: i === 0 ? studentUser.id : null,
    fullName: i === 0 ? "Aarav Sharma" : `${pick(FIRST)} ${pick(LAST)}`,
    courseId: courseBy.BCA,
    classId: classBy.get(p.cls)!.id,
    academicYearId: year.id,
    currentSemester: p.sem,
    guardianName: i === 0 ? "Priya Sharma" : `Guardian of student ${i + 1}`,
    guardianEmail: i === 0 ? "guardian@demo.edu" : null,
    dailyStudyGoalMinutes: i === 0 ? 60 : 45 + Math.floor(R() * 5) * 15,
    status: "active",
  }));
  const studentRows = await bulkReturning<{ id: number; studentCode: string; currentSemester: number; classId: number }>(S.students, studentValues);
  const stu = studentRows.map((s, i) => ({ ...s, a: latent[i].a, g: latent[i].g, idx: i }));
  const demoStudentId = stu[0].id;

  const guardianRow = await db.insert(S.guardians).values({ userId: guardianUser.id, fullName: "Priya Sharma", relation: "Parent", phone: "+91-90000-00099" }).returning();
  const sec2 = stu[1];
  await db.insert(S.guardianLinks).values([
    { guardianId: guardianRow[0].id, studentId: demoStudentId, approved: true, approvedAt: new Date() },
    { guardianId: guardianRow[0].id, studentId: sec2.id, approved: false },
  ]);

  /* Subject enrolments (current semester) */
  const enrol: { studentId: number; subjectId: number }[] = [];
  for (const s of stu) {
    for (const sub of SUBJECTS) {
      if (sub.course === "BCA" && sub.sem === s.currentSemester) enrol.push({ studentId: s.id, subjectId: subjBy.get(sub.code)!.id });
    }
  }
  await bulkInsert(S.studentSubjects, enrol);

  /* Exams and results */
  const END_OFFSET: Record<number, number> = { 1: -330, 2: -200, 3: -4 };
  const subjectOffset = new Map(SUBJECTS.map((s, i) => [s.code, ((i * 7) % 9) - 4]));
  const examDefs: { subj: (typeof SUBJECTS)[number]; type: string; name: string; max: number; pass: number; date: string; status: string }[] = [];
  for (const sub of SUBJECTS) {
    if (sub.course !== "BCA") continue;
    const end = END_OFFSET[sub.sem];
    examDefs.push({ subj: sub, type: "internal_assessment", name: `${sub.code} Internal Assessment`, max: 25, pass: 10, date: isoDate(dayFromNow(end - 60)), status: "published" });
    examDefs.push({ subj: sub, type: "mid_semester", name: `${sub.code} Mid-Semester Examination`, max: 50, pass: 20, date: isoDate(dayFromNow(end - 30)), status: "published" });
    examDefs.push({ subj: sub, type: "end_semester", name: `${sub.code} End-Semester Examination`, max: 100, pass: 40, date: isoDate(dayFromNow(end)), status: "published" });
    if (sub.sem === 3) {
      examDefs.push({ subj: sub, type: "practical", name: `${sub.code} Practical Examination`, max: 25, pass: 10, date: isoDate(dayFromNow(8)), status: "scheduled" });
    }
  }
  const examRows = await bulkReturning<{ id: number; subjectId: number; examType: string; maxMarks: number }>(
    S.exams,
    examDefs.map((e) => ({
      name: e.name,
      examType: e.type,
      subjectId: subjBy.get(e.subj.code)!.id,
      classId: null,
      examDate: e.date,
      maxMarks: e.max,
      passMarks: e.pass,
      status: e.status,
      publishedAt: e.status === "published" ? new Date() : null,
      createdBy: teacherUserFor(e.subj.code),
    })),
  );
  const examSubjSem = new Map(examRows.map((e) => [e.id, SUBJECTS.find((s) => subjBy.get(s.code)!.id === e.subjectId)!.sem]));
  const examSubjCode = new Map(examRows.map((e) => [e.id, SUBJECTS.find((s) => subjBy.get(s.code)!.id === e.subjectId)!.code]));

  const resultRows: Record<string, unknown>[] = [];
  const endPct = new Map<string, number>(); // `${studentId}:${subjectCode}` -> end-semester pct
  const baseSubj = new Map<string, number>();
  for (const s of stu) {
    for (const sub of SUBJECTS) {
      if (sub.course !== "BCA" || sub.sem > s.currentSemester) continue;
      baseSubj.set(`${s.id}:${sub.code}`, clamp(56 + 14 * s.a + gauss() * 5 + (subjectOffset.get(sub.code) ?? 0), 0, 100));
    }
  }
  for (const e of examRows) {
    const code = examSubjCode.get(e.id)!;
    const sem = examSubjSem.get(e.id)!;
    if (code && e.examType === "practical") continue;
    for (const s of stu) {
      if (sem > s.currentSemester) continue;
      const base = baseSubj.get(`${s.id}:${code}`) ?? 50;
      const pct = clamp(base + gauss() * (e.examType === "end_semester" ? 4 : 6), 0, 100);
      const missing = R() < 0.05 && e.examType !== "end_semester";
      const marks = missing ? null : Math.round((pct / 100) * e.maxMarks * 10) / 10;
      if (e.examType === "end_semester" && marks !== null) endPct.set(`${s.id}:${code}`, (marks / e.maxMarks) * 100);
      resultRows.push({
        examId: e.id,
        studentId: s.id,
        marksObtained: marks,
        attendanceStatus: "present",
        remarks: missing ? "Mark not yet entered (synthetic missing value)" : null,
      });
    }
  }
  await bulkInsert(S.examResults, resultRows);

  /* Historical outcome labels (synthetic): at risk if the end-semester average < 42% or >= 2 subjects below pass mark */
  const outcomes: Record<string, unknown>[] = [];
  for (const s of stu) {
    const pcts = SUBJECTS.filter((x) => x.course === "BCA" && x.sem === s.currentSemester)
      .map((x) => endPct.get(`${s.id}:${x.code}`))
      .filter((v): v is number => typeof v === "number");
    if (pcts.length < 2) continue;
    const avg = pcts.reduce((a, b) => a + b, 0) / pcts.length;
    const failing = pcts.filter((p) => p < 40).length;
    outcomes.push({
      studentId: s.id,
      semester: s.currentSemester,
      outcome: avg < 42 || failing >= 2 ? "at_risk" : "on_track",
      source: "synthetic",
      averagePct: Math.round(avg * 10) / 10,
    });
  }
  await bulkInsert(S.academicOutcomes, outcomes);

  /* Attendance */
  const sessionDefs: Record<string, unknown>[] = [];
  for (const cls of classDefs.filter((c) => c.count > 0)) {
    const c = classBy.get(cls.code)!;
    for (const sub of SUBJECTS.filter((x) => x.course === "BCA" && x.sem === cls.sem)) {
      for (let k = 0; k < 12; k++) {
        sessionDefs.push({
          subjectId: subjBy.get(sub.code)!.id,
          classId: c.id,
          teacherId: teacherForSubject(sub.code),
          sessionDate: isoDate(dayFromNow(-60 + k * 5)),
          createdBy: teacherUserFor(sub.code),
        });
      }
    }
  }
  const sessions = await bulkReturning<{ id: number; subjectId: number; classId: number }>(S.attendanceSessions, sessionDefs);
  const attRows: Record<string, unknown>[] = [];
  for (const sess of sessions) {
    const sub = SUBJECTS.find((x) => subjBy.get(x.code)!.id === sess.subjectId)!;
    for (const s of stu.filter((x) => x.classId === sess.classId)) {
      const p = clamp(0.8 + 0.06 * s.a + 0.12 * (s.g - 0.5) + gauss() * 0.04, 0.4, 0.98);
      const u = R();
      const status = u < p * 0.94 ? "present" : u < p * 0.94 + 0.03 ? "late" : u < 0.97 ? "absent" : "excused";
      attRows.push({ sessionId: sess.id, studentId: s.id, status, remarks: null });
      void sub;
    }
  }
  await bulkInsert(S.attendanceRecords, attRows);

  /* Assignments (sem-3 divisions only; earlier semesters have no LMS assignments, so those values stay missing) */
  const asgDefs: Record<string, unknown>[] = [];
  const asgMeta: { subjectCode: string; classId: number; deadline: Date; past: boolean }[] = [];
  for (const cls of ["BCA-S3-A", "BCA-S3-B"]) {
    const c = classBy.get(cls)!;
    for (const code of ["BCA301", "BCA302", "BCA303", "BCA304"]) {
      const specs = [
        { title: `${code} Lab Assignment 1`, days: -40, past: true },
        { title: `${code} Lab Assignment 2`, days: -20, past: true },
        { title: `${code} Case Study`, days: 6, past: false },
      ];
      for (const sp of specs) {
        const deadline = dayFromNow(sp.days);
        asgDefs.push({
          title: sp.title,
          subjectId: subjBy.get(code)!.id,
          classId: c.id,
          instructions: `Complete the ${sp.title.toLowerCase()} as described in class. Submit a document (PDF, DOCX or TXT) or type your answer directly. Late submissions are accepted and flagged.`,
          deadline,
          maxMarks: 10,
          allowResubmission: sp.past,
          createdBy: teacherUserFor(code),
        });
        asgMeta.push({ subjectCode: code, classId: c.id, deadline, past: sp.past });
      }
    }
  }
  const asgRows = await bulkReturning<{ id: number; classId: number; deadline: Date }>(S.assignments, asgDefs);
  const subRows: Record<string, unknown>[] = [];
  for (const a of asgRows) {
    const past = a.deadline.getTime() < Date.now();
    for (const s of stu.filter((x) => x.classId === a.classId)) {
      const pSub = clamp(0.35 + 0.3 * s.g + 0.1 * s.a, 0.05, 0.98);
      if (R() > pSub) continue;
      const late = R() < 0.12;
      const submittedAt = new Date(a.deadline.getTime() + (late ? 3600000 * (2 + R() * 30) : -3600000 * (1 + R() * 40)));
      const marks = past ? clamp(Math.round(5 + 2 * s.a + gauss() * 1.5), 0, 10) : null;
      subRows.push({
        assignmentId: a.id,
        studentId: s.id,
        submissionText: "Submitted via the student portal.",
        submittedAt,
        isLate: late,
        attemptNo: 1,
        status: past ? "graded" : "submitted",
        marks,
        feedback: past ? (marks !== null && marks >= 7 ? "Well structured. Keep it up." : "Review the core concepts and add more examples.") : null,
        gradedAt: past ? new Date() : null,
        gradedBy: past ? teacherUserFor("BCA301") : null,
      });
    }
  }
  await bulkInsert(S.assignmentSubmissions, subRows);

  /* Question bank and quizzes */
  const qRows: Record<string, unknown>[] = [];
  for (const [topicName, t] of Object.entries(TOPIC_BANK)) {
    for (const q of t.questions) {
      qRows.push({
        subjectId: subjBy.get(t.subject)!.id,
        topicId: topicBy.get(topicName)!.id,
        questionType: q.type,
        difficulty: q.d,
        prompt: q.prompt,
        options: q.options ?? [],
        correctAnswer: q.correct,
        acceptedAnswers: q.accepted ?? [],
        explanation: q.why,
        createdBy: teacherUserFor(t.subject),
      });
    }
  }
  const qInserted = await bulkReturning<{ id: number; topicId: number; difficulty: number; questionType: string; prompt: string }>(S.questions, qRows);
  const quizDefs = Object.keys(TOPIC_BANK).map((name) => ({
    title: `Practice: ${name}`,
    subjectId: subjBy.get(TOPIC_BANK[name].subject)!.id,
    topicId: topicBy.get(name)!.id,
    timeLimitSeconds: 300,
    questionCount: 3,
    isPublished: true,
    createdBy: teacherUserFor(TOPIC_BANK[name].subject),
  }));
  const quizRows = await bulkReturning<{ id: number; topicId: number }>(S.quizzes, quizDefs);
  const quizByTopic = new Map(quizRows.map((q) => [q.topicId, q]));
  const qByTopic = new Map<number, typeof qInserted>();
  for (const q of qInserted) qByTopic.set(q.topicId, [...(qByTopic.get(q.topicId) ?? []), q]);
  const subjectQuizDefs = ["BCA301", "BCA302", "BCA303", "BCA304"].map((code) => ({
    title: `Mixed practice: ${subjBy.get(code)!.name}`,
    subjectId: subjBy.get(code)!.id,
    topicId: null,
    timeLimitSeconds: 600,
    questionCount: 5,
    isPublished: true,
    createdBy: teacherUserFor(code),
  }));
  await bulkInsert(S.quizzes, subjectQuizDefs);

  /* Quiz attempts, answers and topic mastery */
  const attemptRows: Record<string, unknown>[] = [];
  const attemptMeta: { studentId: number; topicId: number; startedAt: Date; score: number; difficulties: number[] }[] = [];
  const answerMeta = new Map<number, { q: (typeof qInserted)[number]; given: string; correct: boolean }[]>();
  const topicQuizzes = [...quizByTopic.values()];
  for (const s of stu.filter((x) => x.currentSemester === 3)) {
    for (const quiz of topicQuizzes) {
      const topicEntry = topicRows.find((t) => t.id === quiz.topicId)!;
      if (R() > 0.2 + 0.5 * s.g) continue;
      const qs = (qByTopic.get(quiz.topicId) ?? []).slice().sort((x, y) => x.difficulty - y.difficulty);
      const startedAt = new Date(Date.now() - R() * 55 * 86400000);
      const difficulties = qs.map((q) => q.difficulty);
      let score = 0;
      const answers: { q: (typeof qInserted)[number]; given: string; correct: boolean }[] = [];
      for (const q of qs) {
        const pCorrect = sig(1.4 * s.a - 0.6 * (q.difficulty - 1) + 0.2 * gauss());
        const correct = R() < pCorrect;
        const source = TOPIC_BANK[topicEntry.name].questions.find((x) => x.prompt === q.prompt)!;
        let given: string;
        if (correct) given = source.correct;
        else if (source.type === "true_false") given = source.correct === "True" ? "False" : "True";
        else if (source.type === "short_answer") given = "not sure";
        else given = (source.options ?? []).find((o) => o !== source.correct) ?? "";
        if (correct) score += 1;
        answers.push({ q, given, correct });
      }
      attemptRows.push({
        quizId: quiz.id,
        studentId: s.id,
        status: "submitted",
        startedAt,
        deadline: new Date(startedAt.getTime() + 300000),
        submittedAt: new Date(startedAt.getTime() + (120 + R() * 170) * 1000),
        score,
        maxScore: qs.length,
        percentage: Math.round((score / Math.max(qs.length, 1)) * 1000) / 10,
        startDifficulty: 2,
        endDifficulty: score / Math.max(qs.length, 1) >= 0.8 ? 3 : score / Math.max(qs.length, 1) <= 0.4 ? 1 : 2,
      });
      attemptMeta.push({ studentId: s.id, topicId: quiz.topicId, startedAt, score, difficulties });
      answerMeta.set(attemptMeta.length - 1, answers);
    }
  }
  const attemptInserted = await bulkReturning<{ id: number }>(S.quizAttempts, attemptRows);
  const answerRows: Record<string, unknown>[] = [];
  attemptInserted.forEach((att, idx) => {
    (answerMeta.get(idx) ?? []).forEach((a, pos) => {
      answerRows.push({
        attemptId: att.id,
        questionId: a.q.id,
        position: pos + 1,
        difficulty: a.q.difficulty,
        givenAnswer: a.given,
        isCorrect: a.correct,
        marksAwarded: a.correct ? 1 : 0,
        needsReview: false,
      });
    });
  });
  await bulkInsert(S.quizAnswers, answerRows);

  // Mastery: fold attempts in time order using the same update rule as the live engine.
  const masteryRows: Record<string, unknown>[] = [];
  const thresholds = DEFAULT_SETTINGS.masteryThresholds;
  const byKey = new Map<string, NonNullable<ReturnType<typeof computeMasteryUpdate>>>();
  attemptMeta
    .map((m, i) => ({ ...m, i }))
    .sort((x, y) => x.startedAt.getTime() - y.startedAt.getTime())
    .forEach((m) => {
      const key = `${m.studentId}:${m.topicId}`;
      const prev = byKey.get(key) ?? null;
      const upd = computeMasteryUpdate(prev, { attempted: m.difficulties.length, correct: m.score }, thresholds, isoDate(m.startedAt));
      if (upd) byKey.set(key, upd);
    });
  for (const [key, v] of byKey) {
    const [studentId, topicId] = key.split(":").map(Number);
    const topic = topicRows.find((t) => t.id === topicId)!;
    masteryRows.push({
      studentId,
      topicId,
      subjectId: subjBy.get(TOPIC_BANK[topic.name].subject)!.id,
      attempted: v.attempted,
      correct: v.correct,
      masteryScore: v.masteryScore,
      level: v.level,
      trend: v.trend,
      history: v.history,
    });
  }
  await bulkInsert(S.topicMastery, masteryRows);

  /* Learning activity (some students have no logs: a genuine missing-data case) */
  const actRows: Record<string, unknown>[] = [];
  const actTypes = ["study_session", "video", "reading", "practice"];
  for (const s of stu) {
    if (s.idx !== 0 && R() < 0.06) continue;
    const subjectIds = enrol.filter((e) => e.studentId === s.id).map((e) => e.subjectId);
    for (let d = 0; d < 28; d++) {
      if (s.idx !== 0 && R() > 0.2 + 0.6 * s.g) continue;
      actRows.push({
        studentId: s.id,
        subjectId: subjectIds.length ? pick(subjectIds) : null,
        activityType: pick(actTypes),
        minutes: Math.round(15 + R() * (40 + 80 * s.g)),
        activityDate: isoDate(dayFromNow(-d)),
      });
    }
  }
  await bulkInsert(S.learningActivities, actRows);

  /* Interventions for the five weakest current-semester students (teacher observations are private) */
  const weakest = stu.filter((s) => s.currentSemester === 3).sort((x, y) => x.a - y.a).slice(0, 5);
  for (let i = 0; i < weakest.length; i++) {
    const s = weakest[i];
    const [iv] = await db
      .insert(S.interventions)
      .values({
        studentId: s.id,
        createdBy: teacherUser.id,
        status: i % 2 === 0 ? "in_progress" : "pending",
        plan: "Two supervised revision sessions per week on Database Systems and Operating Systems, plus the topic revision quizzes.",
        target: "Raise attendance to the institutional target and reach 60% in practice quizzes.",
        improvementTargetPct: 10,
        followUpDate: isoDate(dayFromNow(14)),
      })
      .returning();
    await db.insert(S.interventionHistory).values([
      { interventionId: iv.id, status: "pending", kind: "status_change", note: "Case opened after early-warning review.", changedBy: teacherUser.id },
      { interventionId: iv.id, status: iv.status, kind: "support_session", note: "Initial support session held.", changedBy: teacherUser.id },
    ]);
    await db.insert(S.teacherObservations).values({
      studentId: s.id,
      authorId: teacherUser.id,
      interventionId: iv.id,
      body: "Engaged in class discussions but submits assignments late. PRIVATE observation for staff only.",
      visibility: "private",
    });
  }

  /* Resource library */
  const resDefs = [
    { title: "SQL Joins Cheat Sheet", description: "Visual summary of inner, left, right and full joins with examples.", resourceType: "note", subjectId: subjBy.get("BCA301")!.id, topicId: topicBy.get("SQL Queries")!.id, difficulty: "easy", status: "approved", externalUrl: null },
    { title: "Normalization theory (reference)", description: "Reference article covering 1NF to BCNF.", resourceType: "reference", subjectId: subjBy.get("BCA301")!.id, topicId: topicBy.get("Normalization")!.id, difficulty: "medium", status: "approved", externalUrl: "https://en.wikipedia.org/wiki/Database_normalization" },
    { title: "W3Schools SQL Tutorial", description: "Interactive SQL tutorial for beginners.", resourceType: "external_link", subjectId: subjBy.get("BCA301")!.id, topicId: topicBy.get("SQL Queries")!.id, difficulty: "easy", status: "approved", externalUrl: "https://www.w3schools.com/sql/" },
    { title: "CPU scheduling algorithms (video search)", description: "Video explanations of FCFS, SJF and Round Robin.", resourceType: "video", subjectId: subjBy.get("BCA302")!.id, topicId: topicBy.get("Process Scheduling")!.id, difficulty: "medium", status: "approved", externalUrl: "https://www.youtube.com/results?search_query=cpu+scheduling+algorithms" },
    { title: "Deadlock practice set", description: "Practice exercises on Coffman conditions and resource allocation graphs.", resourceType: "practice", subjectId: subjBy.get("BCA302")!.id, topicId: topicBy.get("Deadlocks")!.id, difficulty: "hard", status: "approved", externalUrl: null },
    { title: "MDN: Getting started with the web", description: "Official introduction to HTML, CSS and JavaScript.", resourceType: "external_link", subjectId: subjBy.get("BCA303")!.id, topicId: topicBy.get("HTML and CSS")!.id, difficulty: "easy", status: "approved", externalUrl: "https://developer.mozilla.org/en-US/docs/Learn/Getting_started_with_the_web" },
    { title: "JavaScript basics video search", description: "Short lectures on variables, types and functions.", resourceType: "video", subjectId: subjBy.get("BCA303")!.id, topicId: topicBy.get("JavaScript Basics")!.id, difficulty: "easy", status: "approved", externalUrl: "https://www.youtube.com/results?search_query=javascript+basics" },
    { title: "Software testing overview", description: "Overview of unit, integration and system testing.", resourceType: "reference", subjectId: subjBy.get("BCA304")!.id, topicId: topicBy.get("Testing Strategies")!.id, difficulty: "medium", status: "approved", externalUrl: "https://en.wikipedia.org/wiki/Software_testing" },
    { title: "Deadlock detection worked examples", description: "Worked examples of resource allocation graphs (awaiting approval).", resourceType: "note", subjectId: subjBy.get("BCA302")!.id, topicId: topicBy.get("Deadlocks")!.id, difficulty: "hard", status: "pending", externalUrl: null },
    { title: "Requirements checklist", description: "Checklist for elicitation and SRS review (awaiting approval).", resourceType: "note", subjectId: subjBy.get("BCA304")!.id, topicId: topicBy.get("Requirement Analysis")!.id, difficulty: "medium", status: "pending", externalUrl: null },
  ];
  await db.insert(S.learningResources).values(
    resDefs.map((r) => ({ ...r, uploadedBy: teacherUser.id, approvedBy: r.status === "approved" ? admin.id : null })),
  );

  /* Timetable and academic calendar */
  const ttRows: Record<string, unknown>[] = [];
  const slotsA = ["09:00-10:00", "10:00-11:00", "11:00-12:00", "12:00-13:00"];
  const slotsB = ["14:00-15:00", "15:00-16:00", "16:00-17:00", "17:00-18:00"];
  const sem3Codes = ["BCA301", "BCA302", "BCA303", "BCA304"];
  for (const [clsCode, slots] of [["BCA-S3-A", slotsA], ["BCA-S3-B", slotsB]] as const) {
    for (let day = 1; day <= 5; day++) {
      slots.forEach((slot, k) => {
        const code = sem3Codes[(day + k) % 4];
        const [start, end] = slot.split("-");
        ttRows.push({
          classId: classBy.get(clsCode)!.id,
          subjectId: subjBy.get(code)!.id,
          teacherId: teacherForSubject(code),
          dayOfWeek: day,
          startTime: start,
          endTime: end,
          room: `Lab ${k + 1}`,
        });
      });
    }
  }
  await bulkInsert(S.timetableEntries, ttRows);
  await db.insert(S.academicEvents).values([
    { title: "Founders' Day holiday", eventType: "holiday", eventDate: isoDate(dayFromNow(14)), description: "Institution closed.", createdBy: admin.id },
    { title: "Internal assessment week", eventType: "exam", eventDate: isoDate(dayFromNow(25)), endDate: isoDate(dayFromNow(29)), description: "Internal assessments for Semester 3.", createdBy: admin.id },
    { title: "Web Technologies case study deadline", eventType: "deadline", eventDate: isoDate(dayFromNow(6)), description: "Submit the case study on the portal.", createdBy: teacherUser.id },
    { title: "Annual technology festival", eventType: "event", eventDate: isoDate(dayFromNow(40)), description: "Student project showcase.", createdBy: admin.id },
    { title: "Semester break", eventType: "holiday", eventDate: isoDate(dayFromNow(60)), endDate: isoDate(dayFromNow(74)), description: "No classes.", createdBy: admin.id },
  ]);

  /* Welcome notifications */
  await db.insert(S.notifications).values([
    { userId: studentUser.id, title: "Welcome to your learning dashboard", message: "Your synthetic demonstration account is ready. Explore your results, quizzes and plan.", category: "general", link: "/student" },
    { userId: studentUser.id, title: "Practical examination scheduled", message: "Practical examinations are scheduled in 8 days. Check the exam calendar.", category: "exam", link: "/exams" },
    { userId: teacherUser.id, title: "Early-warning review", message: "Students with open alerts are listed in Early Warnings.", category: "risk_alert", link: "/alerts" },
    { userId: guardianUser.id, title: "Guardian access approved", message: "Your link to the demonstration student's record is approved.", category: "general", link: "/guardian" },
  ]);

  /* Post-seed: train model, score all students, screen for alerts, and generate demo recommendations */
  const model = await trainRiskModel(admin.id, undefined);
  const assessed = await runRiskAssessments(undefined);
  const scan = await runEarlyWarningScan(undefined);
  await generateRecommendations(demoStudentId);
  for (const s of stu.slice(0, 25)) await generateRecommendations(s.id);

  await audit(null, "seed.synthetic_dataset", "system", null, { students: stu.length, demoAccounts: 5, synthetic: true });

  return {
    students: stu.length,
    teachers: 2,
    subjects: SUBJECTS.length,
    exams: examRows.length,
    examResults: resultRows.length,
    attendanceRecords: attRows.length,
    assignments: asgRows.length,
    submissions: subRows.length,
    quizAttempts: attemptRows.length,
    learningActivities: actRows.length,
    labelledOutcomes: outcomes.length,
    model: model?.name ?? null,
    riskAssessments: assessed.count,
    alertsCreated: scan.created,
  };
}

export const DEMO_ACCOUNTS = [
  { role: "admin", email: "admin@demo.edu" },
  { role: "teacher", email: "teacher@demo.edu" },
  { role: "student", email: "student@demo.edu" },
  { role: "guardian", email: "guardian@demo.edu" },
  { role: "teacher", email: "vikram.iyer@demo.edu" },
];
