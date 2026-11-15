import type { ReactNode } from "react";
import { requirePageRole } from "@/lib/guards";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requirePageRole(["admin"]);
  return <>{children}</>;
}
