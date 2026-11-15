import type { ReactNode } from "react";
import { requirePageRole } from "@/lib/guards";

export default async function StudentLayout({ children }: { children: ReactNode }) {
  await requirePageRole(["student"]);
  return <>{children}</>;
}
