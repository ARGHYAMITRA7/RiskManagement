import { eq } from "drizzle-orm";
import path from "node:path";
import { db } from "@/db";
import { assignmentSubmissions, students } from "@/db/schema";
import { ApiError, handle } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { contentTypeFor, readUpload } from "@/lib/uploads";

export const dynamic = "force-dynamic";

/**
 * Authenticated file delivery. Submission files are restricted to the owning student and staff.
 * Avatars, resources and assignment attachments require an authenticated session.
 */
export const GET = handle(async (req, ctx) => {
  const user = await requireUser();
  const { path: segments } = (await ctx.params) as unknown as { path: string[] };
  const rel = path.posix.normalize((segments ?? []).join("/"));
  if (!rel || rel.startsWith("..")) throw new ApiError(400, "Invalid file path");

  if (rel.startsWith("submissions/")) {
    const [sub] = await db
      .select({ studentId: assignmentSubmissions.studentId, fileName: assignmentSubmissions.fileName })
      .from(assignmentSubmissions)
      .where(eq(assignmentSubmissions.filePath, rel))
      .limit(1);
    if (!sub) throw new ApiError(404, "File not found");
    if (user.role === "student") {
      const [me] = await db.select({ id: students.id }).from(students).where(eq(students.userId, user.id)).limit(1);
      if (!me || me.id !== sub.studentId) throw new ApiError(403, "You can only open your own submissions");
    } else if (user.role !== "admin" && user.role !== "teacher") {
      throw new ApiError(403, "Access denied");
    }
    const data = await readUpload(rel).catch(() => null);
    if (!data) throw new ApiError(404, "File not found");
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": contentTypeFor(rel),
        "Content-Disposition": `attachment; filename="${(sub.fileName ?? "submission").replace(/"/g, "")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  if (!(rel.startsWith("avatars/") || rel.startsWith("resources/") || rel.startsWith("attachments/"))) {
    throw new ApiError(404, "File not found");
  }
  const data = await readUpload(rel).catch(() => null);
  if (!data) throw new ApiError(404, "File not found");
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": contentTypeFor(rel),
      "Content-Disposition": `inline; filename="${path.posix.basename(rel)}"`,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
