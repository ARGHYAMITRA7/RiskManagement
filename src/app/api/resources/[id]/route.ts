import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { learningResources, resourceBookmarks } from "@/db/schema";
import { ApiError, assertSameOrigin, handle, jsonOk, paramNumber, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { getStudentForUser } from "@/lib/access";
import { audit } from "@/lib/events";

export const dynamic = "force-dynamic";

const schema = z.union([
  z.object({ action: z.enum(["approve", "reject"]) }),
  z.object({ action: z.enum(["bookmark", "complete"]), value: z.boolean() }),
]);

/** Admin: approve or reject a teacher submission. Student: bookmark or mark a resource completed. */
export const PATCH = handle(async (req, ctx) => {
  assertSameOrigin(req);
  const user = await requireUser(["admin", "student"]);
  const id = paramNumber((await ctx.params).id);
  const body = await readJson(req, schema);
  const [res] = await db.select().from(learningResources).where(eq(learningResources.id, id)).limit(1);
  if (!res) throw new ApiError(404, "Resource not found");

  if (body.action === "approve" || body.action === "reject") {
    if (user.role !== "admin") throw new ApiError(403, "Only administrators can approve resources");
    await db
      .update(learningResources)
      .set({ status: body.action === "approve" ? "approved" : "rejected", approvedBy: user.id })
      .where(eq(learningResources.id, id));
    await audit({ id: user.id, role: user.role }, `resource.${body.action}`, "learning_resource", id, {});
    return jsonOk({ ok: true });
  }

  if (user.role !== "student") throw new ApiError(403, "Only students track bookmarks and completion");
  if (res.status !== "approved") throw new ApiError(409, "This resource is not available yet");
  const me = await getStudentForUser(user.id);
  if (!me) throw new ApiError(403, "No student record is linked to this account");
  const [existing] = await db
    .select()
    .from(resourceBookmarks)
    .where(and(eq(resourceBookmarks.studentId, me.id), eq(resourceBookmarks.resourceId, id)))
    .limit(1);
  const value = (body as { value: boolean }).value;
  const patch =
    body.action === "bookmark"
      ? { bookmarked: value, updatedAt: new Date() }
      : { completed: value, completedAt: value ? new Date() : null, updatedAt: new Date() };
  if (existing) {
    await db.update(resourceBookmarks).set(patch).where(eq(resourceBookmarks.id, existing.id));
  } else {
    await db.insert(resourceBookmarks).values({ studentId: me.id, resourceId: id, bookmarked: false, completed: false, ...patch });
  }
  return jsonOk({ ok: true, [body.action === "bookmark" ? "bookmarked" : "completed"]: value });
});
