import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { guardianLinks, guardians, students, users } from "@/db/schema";
import { ApiError, assertSameOrigin, clientIp, handle, jsonOk, readJson } from "@/lib/http";
import { hashPassword, rateLimit, validatePasswordPolicy } from "@/lib/security";
import { audit, notifyUsers } from "@/lib/events";

export const dynamic = "force-dynamic";

const schema = z.object({
  role: z.enum(["student", "guardian"]),
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().min(5).max(200),
  password: z.string().min(8).max(128),
  studentCode: z.string().trim().min(3).max(40),
  relation: z.string().trim().max(60).optional(),
});

/**
 * Self-registration creates a PENDING account linked to an existing student record.
 * An administrator must approve the account before sign-in is allowed (account approval workflow).
 */
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const ip = clientIp(req);
  const limit = rateLimit(`register:${ip}`, 10, 60 * 60 * 1000);
  if (!limit.ok) throw new ApiError(429, "Too many registration attempts. Please try again later.");
  const body = await readJson(req, schema);

  const policy = validatePasswordPolicy(body.password, body.email);
  if (policy.length) throw new ApiError(400, policy.join(" "), policy);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) throw new ApiError(400, "Enter a valid email address");

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, body.email)).limit(1);
  if (existing) throw new ApiError(409, "An account with this email already exists");

  const [student] = await db.select().from(students).where(eq(students.studentCode, body.studentCode)).limit(1);
  if (!student || student.status !== "active") throw new ApiError(404, "Student ID not found. Check the ID with the administration office.");
  if (body.role === "student" && student.userId) throw new ApiError(409, "This student ID is already linked to an account");

  const [user] = await db
    .insert(users)
    .values({
      email: body.email,
      passwordHash: await hashPassword(body.password),
      fullName: body.fullName,
      role: body.role,
      status: "pending",
    })
    .returning();

  if (body.role === "student") {
    await db.update(students).set({ userId: user.id, updatedAt: new Date() }).where(eq(students.id, student.id));
  } else {
    const [g] = await db
      .insert(guardians)
      .values({ userId: user.id, fullName: body.fullName, relation: body.relation ?? "Guardian" })
      .returning();
    await db.insert(guardianLinks).values({ guardianId: g.id, studentId: student.id, approved: false });
  }

  await audit(null, "auth.register", "user", user.id, { role: body.role, studentId: student.id }, ip);
  const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin"));
  await notifyUsers(admins.map((a) => a.id), {
    title: "New account awaiting approval",
    message: `${body.fullName} registered as ${body.role}. Review it in People & Accounts.`,
    category: "approval",
    link: "/admin/people",
  });
  return jsonOk(
    { ok: true, message: "Registration received. An administrator must approve your account before you can sign in." },
    201,
  );
});
