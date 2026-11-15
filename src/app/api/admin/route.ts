import { and, desc, eq, ilike, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { auditLogs, loginEvents, users, students, examResults, attendanceRecords, academicOutcomes, riskPredictions } from "@/db/schema";
import { ApiError, assertSameOrigin, handle, jsonOk, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/events";
import { seedSyntheticDataset } from "@/lib/seed";
import { pageParams } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

/** Administrator operations: audit trail, login history, and system status. */
export const GET = handle(async (req) => {
  await requireUser(["admin"]);
  const url = new URL(req.url);
  const { page, pageSize, offset } = pageParams(url);
  if (url.searchParams.get("logins") === "1") {
    const rows = await db
      .select({ id: loginEvents.id, email: loginEvents.email, success: loginEvents.success, reason: loginEvents.reason, ipAddress: loginEvents.ipAddress, createdAt: loginEvents.createdAt, fullName: users.fullName })
      .from(loginEvents)
      .leftJoin(users, eq(users.id, loginEvents.userId))
      .orderBy(desc(loginEvents.createdAt))
      .limit(pageSize)
      .offset(offset);
    const [{ failed }] = await db.select({ failed: sql<number>`count(*) filter (where not success)::int` }).from(loginEvents);
    return jsonOk({ items: rows, failedTotal: Number(failed) });
  }
  const action = url.searchParams.get("action");
  const entity = url.searchParams.get("entity");
  const conds = [
    action ? ilike(auditLogs.action, `%${action}%`) : undefined,
    entity ? eq(auditLogs.entityType, entity) : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);
  const where = conds.length ? and(...conds) : undefined;
  const items = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      actorRole: auditLogs.actorRole,
      details: auditLogs.details,
      ipAddress: auditLogs.ipAddress,
      createdAt: auditLogs.createdAt,
      actorName: users.fullName,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorId))
    .where(where)
    .orderBy(desc(auditLogs.createdAt))
    .limit(pageSize)
    .offset(offset);
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(auditLogs).where(where);
  const [counts] = await db
    .select({
      students: sql<number>`(select count(*)::int from ${students})`,
      users: sql<number>`(select count(*)::int from ${users})`,
      results: sql<number>`(select count(*)::int from ${examResults})`,
      attendance: sql<number>`(select count(*)::int from ${attendanceRecords})`,
      labels: sql<number>`(select count(*)::int from ${academicOutcomes})`,
      predictions: sql<number>`(select count(*)::int from ${riskPredictions})`,
    })
    .from(users)
    .limit(1);
  return jsonOk({ items, total: Number(total), page, pageSize, counts });
});

const actionSchema = z.object({
  action: z.enum(["seed"]),
  confirm: z.literal("RESET").optional(),
  mode: z.enum(["reset", "append"]).default("reset"),
});

/** Regenerates the SYNTHETIC demonstration dataset. Requires explicit confirmation because it replaces all data. */
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const admin = await requireUser(["admin"]);
  const body = await readJson(req, actionSchema);
  if (body.confirm !== "RESET") throw new ApiError(400, 'Type RESET to confirm. This replaces all application data with the synthetic demonstration dataset.');
  const demoPassword = process.env.DEMO_PASSWORD;
  if (!demoPassword) throw new ApiError(500, "DEMO_PASSWORD is not configured in the environment");
  const summary = await seedSyntheticDataset({ reset: body.mode === "reset", demoPassword });
  await audit({ id: admin.id, role: admin.role }, "admin.seed_synthetic", "system", null, { ...summary });
  return jsonOk({ ok: true, summary }, 201);
});
