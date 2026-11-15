import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  auditLogs,
  guardianLinks,
  guardians,
  notificationPreferences,
  notifications,
  students,
} from "@/db/schema";

/** Append-only audit trail for security-relevant and academic-data changes. */
export async function audit(
  actor: { id: number; role: string } | null,
  action: string,
  entityType: string,
  entityId: string | number | null,
  details: Record<string, unknown> = {},
  ipAddress?: string,
) {
  await db.insert(auditLogs).values({
    actorId: actor?.id ?? null,
    actorRole: actor?.role ?? null,
    action,
    entityType,
    entityId: entityId === null ? null : String(entityId),
    details,
    ipAddress: ipAddress ?? null,
  });
}

export type NotificationInput = {
  title: string;
  message: string;
  category: string;
  link?: string;
};

/** Creates in-app notifications, respecting each user's category preferences. */
export async function notifyUsers(userIds: number[], input: NotificationInput) {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return;
  const prefs = await db
    .select()
    .from(notificationPreferences)
    .where(inArray(notificationPreferences.userId, unique));
  const optedOut = new Set(
    prefs.filter((p) => p.categories[input.category] === false).map((p) => p.userId),
  );
  const targets = unique.filter((id) => !optedOut.has(id));
  if (targets.length === 0) return;
  await db.insert(notifications).values(
    targets.map((userId) => ({
      userId,
      title: input.title,
      message: input.message,
      category: input.category,
      link: input.link ?? null,
    })),
  );
}

/** Notifies a student's own account and all approved guardians linked to that student. */
export async function notifyStudentAndGuardians(studentId: number, input: NotificationInput) {
  const [student] = await db.select({ userId: students.userId }).from(students).where(eq(students.id, studentId));
  const guardianUsers = await db
    .select({ userId: guardians.userId })
    .from(guardianLinks)
    .innerJoin(guardians, eq(guardians.id, guardianLinks.guardianId))
    .where(and(eq(guardianLinks.studentId, studentId), eq(guardianLinks.approved, true)));
  const ids = [student?.userId, ...guardianUsers.map((g) => g.userId)].filter((v): v is number => typeof v === "number");
  await notifyUsers(ids, input);
}
