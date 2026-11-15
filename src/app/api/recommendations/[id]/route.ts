import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { recommendations } from "@/db/schema";
import { ApiError, assertSameOrigin, handle, jsonOk, paramNumber, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { assertStudentAccess } from "@/lib/access";
import { audit } from "@/lib/events";

export const dynamic = "force-dynamic";

const schema = z.object({
  action: z.enum(["start", "complete", "dismiss", "reopen", "feedback"]),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  feedbackText: z.string().trim().max(1000).optional(),
});

/** Lifecycle: suggested -> in_progress -> completed (dismiss/reopen available). Feedback rates usefulness. */
export const PATCH = handle(async (req, ctx) => {
  assertSameOrigin(req);
  const user = await requireUser(["admin", "teacher", "student"]);
  const id = paramNumber((await ctx.params).id);
  const body = await readJson(req, schema);
  const [rec] = await db.select().from(recommendations).where(eq(recommendations.id, id)).limit(1);
  if (!rec) throw new ApiError(404, "Recommendation not found");
  await assertStudentAccess(user, rec.studentId);
  const now = new Date();
  const patch: Partial<typeof recommendations.$inferInsert> = { updatedAt: now };
  switch (body.action) {
    case "start":
      patch.status = "in_progress";
      patch.startedAt = rec.startedAt ?? now;
      break;
    case "complete":
      patch.status = "completed";
      patch.completedAt = now;
      patch.startedAt = rec.startedAt ?? now;
      break;
    case "dismiss":
      patch.status = "dismissed";
      break;
    case "reopen":
      patch.status = "suggested";
      patch.completedAt = null;
      break;
    case "feedback":
      if (!body.rating) throw new ApiError(400, "Choose a rating from 1 to 5");
      patch.feedbackRating = body.rating;
      patch.feedbackText = body.feedbackText ?? null;
      break;
  }
  if (body.feedbackText !== undefined && body.action !== "feedback") patch.feedbackText = body.feedbackText;
  if (body.rating && body.action !== "feedback") patch.feedbackRating = body.rating;
  await db.update(recommendations).set(patch).where(eq(recommendations.id, id));
  await audit({ id: user.id, role: user.role }, `recommendation.${body.action}`, "recommendation", id, {});
  return jsonOk({ ok: true });
});
