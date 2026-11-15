import { z } from "zod";
import { ApiError, assertSameOrigin, handle, jsonOk, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { assertStudentAccess } from "@/lib/access";
import { generateRecommendations, listRecommendations } from "@/lib/recommendations";
import { audit } from "@/lib/events";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  const user = await requireUser(["admin", "teacher", "student"]);
  const studentId = Number(new URL(req.url).searchParams.get("studentId"));
  if (!studentId) throw new ApiError(400, "studentId is required");
  const student = await assertStudentAccess(user, studentId);
  return jsonOk({ studentId: student.id, items: await listRecommendations(student.id) });
});

const schema = z.object({ studentId: z.coerce.number().int().positive() });

/** Generates or refreshes personalised recommendations (deduplicated per student). Students may refresh their own. */
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const user = await requireUser(["admin", "teacher", "student"]);
  const body = await readJson(req, schema);
  const student = await assertStudentAccess(user, body.studentId);
  const summary = await generateRecommendations(student.id);
  await audit({ id: user.id, role: user.role }, "recommendations.generate", "student", student.id, summary);
  return jsonOk({ ...summary, items: await listRecommendations(student.id) }, 200);
});
