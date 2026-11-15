import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { examResults, exams, studentSubjects, students, subjects, users, guardians, guardianLinks } from "@/db/schema";
import { ApiError, assertSameOrigin, handle, jsonOk, paramNumber, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { audit, notifyStudentAndGuardians } from "@/lib/events";
import { classesForSubject } from "@/lib/api-helpers";
import { getSettings, gradeFor } from "@/lib/settings";
import { EXAM_TYPES } from "@/lib/constants";

export const dynamic = "force-dynamic";

async function loadExam(id: number) {
  const [exam] = await db.select().from(exams).where(eq(exams.id, id)).limit(1);
  if (!exam) throw new ApiError(404, "Examination not found");
  return exam;
}

/** Students eligible for a subject's marks entry: enrolled, and inside the caller's allocated classes. */
async function eligibleStudents(subjectId: number, classIds: number[] | "all", examClassId: number | null) {
  const rows = await db
    .select({ id: students.id, studentCode: students.studentCode, fullName: students.fullName, classId: students.classId, status: students.status })
    .from(students)
    .innerJoin(studentSubjects, and(eq(studentSubjects.studentId, students.id), eq(studentSubjects.subjectId, subjectId)));
  return rows.filter(
    (s) =>
      s.status === "active" &&
      (examClassId === null || s.classId === examClassId) &&
      (classIds === "all" || (s.classId !== null && classIds.includes(s.classId))),
  );
}

export const GET = handle(async (_req, ctx) => {
  const user = await requireUser(["admin", "teacher"]);
  const id = paramNumber((await ctx.params).id);
  const exam = await loadExam(id);
  const [subject] = await db.select().from(subjects).where(eq(subjects.id, exam.subjectId)).limit(1);
  const classScope = await classesForSubject(user, exam.subjectId);
  if (classScope !== "all" && classScope.length === 0) throw new ApiError(403, "You are not allocated to this subject");
  const eligible = await eligibleStudents(exam.subjectId, classScope, exam.classId);
  const results = await db.select().from(examResults).where(eq(examResults.examId, id));
  const byStudent = new Map(results.map((r) => [r.studentId, r]));
  const settings = await getSettings();
  return jsonOk({
    exam: { ...exam, subjectCode: subject?.code, subjectName: subject?.name },
    rows: eligible.map((s) => {
      const r = byStudent.get(s.id);
      const pct = r?.marksObtained !== null && r?.marksObtained !== undefined ? (r.marksObtained / exam.maxMarks) * 100 : null;
      return {
        studentId: s.id,
        resultId: r?.id ?? null,
        studentCode: s.studentCode,
        fullName: s.fullName,
        marks: r?.marksObtained ?? null,
        attendanceStatus: r?.attendanceStatus ?? "present",
        remarks: r?.remarks ?? null,
        percentage: pct === null ? null : Math.round(pct * 10) / 10,
        grade: pct === null ? null : gradeFor(pct, settings.gradingScale).grade,
        passed: r?.marksObtained === null || r?.marksObtained === undefined ? null : r.marksObtained >= exam.passMarks,
      };
    }),
  });
});

const marksSchema = z.object({
  results: z
    .array(
      z.object({
        studentId: z.coerce.number().int().positive(),
        marks: z.coerce.number().min(0).nullable(),
        attendanceStatus: z.enum(["present", "absent"]).default("present"),
        remarks: z.string().trim().max(200).optional().nullable(),
      }),
    )
    .min(1),
});

/** Marks entry. A blank mark is stored as NULL ("not entered"), never as zero. */
export const PUT = handle(async (req, ctx) => {
  assertSameOrigin(req);
  const user = await requireUser(["admin", "teacher"]);
  const id = paramNumber((await ctx.params).id);
  const exam = await loadExam(id);
  if (exam.status === "published") throw new ApiError(409, "Results are published. Submit a correction request instead.");
  const classScope = await classesForSubject(user, exam.subjectId);
  if (classScope !== "all" && classScope.length === 0) throw new ApiError(403, "You are not allocated to this subject");
  const body = await readJson(req, marksSchema);
  const eligible = new Set((await eligibleStudents(exam.subjectId, classScope, exam.classId)).map((s) => s.id));
  for (const r of body.results) {
    if (!eligible.has(r.studentId)) throw new ApiError(400, `Student ${r.studentId} is not eligible for this examination`);
    if (r.marks !== null && r.marks > exam.maxMarks) throw new ApiError(400, `Marks cannot exceed ${exam.maxMarks}`);
  }
  await db.transaction(async (tx) => {
    for (const r of body.results) {
      const marks = r.attendanceStatus === "absent" ? null : r.marks;
      await tx
        .insert(examResults)
        .values({
          examId: id,
          studentId: r.studentId,
          marksObtained: marks,
          attendanceStatus: r.attendanceStatus,
          remarks: r.remarks || (marks === null ? "Mark not entered" : null),
          enteredBy: user.id,
        })
        .onConflictDoUpdate({
          target: [examResults.examId, examResults.studentId],
          set: { marksObtained: marks, attendanceStatus: r.attendanceStatus, remarks: r.remarks || null, enteredBy: user.id, updatedAt: new Date() },
        });
    }
    if (exam.status === "scheduled") await tx.update(exams).set({ status: "marks_entry" }).where(eq(exams.id, id));
  });
  await audit({ id: user.id, role: user.role }, "exam.marks", "exam", id, { rows: body.results.length });
  return jsonOk({ ok: true, saved: body.results.length });
});

const actionSchema = z.object({ action: z.enum(["publish", "unpublish"]) });

/** Publishing makes results visible to students and linked guardians and notifies them. */
export const PATCH = handle(async (req, ctx) => {
  assertSameOrigin(req);
  const user = await requireUser(["admin", "teacher"]);
  const id = paramNumber((await ctx.params).id);
  const exam = await loadExam(id);
  const classScope = await classesForSubject(user, exam.subjectId);
  if (classScope !== "all" && classScope.length === 0) throw new ApiError(403, "You are not allocated to this subject");
  const body = await readJson(req, actionSchema);
  if (body.action === "publish") {
    const entered = await db
      .select({ id: examResults.id })
      .from(examResults)
      .where(and(eq(examResults.examId, id), eq(examResults.attendanceStatus, "present")));
    if (entered.length === 0) throw new ApiError(409, "Enter marks before publishing results");
    await db.update(exams).set({ status: "published", publishedAt: new Date() }).where(eq(exams.id, id));
    const [subject] = await db.select({ code: subjects.code }).from(subjects).where(eq(subjects.id, exam.subjectId)).limit(1);
    const rows = await db
      .select({ id: examResults.studentId })
      .from(examResults)
      .where(eq(examResults.examId, id));
    for (const r of rows) {
      await notifyStudentAndGuardians(r.id, {
        title: "Results published",
        message: `${exam.name} (${subject?.code ?? ""}) results are now available.`,
        category: "results",
        link: "/exams",
      });
    }
  } else {
    await db.update(exams).set({ status: "marks_entry", publishedAt: null }).where(eq(exams.id, id));
  }
  await audit({ id: user.id, role: user.role }, `exam.${body.action}`, "exam", id, {});
  return jsonOk({ ok: true, status: body.action === "publish" ? "published" : "marks_entry" });
});
