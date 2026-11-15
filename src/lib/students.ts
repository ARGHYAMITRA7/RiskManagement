/* eslint-disable @typescript-eslint/no-explicit-any */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { studentSubjects, students, subjects } from "@/db/schema";

/** Generates the next unique student ID, e.g. STU20260001. */
export async function nextStudentCode(prefix = "STU", executor: any = db): Promise<string> {
  const year = new Date().getFullYear();
  const base = `${prefix}${year}`;
  const [{ n }] = await executor
    .select({ n: sql<number>`count(*)::int` })
    .from(students)
    .where(sql`${students.studentCode} like ${`${base}%`}`);
  let seq = Number(n) + 1;
  for (let i = 0; i < 2000; i++) {
    const code = `${base}${String(seq).padStart(4, "0")}`;
    const [exists] = await executor.select({ id: students.id }).from(students).where(eq(students.studentCode, code)).limit(1);
    if (!exists) return code;
    seq++;
  }
  throw new Error("Could not generate a unique student ID");
}

/** Enrols a student in every active subject of their course and current semester (idempotent). */
export async function syncEnrolments(executor: any, studentId: number, courseId: number, semester: number) {
  await executor.delete(studentSubjects).where(eq(studentSubjects.studentId, studentId));
  const subs = await executor
    .select({ id: subjects.id })
    .from(subjects)
    .where(and(eq(subjects.courseId, courseId), eq(subjects.semester, semester), eq(subjects.isActive, true)));
  if (subs.length) {
    await executor.insert(studentSubjects).values(subs.map((s: { id: number }) => ({ studentId, subjectId: s.id })));
  }
  return subs.length;
}
