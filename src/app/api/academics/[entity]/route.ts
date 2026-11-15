/* eslint-disable @typescript-eslint/no-explicit-any */
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  academicEvents,
  academicYears,
  classes,
  courses,
  departments,
  subjects,
  teacherAssignments,
  teachers,
  topics,
} from "@/db/schema";
import { ApiError, assertSameOrigin, handle, jsonOk, readJson } from "@/lib/http";
import { requireUser, type SessionUser } from "@/lib/auth";
import { audit } from "@/lib/events";

export const dynamic = "force-dynamic";

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the YYYY-MM-DD date format");
const sem = z.coerce.number().int().min(1).max(12);

type Entity = {
  table: any;
  writeRoles: SessionUser["role"][];
  create: z.ZodType<any>;
  orderBy: any;
};

const entities: Record<string, Entity> = {
  departments: {
    table: departments,
    writeRoles: ["admin"],
    orderBy: asc(departments.name),
    create: z.object({
      name: z.string().trim().min(2).max(120),
      code: z.string().trim().min(2).max(12).transform((s) => s.toUpperCase()),
      description: z.string().trim().max(500).optional().nullable(),
    }),
  },
  courses: {
    table: courses,
    writeRoles: ["admin"],
    orderBy: asc(courses.name),
    create: z.object({
      departmentId: z.coerce.number().int().positive(),
      name: z.string().trim().min(2).max(160),
      code: z.string().trim().min(2).max(12).transform((s) => s.toUpperCase()),
      durationSemesters: z.coerce.number().int().min(1).max(12).default(6),
    }),
  },
  "academic-years": {
    table: academicYears,
    writeRoles: ["admin"],
    orderBy: asc(academicYears.label),
    create: z
      .object({
        label: z.string().trim().min(4).max(20),
        startDate: dateStr,
        endDate: dateStr,
        isCurrent: z.boolean().default(false),
      })
      .refine((v) => v.startDate < v.endDate, { message: "End date must be after the start date" }),
  },
  classes: {
    table: classes,
    writeRoles: ["admin"],
    orderBy: asc(classes.code),
    create: z.object({
      code: z.string().trim().min(3).max(30).transform((s) => s.toUpperCase()),
      name: z.string().trim().min(3).max(120),
      courseId: z.coerce.number().int().positive(),
      academicYearId: z.coerce.number().int().positive().nullable().optional(),
      semester: sem,
      division: z.string().trim().min(1).max(5).default("A"),
    }),
  },
  subjects: {
    table: subjects,
    writeRoles: ["admin"],
    orderBy: asc(subjects.code),
    create: z.object({
      code: z.string().trim().min(3).max(20).transform((s) => s.toUpperCase()),
      name: z.string().trim().min(2).max(160),
      courseId: z.coerce.number().int().positive(),
      semester: sem,
      credits: z.coerce.number().int().min(1).max(10).default(4),
      passMarks: z.coerce.number().min(0).max(100).default(40),
      maxInternalMarks: z.coerce.number().min(0).max(200).default(40),
      isActive: z.boolean().default(true),
    }),
  },
  topics: {
    table: topics,
    writeRoles: ["admin", "teacher"],
    orderBy: asc(topics.chapterNo),
    create: z.object({
      subjectId: z.coerce.number().int().positive(),
      name: z.string().trim().min(2).max(160),
      chapterNo: z.coerce.number().int().min(1).max(99).default(1),
    }),
  },
  events: {
    table: academicEvents,
    writeRoles: ["admin", "teacher"],
    orderBy: asc(academicEvents.eventDate),
    create: z.object({
      title: z.string().trim().min(3).max(160),
      eventType: z.enum(["holiday", "exam", "deadline", "event"]),
      eventDate: dateStr,
      endDate: dateStr.nullable().optional(),
      description: z.string().trim().max(1000).optional().nullable(),
      classId: z.coerce.number().int().positive().nullable().optional(),
    }),
  },
};

function entityOf(name: string): Entity {
  const e = entities[name];
  if (!e) throw new ApiError(404, `Unknown resource "${name}"`);
  return e;
}

async function assertWrite(user: SessionUser, entity: Entity, subjectId?: number | null) {
  if (!entity.writeRoles.includes(user.role)) throw new ApiError(403, "You do not have permission to change this resource");
  if (user.role === "teacher" && subjectId) {
    const [t] = await db.select({ id: teachers.id }).from(teachers).where(eq(teachers.userId, user.id)).limit(1);
    const [allocated] = t
      ? await db
          .select({ id: teacherAssignments.id })
          .from(teacherAssignments)
          .where(and(eq(teacherAssignments.teacherId, t.id), eq(teacherAssignments.subjectId, subjectId)))
          .limit(1)
      : [];
    if (!allocated) throw new ApiError(403, "You can only manage topics for subjects you are allocated to");
  }
}

export const GET = handle(async (req, ctx) => {
  await requireUser();
  const { entity: name } = await ctx.params;
  const entity = entityOf(name);
  const url = new URL(req.url);
  let query: any = db.select().from(entity.table).orderBy(entity.orderBy);
  if (name === "topics" && url.searchParams.get("subjectId")) {
    query = db
      .select()
      .from(topics)
      .where(eq(topics.subjectId, Number(url.searchParams.get("subjectId"))))
      .orderBy(asc(topics.chapterNo)) as any;
  }
  const items = await query;
  return jsonOk({ items });
});

export const POST = handle(async (req, ctx) => {
  assertSameOrigin(req);
  const user = await requireUser();
  const { entity: name } = await ctx.params;
  const entity = entityOf(name);
  const body = await readJson(req, entity.create as z.ZodType<any>);
  await assertWrite(user, entity, body.subjectId ?? null);
  if (name === "events" && body.endDate && body.endDate < body.eventDate) throw new ApiError(400, "End date must be on or after the event date");
  const inserted: any[] = await (db as any)
    .insert(entity.table)
    .values({ ...body, ...(name === "events" ? { createdBy: user.id } : {}) })
    .returning();
  const row = inserted[0];
  await audit({ id: user.id, role: user.role }, `academics.${name}.create`, name, row.id, { name: body.name ?? body.title ?? body.label ?? body.code });
  return jsonOk(row, 201);
});

export const PATCH = handle(async (req, ctx) => {
  assertSameOrigin(req);
  const user = await requireUser();
  const { entity: name } = await ctx.params;
  const entity = entityOf(name);
  const body = (await readJson(req, { parse: (v: unknown) => v as Record<string, unknown> })) as Record<string, unknown>;
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, "id is required");
  const { id: _omit, ...rest } = body;
  void _omit;
  const partial = (entity.create as z.ZodObject<any>).partial?.() ?? entity.create;
  const values = partial.parse(rest) as Record<string, unknown>;
  await assertWrite(user, entity, (values.subjectId as number | undefined) ?? null);
  const updated: any[] = await (db as any)
    .update(entity.table)
    .set(values as any)
    .where(eq(entity.table.id, id))
    .returning();
  const row = updated[0];
  if (!row) throw new ApiError(404, "Record not found");
  await audit({ id: user.id, role: user.role }, `academics.${name}.update`, name, id, values);
  return jsonOk(row);
});

export const DELETE = handle(async (req, ctx) => {
  assertSameOrigin(req);
  const user = await requireUser(["admin"]);
  const { entity: name } = await ctx.params;
  const entity = entityOf(name);
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, "id is required");
  try {
    const deleted: any[] = await (db as any).delete(entity.table).where(eq(entity.table.id, id)).returning();
    if (!deleted[0]) throw new ApiError(404, "Record not found");
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(409, "This record is in use by other academic data and cannot be deleted. Deactivate it instead where possible.");
  }
  await audit({ id: user.id, role: user.role }, `academics.${name}.delete`, name, id, {});
  return jsonOk({ ok: true });
});
