import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { notificationPreferences, notifications } from "@/db/schema";
import { assertSameOrigin, handle, jsonOk, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const NOTIFICATION_CATEGORIES = ["assignment", "results", "attendance", "risk_alert", "recommendations", "feedback", "intervention", "approval", "exam", "general"] as const;

/** Role-based delivery: each user only ever sees their own notifications. */
export const GET = handle(async (req) => {
  const user = await requireUser();
  const url = new URL(req.url);
  if (url.searchParams.get("prefs") === "1") {
    const [p] = await db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, user.id)).limit(1);
    return jsonOk({ categories: NOTIFICATION_CATEGORIES, preferences: p?.categories ?? {} });
  }
  const unreadOnly = url.searchParams.get("unread") === "1";
  const rows = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, user.id), unreadOnly ? eq(notifications.isRead, false) : undefined))
    .orderBy(desc(notifications.createdAt))
    .limit(150);
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, user.id), eq(notifications.isRead, false)));
  return jsonOk({ items: rows, unread: Number(n) });
});

const patchSchema = z.union([
  z.object({ id: z.coerce.number().int().positive(), isRead: z.boolean() }),
  z.object({ all: z.literal(true) }),
]);

export const PATCH = handle(async (req) => {
  assertSameOrigin(req);
  const user = await requireUser();
  const body = await readJson(req, patchSchema);
  if ("all" in body) {
    await db.update(notifications).set({ isRead: true }).where(and(eq(notifications.userId, user.id), eq(notifications.isRead, false)));
  } else {
    await db
      .update(notifications)
      .set({ isRead: body.isRead })
      .where(and(eq(notifications.id, body.id), eq(notifications.userId, user.id)));
  }
  return jsonOk({ ok: true });
});

const prefSchema = z.object({ categories: z.record(z.string(), z.boolean()) });

/** Notification preferences: categories set to false are not delivered to this user. */
export const PUT = handle(async (req) => {
  assertSameOrigin(req);
  const user = await requireUser();
  const body = await readJson(req, prefSchema);
  const allowed = new Set<string>(NOTIFICATION_CATEGORIES);
  const categories = Object.fromEntries(Object.entries(body.categories).filter(([k]) => allowed.has(k)));
  await db
    .insert(notificationPreferences)
    .values({ userId: user.id, categories, updatedAt: new Date() })
    .onConflictDoUpdate({ target: notificationPreferences.userId, set: { categories, updatedAt: new Date() } });
  return jsonOk({ ok: true, categories });
});
