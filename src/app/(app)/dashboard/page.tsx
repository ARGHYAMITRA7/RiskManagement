import { redirect } from "next/navigation";
import { dashboardPathFor, getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function DashboardRedirect() {
  const user = await getCurrentUser();
  redirect(user ? dashboardPathFor(user.role) : "/login");
}
