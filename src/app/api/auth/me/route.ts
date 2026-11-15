import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { guardians, loginEvents, notifications, students, teachers, users } from "@/db/schema";
import { handle, jsonOk, readJson, assertSameOrigin } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { getTeacherForUser, getStudentForUser, getGuardianForUser } from "@/lib/access";

export const dynamic = "force-dynamic";

async function profileFor(userId: number, role: string) {
  if (role === "teacher") {
    const t = await getTeacherForUser(userId);
    return t ? { teacherId: t.id, teacherCode: t.teacherCode, designation: t.designation, phone: t.phone } : null;
  }
  if (role === "student") {
    const s = await getStudentForUser(userId);
    return s
      ? { studentId: s.id, studentCode: s.studentCode, currentSemester: s.currentSemester, dailyStudyGoalMinutes: s.dailyStudyGoalMinutes }
      : null;
  }
  if (role === "guardian") {
    const g = await getGuardianForUser(userId);
    return g ? { guardianId: g.id, relation: g.relation, phone: g.phone } : null;
  }
  return {};
}

export const GET = handle(async (req) => {
  const user = await requireUser();
  const url = new URL(req.url);
  if (url.searchParams.get("history") === "1") {
    const rows = await db
      .select({ success: loginEvents.success, reason: loginEvents.reason, ipAddress: loginEvents.ipAddress, createdAt: loginEvents.createdAt })
      .from(loginEvents)
      .where(eq(loginEvents.userId, user.id))
      .orderBy(desc(loginEvents.createdAt))
      .limit(30);
    return jsonOk({ history: rows });
  }
  const [unread] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, user.id), eq(notifications.isRead, false)));
  const [row] = await db.select({ phone: users.phone, lastLoginAt: users.lastLoginAt, createdAt: users.createdAt }).from(users).where(eq(users.id, user.id));
  const settings = await getSettings();
  return jsonOk({
    user,
    phone: row?.phone ?? null,
    lastLoginAt: row?.lastLoginAt ?? null,
    memberSince: row?.createdAt ?? null,
    profile: await profileFor(user.id, user.role),
    unreadNotifications: unread?.n ?? 0,
    settings: { institutionName: settings.institutionName, gamificationEnabled: settings.gamificationEnabled },
  });
});

const profileSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().max(20).regex(/^[+0-9 ()-]*$/, "Phone may contain digits, spaces, +, -, ( and )").optional(),
});

export const PATCH = handle(async (req) => {
  assertSameOrigin(req);
  const user = await requireUser();
  const body = await readJson(req, profileSchema);
  await db
    .update(users)
    .set({ ...(body.fullName ? { fullName: body.fullName } : {}), ...(body.phone !== undefined ? { phone: body.phone || null } : {}), updatedAt: new Date() })
    .where(eq(users.id, user.id));
  if (user.role === "teacher" && body.phone !== undefined) {
    await db.update(teachers).set({ phone: body.phone || null }).where(eq(teachers.userId, user.id));
  }
  if (user.role === "student" && body.fullName) {
    await db.update(students).set({ fullName: body.fullName, updatedAt: new Date() }).where(eq(students.userId, user.id));
  }
  if (user.role === "guardian" && body.fullName) {
    await db.update(guardians).set({ fullName: body.fullName, phone: body.phone || null }).where(eq(guardians.userId, user.id));
  }
  return jsonOk({ ok: true });
});
