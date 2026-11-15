import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getCurrentUser } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";

export const dynamic = "force-dynamic";

/** Every page inside the authenticated application requires a valid session. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return (
    <AppShell user={{ id: user.id, fullName: user.fullName, email: user.email, role: user.role, avatarUrl: user.avatarUrl }}>
      {children}
    </AppShell>
  );
}
