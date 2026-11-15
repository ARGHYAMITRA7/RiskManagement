import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { assignmentSubmissions, assignments, students, subjects } from "@/db/schema";
import { ApiError, assertSameOrigin, handle, jsonOk, paramNumber } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { assertTeacherClassSubject, getStudentForUser } from "@/lib/access";
import { audit } from "@/lib/events";
import { parseBody } from "@/lib/api-helpers";
import { saveUpload } from "@/lib/uploads";

export const dynamic = "force-dynamic";

async function loadAssignment(id: number) {
  const [a] = await db
    .select({ a: assignments, subjectCode: subjects.code, subjectName: subjects.name })
    .from(assignments)
    .innerJoin(subjects, eq(subjects.id, assignments.subjectId))
    .where(eq(assignments.id, id))
    .limit(1);
  if (!a) throw new ApiError(404, "Assignment not found");
  return a;
}

export const GET = handle(async (_req, ctx) => {
  const user = await requireUser(["admin", "teacher", "student"]);
  const id = paramNumber((await ctx.params).id);
  const { a, subjectCode, subjectName } = await loadAssignment(id);
  const base = { ...a, subjectCode, subjectName, overdue: a.deadline.getTime() < Date.now() };
  if (user.role === "student") {
    const me = await getStudentForUser(user.id);
    if (!me || me.classId !== a.classId) throw new ApiError(403, "This assignment is not set for your class");
    const [mine] = await db.select().from(assignmentSubmissions).where(and(eq(assignmentSubmissions.assignmentId, id), eq(assignmentSubmissions.studentId, me.id))).limit(1);
    return jsonOk({ assignment: base, mySubmission: mine ?? null });
  }
  await assertTeacherClassSubject(user, a.subjectId, a.classId ?? 0).catch((e) => {
    if (user.role !== "admin") throw e;
  });
  const subs = await db
    .select({
      id: assignmentSubmissions.id,
      studentId: assignmentSubmissions.studentId,
      studentCode: students.studentCode,
      fullName: students.fullName,
      submissionText: assignmentSubmissions.submissionText,
      fileName: assignmentSubmissions.fileName,
      filePath: assignmentSubmissions.filePath,
      submittedAt: assignmentSubmissions.submittedAt,
      isLate: assignmentSubmissions.isLate,
      attemptNo: assignmentSubmissions.attemptNo,
      status: assignmentSubmissions.status,
      marks: assignmentSubmissions.marks,
      feedback: assignmentSubmissions.feedback,
    })
    .from(assignmentSubmissions)
    .innerJoin(students, eq(students.id, assignmentSubmissions.studentId))
    .where(eq(assignmentSubmissions.assignmentId, id));
  const roster = a.classId
    ? await db
        .select({ id: students.id, studentCode: students.studentCode, fullName: students.fullName })
        .from(students)
        .where(and(eq(students.classId, a.classId), eq(students.status, "active")))
    : [];
  const byStudent = new Map(subs.map((s) => [s.studentId, s]));
  return jsonOk({
    assignment: base,
    submissions: subs,
    // Students without a submission are listed as "not submitted"; they are not assumed to be zero.
    notSubmitted: roster.filter((r) => !byStudent.has(r.id)),
  });
});

const submitSchema = z.object({ submissionText: z.string().trim().max(5000).optional().nullable() });

/** Student submission: text and/or a validated document. Late submissions are accepted and flagged. */
export const POST = handle(async (req, ctx) => {
  assertSameOrigin(req);
  const user = await requireUser(["student"]);
  const id = paramNumber((await ctx.params).id);
  const { a } = await loadAssignment(id);
  const me = await getStudentForUser(user.id);
  if (!me || me.classId !== a.classId) throw new ApiError(403, "This assignment is not set for your class");
  const { json, files } = await parseBody(req);
  const body = submitSchema.parse(json);
  const file = files.submission;
  const hasFile = file instanceof File;
  if (!hasFile && !body.submissionText) throw new ApiError(400, "Add a written answer or attach a document");

  const [existing] = await db
    .select()
    .from(assignmentSubmissions)
    .where(and(eq(assignmentSubmissions.assignmentId, id), eq(assignmentSubmissions.studentId, me.id)))
    .limit(1);
  // Resubmission is only possible when the assignment allows it (or the teacher requested one).
  if (existing && !a.allowResubmission && existing.status !== "resubmission_requested") {
    throw new ApiError(409, "You have already submitted this assignment");
  }

  let stored: { relPath: string; fileName: string; mimeType: string; size: number } | null = null;
  if (hasFile) stored = await saveUpload(file as File, "document", "submissions");

  const now = new Date();
  const isLate = now.getTime() > a.deadline.getTime();
  const values = {
    submissionText: body.submissionText || existing?.submissionText || null,
    filePath: stored?.relPath ?? existing?.filePath ?? null,
    fileName: stored?.fileName ?? existing?.fileName ?? null,
    mimeType: stored?.mimeType ?? existing?.mimeType ?? null,
    fileSize: stored?.size ?? existing?.fileSize ?? null,
    submittedAt: now,
    isLate,
    status: "submitted",
    marks: null,
    feedback: null,
    gradedAt: null,
    gradedBy: null,
    updatedAt: now,
  };
  let row;
  if (existing) {
    [row] = await db
      .update(assignmentSubmissions)
      .set({ ...values, attemptNo: existing.attemptNo + 1 })
      .where(eq(assignmentSubmissions.id, existing.id))
      .returning();
  } else {
    [row] = await db
      .insert(assignmentSubmissions)
      .values({ ...values, assignmentId: id, studentId: me.id, attemptNo: 1 })
      .returning();
  }
  await audit({ id: user.id, role: user.role }, "assignment.submit", "assignment_submission", row.id, { late: isLate, attempt: row.attemptNo });
  return jsonOk(row, existing ? 200 : 201);
});
