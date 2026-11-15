import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { examCorrections, examResults, exams, students, subjects } from "@/db/schema";
import { ApiError, assertSameOrigin, handle, jsonOk, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { audit, notifyUsers } from "@/lib/events";
import { classesForSubject } from "@/lib/api-helpers";
import { users } from "@/db/schema";

export const dynamic = "force-dynamic";

/** Correction workflow: teacher requests -> administrator approves or rejects -> marks update is audited. */
export const GET = handle(async (req) => {
  const user = await requireUser(["admin", "teacher"]);
  const status = new URL(req.url).searchParams.get("status") ?? "pending";
  const rows = await db
    .select({
      id: examCorrections.id,
      resultId: examCorrections.resultId,
      oldMarks: examCorrections.oldMarks,
      newMarks: examCorrections.newMarks,
      reason: examCorrections.reason,
      status: examCorrections.status,
      createdAt: examCorrections.createdAt,
      examName: exams.name,
      subjectId: exams.subjectId,
      subjectCode: subjects.code,
      studentCode: students.studentCode,
      studentName: students.fullName,
      maxMarks: exams.maxMarks,
    })
    .from(examCorrections)
    .innerJoin(examResults, eq(examResults.id, examCorrections.resultId))
    .innerJoin(exams, eq(exams.id, examResults.examId))
    .innerJoin(subjects, eq(subjects.id, exams.subjectId))
    .innerJoin(students, eq(students.id, examResults.studentId))
    .where(sql`${examCorrections.status} = ${status}`)
    .orderBy(desc(examCorrections.createdAt));
  if (user.role === "admin") return jsonOk({ items: rows });
  const visible: typeof rows = [];
  for (const r of rows) {
    const scope = await classesForSubject(user, r.subjectId);
    if (scope === "all" || scope.length > 0) visible.push(r);
  }
  return jsonOk({ items: visible });
});

const requestSchema = z.object({
  resultId: z.coerce.number().int().positive(),
  newMarks: z.coerce.number().min(0),
  reason: z.string().trim().min(10, "Explain the correction (min 10 characters)").max(500),
});

export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const user = await requireUser(["admin", "teacher"]);
  const body = await readJson(req, requestSchema);
  const [result] = await db
    .select({ id: examResults.id, marks: examResults.marksObtained, subjectId: exams.subjectId, maxMarks: exams.maxMarks, examName: exams.name })
    .from(examResults)
    .innerJoin(exams, eq(exams.id, examResults.examId))
    .where(eq(examResults.id, body.resultId))
    .limit(1);
  if (!result) throw new ApiError(404, "Result not found");
  const scope = await classesForSubject(user, result.subjectId);
  if (scope !== "all" && scope.length === 0) throw new ApiError(403, "You are not allocated to this subject");
  if (body.newMarks > result.maxMarks) throw new ApiError(400, `Marks cannot exceed ${result.maxMarks}`);
  const [row] = await db
    .insert(examCorrections)
    .values({ resultId: result.id, requestedBy: user.id, oldMarks: result.marks, newMarks: body.newMarks, reason: body.reason })
    .returning();
  const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin"));
  await notifyUsers(admins.map((a) => a.id), {
    title: "Mark correction requested",
    message: `${result.examName}: correction from ${result.marks ?? "blank"} to ${body.newMarks} requires approval.`,
    category: "approval",
    link: "/exams",
  });
  await audit({ id: user.id, role: user.role }, "exam.correction_requested", "exam_result", result.id, { newMarks: body.newMarks });
  return jsonOk(row, 201);
});

const decisionSchema = z.object({ id: z.coerce.number().int().positive(), decision: z.enum(["approve", "reject"]) });

export const PATCH = handle(async (req) => {
  assertSameOrigin(req);
  const admin = await requireUser(["admin"]);
  const body = await readJson(req, decisionSchema);
  const [corr] = await db.select().from(examCorrections).where(eq(examCorrections.id, body.id)).limit(1);
  if (!corr) throw new ApiError(404, "Correction request not found");
  if (corr.status !== "pending") throw new ApiError(409, "This request has already been decided");
  await db.transaction(async (tx) => {
    if (body.decision === "approve") {
      await tx.update(examResults).set({ marksObtained: corr.newMarks, updatedAt: new Date() }).where(eq(examResults.id, corr.resultId));
    }
    await tx
      .update(examCorrections)
      .set({ status: body.decision === "approve" ? "approved" : "rejected", decidedBy: admin.id, decidedAt: new Date() })
      .where(eq(examCorrections.id, body.id));
  });
  await audit({ id: admin.id, role: admin.role }, `exam.correction_${body.decision}`, "exam_correction", body.id, { oldMarks: corr.oldMarks, newMarks: corr.newMarks });
  return jsonOk({ ok: true, status: body.decision === "approve" ? "approved" : "rejected" });
});
