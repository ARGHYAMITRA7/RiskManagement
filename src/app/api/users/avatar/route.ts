import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { ApiError, assertSameOrigin, handle, jsonOk } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { saveUpload } from "@/lib/uploads";
import { parseBody } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const user = await requireUser();
  const { files } = await parseBody(req);
  const file = files.avatar;
  if (!(file instanceof File)) throw new ApiError(400, "Choose an image file (JPG, PNG or WEBP, up to 2 MB)");
  const saved = await saveUpload(file, "avatar", "avatars");
  const url = `/api/files/${saved.relPath}`;
  await db.update(users).set({ avatarUrl: url, updatedAt: new Date() }).where(eq(users.id, user.id));
  return jsonOk({ avatarUrl: url });
});
