import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { earlyWarningAlerts } from "@/db/schema";
import { ApiError, assertSameOrigin, handle, jsonOk, paramNumber, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { assertStudentAccess } from "@/lib/access";
import { audit } from "@/lib/events";

export const dynamic = "force-dynamic";

const schema = z.object({ action: z.enum(["acknowledge", "resolve", "reopen"]) });

/** Acknowledge (someone is acting on it), resolve (closed with history kept), or reopen a resolved alert. */
export const PATCH = handle(async (req, ctx) => {
  assertSameOrigin(req);
  const user = await requireUser(["admin", "teacher"]);
  const id = paramNumber((await ctx.params).id);
  const body = await readJson(req, schema);
  const [alert] = await db.select().from(earlyWarningAlerts).where(eq(earlyWarningAlerts.id, id)).limit(1);
  if (!alert) throw new ApiError(404, "Alert not found");
  await assertStudentAccess(user, alert.studentId);
  const now = new Date();
  if (body.action === "acknowledge") {
    await db.update(earlyWarningAlerts).set({ status: "acknowledged", acknowledgedBy: user.id, acknowledgedAt: now }).where(eq(earlyWarningAlerts.id, id));
  } else if (body.action === "resolve") {
    await db.update(earlyWarningAlerts).set({ status: "resolved", resolvedBy: user.id, resolvedAt: now }).where(eq(earlyWarningAlerts.id, id));
  } else {
    await db.update(earlyWarningAlerts).set({ status: "open", resolvedBy: null, resolvedAt: null }).where(eq(earlyWarningAlerts.id, id));
  }
  await audit({ id: user.id, role: user.role }, `alert.${body.action}`, "early_warning_alert", id, {});
  return jsonOk({ ok: true });
});
