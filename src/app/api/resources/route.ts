import { and, desc, eq, ilike, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { learningResources, resourceBookmarks, subjects, topics, users } from "@/db/schema";
import { ApiError, assertSameOrigin, handle, jsonOk } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { getStudentForUser } from "@/lib/access";
import { audit } from "@/lib/events";
import { classesForSubject, parseBody } from "@/lib/api-helpers";
import { saveUpload } from "@/lib/uploads";
import { RESOURCE_TYPES } from "@/lib/constants";

export const dynamic = "force-dynamic";

/** Library search. Students see approved resources; staff can also review pending submissions. */
export const GET = handle(async (req) => {
  const user = await requireUser();
  const url = new URL(req.url);
  const staff = user.role === "admin" || user.role === "teacher";
  const statusParam = url.searchParams.get("status");
  const status = staff && statusParam ? statusParam : "approved";
  const conds = [eq(learningResources.status, status)];
  if (url.searchParams.get("subjectId")) conds.push(eq(learningResources.subjectId, Number(url.searchParams.get("subjectId"))));
  if (url.searchParams.get("topicId")) conds.push(eq(learningResources.topicId, Number(url.searchParams.get("topicId"))));
  if (url.searchParams.get("type")) conds.push(eq(learningResources.resourceType, String(url.searchParams.get("type"))));
  if (url.searchParams.get("difficulty")) conds.push(eq(learningResources.difficulty, String(url.searchParams.get("difficulty"))));
  const q = url.searchParams.get("q")?.trim();
  if (q) {
    const like = `%${q}%`;
    const f = or(ilike(learningResources.title, like), ilike(learningResources.description, like));
    if (f) conds.push(f);
  }
  const rows = await db
    .select({
      id: learningResources.id,
      title: learningResources.title,
      description: learningResources.description,
      resourceType: learningResources.resourceType,
      externalUrl: learningResources.externalUrl,
      filePath: learningResources.filePath,
      fileName: learningResources.fileName,
      difficulty: learningResources.difficulty,
      status: learningResources.status,
      subjectId: learningResources.subjectId,
      subjectCode: subjects.code,
      subjectName: subjects.name,
      topicId: learningResources.topicId,
      topicName: topics.name,
      uploaderName: users.fullName,
      createdAt: learningResources.createdAt,
    })
    .from(learningResources)
    .innerJoin(subjects, eq(subjects.id, learningResources.subjectId))
    .leftJoin(topics, eq(topics.id, learningResources.topicId))
    .leftJoin(users, eq(users.id, learningResources.uploadedBy))
    .where(and(...conds))
    .orderBy(desc(learningResources.createdAt))
    .limit(300);

  let bookmarks = new Map<number, { bookmarked: boolean; completed: boolean }>();
  if (user.role === "student") {
    const me = await getStudentForUser(user.id);
    if (me) {
      const b = await db.select().from(resourceBookmarks).where(eq(resourceBookmarks.studentId, me.id));
      bookmarks = new Map(b.map((x) => [x.resourceId, { bookmarked: x.bookmarked, completed: x.completed }]));
    }
  }
  return jsonOk({
    items: rows.map((r) => ({
      ...r,
      fileUrl: r.filePath ? `/api/files/${r.filePath}` : null,
      bookmarked: bookmarks.get(r.id)?.bookmarked ?? false,
      completed: bookmarks.get(r.id)?.completed ?? false,
    })),
  });
});

const boolish = (v: unknown) => v === true || v === "true" || v === "on";

/** Upload or link a resource. Teachers submit for approval; administrators publish directly. */
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const user = await requireUser(["admin", "teacher"]);
  const { json, files } = await parseBody(req);
  const body = z
    .object({
      title: z.string().trim().min(3).max(160),
      description: z.string().trim().max(1000).default(""),
      resourceType: z.enum(RESOURCE_TYPES),
      externalUrl: z.string().trim().max(500).optional().nullable(),
      subjectId: z.coerce.number().int().positive(),
      topicId: z.coerce.number().int().positive().nullable().optional(),
      difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
    })
    .parse(json);
  void boolish;
  const scope = await classesForSubject(user, body.subjectId);
  if (scope !== "all" && scope.length === 0) throw new ApiError(403, "You are not allocated to this subject");
  if (body.externalUrl && !/^https?:\/\//i.test(body.externalUrl)) throw new ApiError(400, "External links must start with http:// or https://");
  const file = files.file;
  let stored: { relPath: string; fileName: string } | null = null;
  if (file instanceof File) {
    const saved = await saveUpload(file, "document", "resources");
    stored = { relPath: saved.relPath, fileName: saved.fileName };
  }
  const needsSource = ["pdf", "presentation", "video", "external_link"].includes(body.resourceType);
  if (needsSource && !stored && !body.externalUrl) throw new ApiError(400, "Attach a file or provide a link for this resource type");
  const [row] = await db
    .insert(learningResources)
    .values({
      title: body.title,
      description: body.description,
      resourceType: body.resourceType,
      externalUrl: body.externalUrl || null,
      filePath: stored?.relPath ?? null,
      fileName: stored?.fileName ?? null,
      subjectId: body.subjectId,
      topicId: body.topicId ?? null,
      difficulty: body.difficulty,
      status: user.role === "admin" ? "approved" : "pending",
      uploadedBy: user.id,
      approvedBy: user.role === "admin" ? user.id : null,
    })
    .returning();
  await audit({ id: user.id, role: user.role }, "resource.create", "learning_resource", row.id, { status: row.status });
  return jsonOk(row, 201);
});
