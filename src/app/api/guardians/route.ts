import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { guardianLinks, guardians, students, users } from "@/db/schema";
import { ApiError, assertSameOrigin, handle, jsonOk, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { getGuardianForUser } from "@/lib/access";
import { audit, notifyUsers } from "@/lib/events";

export const dynamic = "force-dynamic";

/** Admin: all guardian links (pending and approved). Guardian: own links and their approval status. */
export const GET = handle(async () => {
  const user = await requireUser(["admin", "guardian"]);
  const base = db
    .select({
      linkId: guardianLinks.id,
      approved: guardianLinks.approved,
      approvedAt: guardianLinks.approvedAt,
      guardianId: guardians.id,
      guardianName: guardians.fullName,
      guardianUserId: guardians.userId,
      relation: guardians.relation,
      studentId: students.id,
      studentCode: students.studentCode,
      studentName: students.fullName,
      studentStatus: students.status,
      createdAt: guardianLinks.createdAt,
    })
    .from(guardianLinks)
    .innerJoin(guardians, eq(guardians.id, guardianLinks.guardianId))
    .innerJoin(students, eq(students.id, guardianLinks.studentId));
  if (user.role === "admin") return jsonOk({ items: await base });
  const g = await getGuardianForUser(user.id);
  if (!g) return jsonOk({ items: [] });
  return jsonOk({ items: await base.where(eq(guardianLinks.guardianId, g.id)) });
});

const requestSchema = z.object({ studentCode: z.string().trim().min(3).max(40) });

/** Guardians request a link with the student's ID. The link stays unapproved until an administrator confirms it. */
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const user = await requireUser(["guardian"]);
  const body = await readJson(req, requestSchema);
  const g = await getGuardianForUser(user.id);
  if (!g) throw new ApiError(403, "No guardian profile is linked to this account");
  const [student] = await db.select().from(students).where(eq(students.studentCode, body.studentCode)).limit(1);
  if (!student || student.status !== "active") throw new ApiError(404, "Student ID not found");
  const [existing] = await db
    .select()
    .from(guardianLinks)
    .where(and(eq(guardianLinks.guardianId, g.id), eq(guardianLinks.studentId, student.id)))
    .limit(1);
  if (existing) throw new ApiError(409, existing.approved ? "This student is already linked and approved" : "A link request is already awaiting approval");
  const [row] = await db.insert(guardianLinks).values({ guardianId: g.id, studentId: student.id, approved: false }).returning();
  const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin"));
  await notifyUsers(admins.map((a) => a.id), { title: "Guardian link awaiting approval", message: `${g.fullName} requested access to ${student.studentCode}.`, category: "approval", link: "/admin/people" });
  await audit({ id: user.id, role: user.role }, "guardian.link_requested", "guardian_link", row.id, { studentId: student.id });
  return jsonOk({ id: row.id, approved: false }, 201);
});

const decisionSchema = z.object({ id: z.coerce.number().int().positive(), decision: z.enum(["approve", "reject"]) });

/** Administrator approves (enables read-only access) or rejects (removes) a guardian link. */
export const PATCH = handle(async (req) => {
  assertSameOrigin(req);
  const admin = await requireUser(["admin"]);
  const body = await readJson(req, decisionSchema);
  const [link] = await db.select().from(guardianLinks).where(eq(guardianLinks.id, body.id)).limit(1);
  if (!link) throw new ApiError(404, "Link not found");
  const [g] = await db.select().from(guardians).where(eq(guardians.id, link.guardianId)).limit(1);
  if (body.decision === "approve") {
    await db.update(guardianLinks).set({ approved: true, approvedAt: new Date() }).where(eq(guardianLinks.id, body.id));
  } else {
    await db.delete(guardianLinks).where(eq(guardianLinks.id, body.id));
  }
  if (g) {
    await notifyUsers([g.userId], {
      title: body.decision === "approve" ? "Guardian access approved" : "Guardian link declined",
      message: body.decision === "approve" ? "You can now view the linked student's approved academic information." : "Your link request was not approved. Contact the administration office.",
      category: "approval",
      link: "/guardian",
    });
  }
  await audit({ id: admin.id, role: admin.role }, `guardian.link_${body.decision}`, "guardian_link", body.id, {});
  return jsonOk({ ok: true });
});
