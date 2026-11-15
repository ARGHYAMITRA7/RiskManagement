import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { authSessions, users } from "@/db/schema";
import { ApiError, assertSameOrigin, clientIp, handle, jsonOk, readJson } from "@/lib/http";
import { hashPassword, validatePasswordPolicy } from "@/lib/security";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/events";
import { pageParams, searchFilter } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  await requireUser(["admin"]);
  const url = new URL(req.url);
  const { page, pageSize, offset } = pageParams(url);
  const role = url.searchParams.get("role");
  const status = url.searchParams.get("status");
  const conditions = [
    role ? eq(users.role, role) : undefined,
    status ? eq(users.status, status) : undefined,
    searchFilter(url.searchParams.get("q"), [users.email, users.fullName]),
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);
  const where = conditions.length ? and(...conditions) : undefined;
  const items = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      role: users.role,
      status: users.status,
      failedLoginCount: users.failedLoginCount,
      lockedUntil: users.lockedUntil,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(where)
    .orderBy(desc(users.createdAt))
    .limit(pageSize)
    .offset(offset);
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(users).where(where);
  return jsonOk({ items, total, page, pageSize });
});

const patchSchema = z.object({
  id: z.number().int().positive(),
  status: z.enum(["active", "suspended", "pending"]).optional(),
  unlock: z.boolean().optional(),
});

export const PATCH = handle(async (req) => {
  assertSameOrigin(req);
  const admin = await requireUser(["admin"]);
  const body = await readJson(req, patchSchema);
  if (body.id === admin.id && body.status && body.status !== "active") {
    throw new ApiError(400, "You cannot suspend your own administrator account");
  }
  const [target] = await db.select().from(users).where(eq(users.id, body.id)).limit(1);
  if (!target) throw new ApiError(404, "User not found");
  await db
    .update(users)
    .set({
      ...(body.status ? { status: body.status } : {}),
      ...(body.unlock ? { lockedUntil: null, failedLoginCount: 0 } : {}),
      updatedAt: new Date(),
    })
    .where(eq(users.id, body.id));
  if (body.status && body.status !== "active") await db.delete(authSessions).where(eq(authSessions.userId, body.id));
  await audit({ id: admin.id, role: admin.role }, "user.update", "user", body.id, { status: body.status, unlock: body.unlock }, clientIp(req));
  return jsonOk({ ok: true });
});

const createSchema = z.object({
  email: z.string().trim().toLowerCase().min(5).max(200),
  fullName: z.string().trim().min(2).max(120),
  role: z.enum(["admin", "guardian"]),
  password: z.string().min(8).max(128),
});

/** Administrative provisioning for administrator and guardian accounts (teachers/students use their own endpoints). */
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const admin = await requireUser(["admin"]);
  const body = await readJson(req, createSchema);
  const policy = validatePasswordPolicy(body.password, body.email);
  if (policy.length) throw new ApiError(400, policy.join(" "), policy);
  const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.email, body.email)).limit(1);
  if (exists) throw new ApiError(409, "An account with this email already exists");
  const [user] = await db
    .insert(users)
    .values({ email: body.email, fullName: body.fullName, role: body.role, status: "active", passwordHash: await hashPassword(body.password) })
    .returning({ id: users.id });
  await audit({ id: admin.id, role: admin.role }, "user.provision", "user", user.id, { role: body.role });
  return jsonOk({ id: user.id }, 201);
});
