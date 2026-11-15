import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { assignmentSubmissions, assignments } from "@/db/schema";
import { ApiError, assertSameOrigin, handle, jsonOk, paramNumber, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { assertTeacherClassSubject } from "@/lib/access";
import { audit, notifyStudentAndGuardians } from "@/lib/events";

export const dynamic = "force-dynamic";

const schema = z.object({
  marks: z.coerce.number().min(0).nullable().optional(),
  feedback: z.string().trim().max(2000).optional().nullable(),
  status: z.enum(["graded", "resubmission_requested"]),
});

/** Teacher evaluation: marks, feedback, and optional resubmission request (only where the assignment allows it). */
export const PATCH = handle(async (req, ctx) => {
  assertSameOrigin(req);
  const user = await requireUser(["admin", "teacher"]);
  const sid = paramNumber((await ctx.params).sid, "submission id");
  const body = await readJson(req, schema);
  const [row] = await db
    .select({ sub: assignmentSubmissions, a: assignments })
    .from(assignmentSubmissions)
    .innerJoin(assignments, eq(assignments.id, assignmentSubmissions.assignmentId))
    .where(eq(assignmentSubmissions.id, sid))
    .limit(1);
  if (!row) throw new ApiError(404, "Submission not found");
  await assertTeacherClassSubject(user, row.a.subjectId, row.a.classId ?? 0).catch((e) => {
    if (user.role !== "admin") throw e;
  });
  if (body.status === "graded") {
    if (body.marks === null || body.marks === undefined) throw new ApiError(400, "Enter marks before grading");
    if (body.marks > row.a.maxMarks) throw new ApiError(400, `Marks cannot exceed ${row.a.maxMarks}`);
  }
  if (body.status === "resubmission_requested" && !row.a.allowResubmission) {
    throw new ApiError(400, "This assignment does not allow resubmission");
  }
  const [updated] = await db
    .update(assignmentSubmissions)
    .set({
      marks: body.status === "graded" ? body.marks ?? null : row.sub.marks,
      feedback: body.feedback ?? null,
      status: body.status,
      gradedAt: new Date(),
      gradedBy: user.id,
      updatedAt: new Date(),
    })
    .where(eq(assignmentSubmissions.id, sid))
    .returning();
  await notifyStudentAndGuardians(row.sub.studentId, {
    title: body.status === "graded" ? "Assignment evaluated" : "Resubmission requested",
    message: `${row.a.title}: ${body.status === "graded" ? `marks ${body.marks}/${row.a.maxMarks}` : "please resubmit with the feedback provided"}.`,
    category: "feedback",
    link: "/assignments",
  });
  await audit({ id: user.id, role: user.role }, "assignment.grade", "assignment_submission", sid, { marks: body.marks, status: body.status });
  return jsonOk(updated);
});
