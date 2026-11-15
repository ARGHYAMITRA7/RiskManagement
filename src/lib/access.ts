import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  guardianLinks,
  guardians,
  students,
  teacherAssignments,
  teachers,
} from "@/db/schema";
import { ApiError } from "@/lib/http";
import type { SessionUser } from "@/lib/auth";

export type StudentRow = typeof students.$inferSelect;
export type TeacherRow = typeof teachers.$inferSelect;

export async function getTeacherForUser(userId: number): Promise<TeacherRow | null> {
  const [row] = await db.select().from(teachers).where(eq(teachers.userId, userId)).limit(1);
  return row ?? null;
}

export async function getStudentForUser(userId: number): Promise<StudentRow | null> {
  const [row] = await db.select().from(students).where(eq(students.userId, userId)).limit(1);
  return row ?? null;
}

export async function getGuardianForUser(userId: number) {
  const [row] = await db.select().from(guardians).where(eq(guardians.userId, userId)).limit(1);
  return row ?? null;
}

/** Class ids a teacher is allocated to (through any subject). */
export async function teacherClassIds(teacherId: number): Promise<number[]> {
  const rows = await db
    .select({ classId: teacherAssignments.classId })
    .from(teacherAssignments)
    .where(eq(teacherAssignments.teacherId, teacherId));
  return [...new Set(rows.map((r) => r.classId))];
}

/** Approved student ids linked to a guardian account. */
export async function linkedStudentIds(userId: number): Promise<number[]> {
  const guardian = await getGuardianForUser(userId);
  if (!guardian) return [];
  const rows = await db
    .select({ studentId: guardianLinks.studentId })
    .from(guardianLinks)
    .where(and(eq(guardianLinks.guardianId, guardian.id), eq(guardianLinks.approved, true)));
  return rows.map((r) => r.studentId);
}

/**
 * Object-level access control for a single student record.
 * admin: all students | teacher: students in a class they are allocated to |
 * student: own record only | guardian: approved links only.
 */
export async function assertStudentAccess(user: SessionUser, studentId: number): Promise<StudentRow> {
  const [student] = await db.select().from(students).where(eq(students.id, studentId)).limit(1);
  if (!student) throw new ApiError(404, "Student not found");

  if (user.role === "admin") return student;

  if (user.role === "teacher") {
    const teacher = await getTeacherForUser(user.id);
    if (teacher && student.classId) {
      const classes = await teacherClassIds(teacher.id);
      if (classes.includes(student.classId)) return student;
    }
    throw new ApiError(403, "You are not allocated to this student's class");
  }

  if (user.role === "student") {
    if (student.userId === user.id) return student;
    throw new ApiError(403, "You can only access your own record");
  }

  if (user.role === "guardian") {
    const ids = await linkedStudentIds(user.id);
    if (ids.includes(student.id)) return student;
    throw new ApiError(403, "This student is not linked to your guardian account or is not yet approved");
  }

  throw new ApiError(403, "Access denied");
}

/** Student ids visible to the caller for list views. "all" for admins. */
export async function accessibleStudentIds(user: SessionUser): Promise<number[] | "all"> {
  if (user.role === "admin") return "all";
  if (user.role === "teacher") {
    const teacher = await getTeacherForUser(user.id);
    if (!teacher) return [];
    const classIds = await teacherClassIds(teacher.id);
    if (classIds.length === 0) return [];
    const rows = await db
      .select({ id: students.id })
      .from(students)
      .where(and(inArray(students.classId, classIds), eq(students.status, "active")));
    return rows.map((r) => r.id);
  }
  if (user.role === "student") {
    const me = await getStudentForUser(user.id);
    return me ? [me.id] : [];
  }
  return linkedStudentIds(user.id);
}

/** Subject ids a teacher teaches (optionally restricted to a class). */
export async function teacherSubjectIds(teacherId: number, classId?: number): Promise<number[]> {
  const rows = await db
    .select({ subjectId: teacherAssignments.subjectId, classId: teacherAssignments.classId })
    .from(teacherAssignments)
    .where(eq(teacherAssignments.teacherId, teacherId));
  return [...new Set(rows.filter((r) => (classId ? r.classId === classId : true)).map((r) => r.subjectId))];
}

/** Ensures a teacher (or admin) may act on a subject/class pair. Returns teacher id or null for admins. */
export async function assertTeacherClassSubject(user: SessionUser, subjectId: number, classId: number) {
  if (user.role === "admin") return null;
  if (user.role !== "teacher") throw new ApiError(403, "Teacher or administrator access required");
  const teacher = await getTeacherForUser(user.id);
  if (!teacher) throw new ApiError(403, "No teacher profile is linked to this account");
  const [row] = await db
    .select({ id: teacherAssignments.id })
    .from(teacherAssignments)
    .where(
      and(
        eq(teacherAssignments.teacherId, teacher.id),
        eq(teacherAssignments.subjectId, subjectId),
        eq(teacherAssignments.classId, classId),
      ),
    )
    .limit(1);
  if (!row) throw new ApiError(403, "You are not allocated to this subject and class");
  return teacher;
}
