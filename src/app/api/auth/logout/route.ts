import { ApiError, assertSameOrigin, handle, jsonOk } from "@/lib/http";
import { clearSessionCookie, destroySession, getCurrentUser, getSessionToken } from "@/lib/auth";
import { audit } from "@/lib/events";

export const dynamic = "force-dynamic";

export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const token = await getSessionToken();
  const user = await getCurrentUser();
  if (token) await destroySession(token);
  await clearSessionCookie();
  if (user) await audit({ id: user.id, role: user.role }, "auth.logout", "user", user.id);
  if (!token && !user) throw new ApiError(401, "You are not signed in");
  return jsonOk({ ok: true });
});
