import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { authSessions, passwordResetTokens, users } from "@/db/schema";
import { ApiError, assertSameOrigin, clientIp, handle, jsonOk, readJson } from "@/lib/http";
import { hashPassword, randomToken, rateLimit, sha256, validatePasswordPolicy, verifyPassword } from "@/lib/security";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/events";

export const dynamic = "force-dynamic";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("forgot"), email: z.string().trim().toLowerCase().max(200) }),
  z.object({ action: z.literal("reset"), token: z.string().min(20).max(200), password: z.string().min(8).max(128) }),
  z.object({ action: z.literal("change"), currentPassword: z.string().min(1).max(200), newPassword: z.string().min(8).max(128) }),
]);

/**
 * Password reset and change.
 * Email delivery is optional: when EMAIL_ENABLED is not "true" the reset link is returned to the
 * requester so the workflow works fully offline (documented in README).
 */
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const body = await readJson(req, schema);
  const ip = clientIp(req);

  if (body.action === "forgot") {
    const limit = rateLimit(`forgot:${ip}:${body.email}`, 5, 15 * 60 * 1000);
    if (!limit.ok) throw new ApiError(429, "Too many reset requests. Please wait before trying again.");
    const [user] = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
    const generic = "If an account exists for this email, a password reset link has been created.";
    if (!user) return jsonOk({ message: generic });
    const token = randomToken();
    await db.insert(passwordResetTokens).values({
      userId: user.id,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });
    await audit({ id: user.id, role: user.role }, "auth.password_reset_requested", "user", user.id, {}, ip);
    const link = `/forgot-password?token=${token}`;
    return jsonOk({
      message: generic,
      emailDelivery: process.env.EMAIL_ENABLED === "true" ? "sent" : "not_configured",
      resetLink: process.env.EMAIL_ENABLED === "true" ? undefined : link,
      expiresInMinutes: 30,
    });
  }

  if (body.action === "reset") {
    const [row] = await db
      .select({ id: passwordResetTokens.id, userId: passwordResetTokens.userId, email: users.email })
      .from(passwordResetTokens)
      .innerJoin(users, eq(users.id, passwordResetTokens.userId))
      .where(
        and(
          eq(passwordResetTokens.tokenHash, sha256(body.token)),
          isNull(passwordResetTokens.usedAt),
          gt(passwordResetTokens.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!row) throw new ApiError(400, "This reset link is invalid or has expired. Request a new one.");
    const policy = validatePasswordPolicy(body.password, row.email);
    if (policy.length) throw new ApiError(400, policy.join(" "), policy);
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(body.password), failedLoginCount: 0, lockedUntil: null, updatedAt: new Date() })
      .where(eq(users.id, row.userId));
    await db.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, row.id));
    await db.delete(authSessions).where(eq(authSessions.userId, row.userId));
    await audit(null, "auth.password_reset", "user", row.userId, {}, ip);
    return jsonOk({ ok: true, message: "Your password has been reset. Please sign in with the new password." });
  }

  const user = await requireUser();
  const [full] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  if (!full || !(await verifyPassword(body.currentPassword, full.passwordHash))) {
    throw new ApiError(400, "The current password is incorrect");
  }
  if (body.currentPassword === body.newPassword) throw new ApiError(400, "The new password must be different from the current password");
  const policy = validatePasswordPolicy(body.newPassword, user.email);
  if (policy.length) throw new ApiError(400, policy.join(" "), policy);
  await db.update(users).set({ passwordHash: await hashPassword(body.newPassword), updatedAt: new Date() }).where(eq(users.id, user.id));
  await audit({ id: user.id, role: user.role }, "auth.password_changed", "user", user.id, {}, ip);
  return jsonOk({ ok: true, message: "Password changed successfully." });
});
