import type { ReactNode } from "react";
import { requirePageRole } from "@/lib/guards";

export default async function TeacherLayout({ children }: { children: ReactNode }) {
  await requirePageRole(["teacher"]);
  return <>{children}</>;
}
