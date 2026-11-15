import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { students, teacherAssignments, teachers, classes } from "@/db/schema";
import { ApiError } from "@/lib/http";
import type { SessionUser } from "@/lib/auth";

export type ParsedBody = { json: Record<string, unknown>; files: Record<string, File> };

function parseMaybeJson(value: string): unknown {
  const t = value.trim();
  if (t.startsWith("[") || t.startsWith("{")) {
    try {
      return JSON.parse(t);
    } catch {
      return value;
    }
  }
  return value;
}

/** Accepts JSON or multipart/form-data bodies. Multipart text fields that hold JSON are parsed. */
export async function parseBody(req: Request): Promise<ParsedBody> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new ApiError(400, "Invalid multipart form body");
    }
    const json: Record<string, unknown> = {};
    const files: Record<string, File> = {};
    for (const [key, value] of form.entries()) {
      if (typeof value === "string") json[key] = parseMaybeJson(value);
      else if (value.size > 0) files[key] = value;
    }
    return { json, files };
  }
  if (req.method === "DELETE" || req.headers.get("content-length") === "0") return { json: {}, files: {} };
  try {
    const body = await req.json();
    return { json: (body && typeof body === "object" ? body : {}) as Record<string, unknown>, files: {} };
  } catch {
    throw new ApiError(400, "Request body must be valid JSON");
  }
}

export function pageParams(url: URL, defaultSize = 20) {
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") ?? defaultSize) || defaultSize));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function searchFilter(term: string | null, columns: Parameters<typeof ilike>[0][]): SQL | undefined {
  const t = term?.trim();
  if (!t) return undefined;
  const like = `%${t.replace(/[%_]/g, "\\$&")}%`;
  return or(...columns.map((c) => ilike(c, like)));
}

export { and, asc, desc, eq, sql };

/** Returns the teacher profile for a teacher user; admins receive null (unrestricted). */
export async function teacherProfileOf(user: SessionUser) {
  if (user.role === "admin") return null;
  const [t] = await db.select().from(teachers).where(eq(teachers.userId, user.id)).limit(1);
  if (!t) throw new ApiError(403, "No teacher profile is linked to this account");
  return t;
}

/** Class ids the caller may manage: all classes for admins, allocated classes for teachers. */
export async function manageableClassIds(user: SessionUser): Promise<number[] | "all"> {
  if (user.role === "admin") return "all";
  const t = await teacherProfileOf(user);
  if (!t) return [];
  const rows = await db.select({ classId: teacherAssignments.classId }).from(teacherAssignments).where(eq(teacherAssignments.teacherId, t.id));
  return [...new Set(rows.map((r) => r.classId))];
}

/** Classes in which the caller may manage a subject's records: "all" for admins, allocated classes for teachers. */
export async function classesForSubject(user: SessionUser, subjectId: number): Promise<number[] | "all"> {
  if (user.role === "admin") return "all";
  const t = await teacherProfileOf(user);
  if (!t) return [];
  const rows = await db
    .select({ classId: teacherAssignments.classId })
    .from(teacherAssignments)
    .where(and(eq(teacherAssignments.teacherId, t.id), eq(teacherAssignments.subjectId, subjectId)));
  return [...new Set(rows.map((r) => r.classId))];
}

export async function studentIdsInClasses(classIds: number[]): Promise<number[]> {
  if (classIds.length === 0) return [];
  const rows = await db.select({ id: students.id }).from(students).where(sql`${students.classId} in (${sql.join(classIds.map((c) => sql`${c}`), sql`, `)})`);
  return rows.map((r) => r.id);
}

export async function classNameMap(): Promise<Map<number, string>> {
  const rows = await db.select({ id: classes.id, code: classes.code }).from(classes);
  return new Map(rows.map((r) => [r.id, r.code]));
}
