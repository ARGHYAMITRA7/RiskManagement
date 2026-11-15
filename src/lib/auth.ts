import { cookies } from "next/headers";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { authSessions, users } from "@/db/schema";
import { ApiError } from "@/lib/http";
import { randomToken, sha256 } from "@/lib/security";
import { type Role, SESSION_HOURS } from "@/lib/constants";

export const SESSION_COOKIE = "sid";

export type SessionUser = {
  id: number;
  email: string;
  fullName: string;
  role: Role;
  status: string;
  avatarUrl: string | null;
};

export async function createSession(userId: number, meta: { ip?: string; userAgent?: string }): Promise<string> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600 * 1000);
  await db.insert(authSessions).values({
    userId,
    tokenHash: sha256(token),
    expiresAt,
    ipAddress: meta.ip ?? null,
    userAgent: meta.userAgent?.slice(0, 250) ?? null,
  });
  return token;
}

export async function setSessionCookie(token: string) {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function getSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

export async function destroySession(token: string) {
  await db.delete(authSessions).where(eq(authSessions.tokenHash, sha256(token)));
}

/** Resolves the logged-in user from the session cookie. Returns null when not authenticated or expired. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = await getSessionToken();
  if (!token) return null;
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      role: users.role,
      status: users.status,
      avatarUrl: users.avatarUrl,
    })
    .from(authSessions)
    .innerJoin(users, eq(users.id, authSessions.userId))
    .where(and(eq(authSessions.tokenHash, sha256(token)), gt(authSessions.expiresAt, new Date())))
    .limit(1);
  const user = rows[0];
  if (!user || user.status !== "active") return null;
  return { ...user, role: user.role as Role };
}

/** For API routes: throws 401/403 when the caller is not allowed. */
export async function requireUser(roles?: Role[]): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new ApiError(401, "Authentication required");
  if (roles && !roles.includes(user.role)) throw new ApiError(403, "You do not have permission for this action");
  return user;
}

export function dashboardPathFor(role: Role): string {
  switch (role) {
    case "admin":
      return "/admin";
    case "teacher":
      return "/teacher";
    case "student":
      return "/student";
    case "guardian":
      return "/guardian";
  }
}
