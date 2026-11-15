import type { ReactNode } from "react";
import { requirePageRole } from "@/lib/guards";

export default async function StudentsLayout({ children }: { children: ReactNode }) {
  await requirePageRole(["admin", "teacher"]);
  return <>{children}</>;
}
