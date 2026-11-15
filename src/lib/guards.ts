import { redirect } from "next/navigation";
import { getCurrentUser, dashboardPathFor, type SessionUser } from "@/lib/auth";
import type { Role } from "@/lib/constants";

/** Server-side page guard. API routes enforce the same rules independently. */
export async function requirePageRole(roles: Role[]): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!roles.includes(user.role)) redirect(dashboardPathFor(user.role));
  return user;
}
