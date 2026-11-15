import type { ReactNode } from "react";
import { requirePageRole } from "@/lib/guards";

export default async function GuardianLayout({ children }: { children: ReactNode }) {
  await requirePageRole(["guardian"]);
  return <>{children}</>;
}
