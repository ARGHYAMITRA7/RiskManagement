import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { loginEvents, users } from "@/db/schema";
import { ApiError, assertSameOrigin, clientIp, handle, jsonOk, readJson } from "@/lib/http";
import { rateLimit, verifyPassword } from "@/lib/security";
import { createSession, dashboardPathFor, setSessionCookie } from "@/lib/auth";
import { LOCKOUT_MINUTES, MAX_LOGIN_FAILURES, type Role } from "@/lib/constants";
import { audit } from "@/lib/events";

export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().trim().toLowerCase().min(3).max(200),
  password: z.string().min(1).max(200),
});

export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const ip = clientIp(req);
  const body = await readJson(req, schema);

  const limit = rateLimit(`login:${ip}`, 30, 15 * 60 * 1000);
  if (!limit.ok) throw new ApiError(429, `Too many login attempts. Try again in ${limit.retryAfterSec} seconds.`);

  const [user] = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
  const record = async (success: boolean, reason: string) =>
    db.insert(loginEvents).values({ userId: user?.id ?? null, email: body.email, success, ipAddress: ip, reason });

  if (!user) {
    await record(false, "unknown_email");
    throw new ApiError(401, "Invalid email or password");
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await record(false, "locked");
    throw new ApiError(423, "This account is temporarily locked after repeated failed attempts. Please try again later.");
  }
  if (user.status === "suspended") {
    await record(false, "suspended");
    throw new ApiError(403, "This account is suspended. Contact the administrator.");
  }
  if (user.status === "pending") {
    await record(false, "pending");
    throw new ApiError(403, "Your account is awaiting administrator approval.");
  }

  const valid = await verifyPassword(body.password, user.passwordHash);
  if (!valid) {
    const failures = user.failedLoginCount + 1;
    const lock = failures >= MAX_LOGIN_FAILURES;
    await db
      .update(users)
      .set({
        failedLoginCount: lock ? 0 : failures,
        lockedUntil: lock ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000) : null,
      })
      .where(eq(users.id, user.id));
    await record(false, "bad_password");
    throw new ApiError(401, "Invalid email or password");
  }

  await db.update(users).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(users.id, user.id));
  const token = await createSession(user.id, { ip, userAgent: req.headers.get("user-agent") ?? undefined });
  await setSessionCookie(token);
  await record(true, "ok");
  await audit({ id: user.id, role: user.role }, "auth.login", "user", user.id, {}, ip);

  return jsonOk({
    user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role as Role, avatarUrl: user.avatarUrl },
    redirect: dashboardPathFor(user.role as Role),
  });
});
