import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { discussionReplies, discussionThreads, studentSubjects, subjects, teacherAssignments, teachers, users } from "@/db/schema";
import { ApiError, assertSameOrigin, handle, jsonOk, readJson } from "@/lib/http";
import { requireUser, type SessionUser } from "@/lib/auth";
import { getStudentForUser, getTeacherForUser } from "@/lib/access";
import { audit, notifyUsers } from "@/lib/events";

export const dynamic = "force-dynamic";

/** Subject ids the caller may read and post in: enrolled (students), allocated (teachers), all (admins). */
async function allowedSubjects(user: SessionUser): Promise<number[] | "all"> {
  if (user.role === "admin") return "all";
  if (user.role === "student") {
    const me = await getStudentForUser(user.id);
    if (!me) return [];
    const rows = await db.select({ subjectId: studentSubjects.subjectId }).from(studentSubjects).where(eq(studentSubjects.studentId, me.id));
    return rows.map((r) => r.subjectId);
  }
  if (user.role === "teacher") {
    const t = await getTeacherForUser(user.id);
    if (!t) return [];
    const rows = await db.select({ subjectId: teacherAssignments.subjectId }).from(teacherAssignments).where(eq(teacherAssignments.teacherId, t.id));
    return [...new Set(rows.map((r) => r.subjectId))];
  }
  return [];
}

export const GET = handle(async (req) => {
  const user = await requireUser(["admin", "teacher", "student"]);
  const url = new URL(req.url);
  const allowed = await allowedSubjects(user);
  const threadId = url.searchParams.get("threadId");
  if (threadId) {
    const [thread] = await db
      .select({
        id: discussionThreads.id,
        subjectId: discussionThreads.subjectId,
        title: discussionThreads.title,
        body: discussionThreads.body,
        category: discussionThreads.category,
        status: discussionThreads.status,
        isFlagged: discussionThreads.isFlagged,
        flagReason: discussionThreads.flagReason,
        authorId: discussionThreads.authorId,
        authorName: users.fullName,
        createdAt: discussionThreads.createdAt,
        subjectCode: subjects.code,
        subjectName: subjects.name,
      })
      .from(discussionThreads)
      .innerJoin(users, eq(users.id, discussionThreads.authorId))
      .innerJoin(subjects, eq(subjects.id, discussionThreads.subjectId))
      .where(eq(discussionThreads.id, Number(threadId)))
      .limit(1);
    if (!thread) throw new ApiError(404, "Thread not found");
    if (allowed !== "all" && !allowed.includes(thread.subjectId)) throw new ApiError(403, "This discussion is not in your subjects");
    const replies = await db
      .select({
        id: discussionReplies.id,
        body: discussionReplies.body,
        isStaff: discussionReplies.isStaff,
        isFlagged: discussionReplies.isFlagged,
        flagReason: discussionReplies.flagReason,
        authorId: discussionReplies.authorId,
        authorName: users.fullName,
        createdAt: discussionReplies.createdAt,
      })
      .from(discussionReplies)
      .innerJoin(users, eq(users.id, discussionReplies.authorId))
      .where(eq(discussionReplies.threadId, thread.id))
      .orderBy(asc(discussionReplies.createdAt));
    return jsonOk({ thread, replies });
  }

  if (allowed !== "all" && allowed.length === 0) return jsonOk({ items: [] });
  const conds = [];
  if (allowed !== "all") conds.push(sql`t.subject_id in (${sql.join(allowed.map((s) => sql`${s}`), sql`, `)})`);
  const subjectId = url.searchParams.get("subjectId");
  if (subjectId) conds.push(sql`t.subject_id = ${Number(subjectId)}`);
  if (url.searchParams.get("flagged") === "1") {
    if (user.role === "student") throw new ApiError(403, "Staff only");
    conds.push(sql`(t.is_flagged or exists (select 1 from discussion_replies r where r.thread_id = t.id and r.is_flagged))`);
  }
  const q = url.searchParams.get("q")?.trim();
  if (q) conds.push(sql`(t.title ilike ${`%${q}%`} or t.body ilike ${`%${q}%`})`);
  const where = conds.length ? sql`where ${sql.join(conds, sql` and `)}` : sql``;
  const rows = await db.execute(sql`
    select t.id, t.title, t.category, t.status, t.is_flagged, t.created_at, t.subject_id, s.code as subject_code, s.name as subject_name,
           u.full_name as author_name,
           (select count(*)::int from discussion_replies r where r.thread_id = t.id) as replies
    from discussion_threads t join subjects s on s.id = t.subject_id join users u on u.id = t.author_id
    ${where} order by t.created_at desc limit 200`);
  return jsonOk({ items: rows.rows });
});

const schema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("thread"),
    subjectId: z.coerce.number().int().positive(),
    title: z.string().trim().min(5).max(160),
    body: z.string().trim().min(10).max(3000),
    category: z.enum(["concept", "assignment", "exam", "resource", "other"]).default("concept"),
  }),
  z.object({ type: z.literal("reply"), threadId: z.coerce.number().int().positive(), body: z.string().trim().min(2).max(3000) }),
  z.object({
    type: z.literal("report"),
    kind: z.enum(["thread", "reply"]),
    id: z.coerce.number().int().positive(),
    reason: z.string().trim().min(5).max(300),
  }),
]);

/** Post a question, answer a thread, or report inappropriate content for moderation. */
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const user = await requireUser(["admin", "teacher", "student"]);
  const body = await readJson(req, schema);
  const allowed = await allowedSubjects(user);
  if (body.type === "thread") {
    if (allowed !== "all" && !allowed.includes(body.subjectId)) throw new ApiError(403, "You can only post in your own subjects");
    const [row] = await db
      .insert(discussionThreads)
      .values({ subjectId: body.subjectId, authorId: user.id, title: body.title, body: body.body, category: body.category })
      .returning();
    await audit({ id: user.id, role: user.role }, "discussion.thread", "discussion_thread", row.id, { subjectId: body.subjectId });
    return jsonOk(row, 201);
  }
  if (body.type === "reply") {
    const [thread] = await db.select().from(discussionThreads).where(eq(discussionThreads.id, body.threadId)).limit(1);
    if (!thread) throw new ApiError(404, "Thread not found");
    if (allowed !== "all" && !allowed.includes(thread.subjectId)) throw new ApiError(403, "This discussion is not in your subjects");
    if (thread.status === "closed") throw new ApiError(409, "This discussion is closed");
    const isStaff = user.role !== "student";
    const [row] = await db
      .insert(discussionReplies)
      .values({ threadId: thread.id, authorId: user.id, body: body.body, isStaff })
      .returning();
    if (isStaff) await db.update(discussionThreads).set({ status: "answered", updatedAt: new Date() }).where(eq(discussionThreads.id, thread.id));
    if (isStaff && thread.authorId !== user.id) {
      await notifyUsers([thread.authorId], { title: "Staff replied to your question", message: thread.title, category: "general", link: "/discussions" });
    }
    return jsonOk(row, 201);
  }
  // Report content (any member can report content they can see).
  if (body.kind === "thread") {
    await db.update(discussionThreads).set({ isFlagged: true, flagReason: body.reason }).where(eq(discussionThreads.id, body.id));
  } else {
    await db.update(discussionReplies).set({ isFlagged: true, flagReason: body.reason }).where(eq(discussionReplies.id, body.id));
  }
  await audit({ id: user.id, role: user.role }, "discussion.report", body.kind, body.id, { reason: body.reason });
  return jsonOk({ ok: true, message: "Thanks. Staff will review this content." });
});

const moderationSchema = z.object({
  kind: z.enum(["thread", "reply"]),
  id: z.coerce.number().int().positive(),
  action: z.enum(["close", "reopen", "unflag", "delete"]),
});

/** Moderation by staff: close/reopen threads, clear flags, or remove content. */
export const PATCH = handle(async (req) => {
  assertSameOrigin(req);
  const user = await requireUser(["admin", "teacher"]);
  const body = await readJson(req, moderationSchema);
  if (body.kind === "thread") {
    const [thread] = await db.select().from(discussionThreads).where(eq(discussionThreads.id, body.id)).limit(1);
    if (!thread) throw new ApiError(404, "Thread not found");
    const allowed = await allowedSubjects(user);
    if (allowed !== "all" && !allowed.includes(thread.subjectId)) throw new ApiError(403, "Not in your subjects");
    if (body.action === "close") await db.update(discussionThreads).set({ status: "closed" }).where(eq(discussionThreads.id, body.id));
    if (body.action === "reopen") await db.update(discussionThreads).set({ status: "open" }).where(eq(discussionThreads.id, body.id));
    if (body.action === "unflag") await db.update(discussionThreads).set({ isFlagged: false, flagReason: null }).where(eq(discussionThreads.id, body.id));
    if (body.action === "delete") await db.delete(discussionThreads).where(eq(discussionThreads.id, body.id));
  } else {
    if (body.action === "unflag") await db.update(discussionReplies).set({ isFlagged: false, flagReason: null }).where(eq(discussionReplies.id, body.id));
    if (body.action === "delete") await db.delete(discussionReplies).where(eq(discussionReplies.id, body.id));
  }
  await audit({ id: user.id, role: user.role }, `discussion.moderate.${body.action}`, body.kind, body.id, {});
  return jsonOk({ ok: true });
});
