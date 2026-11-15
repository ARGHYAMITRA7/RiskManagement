import { sql } from "drizzle-orm";
import { db } from "@/db";
import { ApiError, handle, jsonOk } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { accessibleStudentIds } from "@/lib/access";

export const dynamic = "force-dynamic";

/** Early-warning alerts for staff. Default view: open and acknowledged (resolved items are kept in history). */
export const GET = handle(async (req) => {
  const user = await requireUser(["admin", "teacher"]);
  const url = new URL(req.url);
  const scope = await accessibleStudentIds(user);
  if (scope !== "all" && scope.length === 0) return jsonOk({ items: [], counts: {} });
  const conds = [];
  if (scope !== "all") conds.push(sql`a.student_id in (${sql.join(scope.map((i) => sql`${i}`), sql`, `)})`);
  const status = url.searchParams.get("status") ?? "active";
  if (status === "active") conds.push(sql`a.status in ('open','acknowledged')`);
  else if (status !== "all") conds.push(sql`a.status = ${status}`);
  if (url.searchParams.get("severity")) conds.push(sql`a.severity = ${url.searchParams.get("severity")}`);
  if (url.searchParams.get("category")) conds.push(sql`a.category = ${url.searchParams.get("category")}`);
  if (url.searchParams.get("studentId")) conds.push(sql`a.student_id = ${Number(url.searchParams.get("studentId"))}`);
  const where = conds.length ? sql`where ${sql.join(conds, sql` and `)}` : sql``;
  const rows = await db.execute(sql`
    select a.id, a.student_id, a.subject_id, a.category, a.severity, a.title, a.factors, a.recommended_action, a.status,
           a.created_at, a.acknowledged_at, a.resolved_at, st.student_code, st.full_name, c.code as class_code, sub.code as subject_code
    from early_warning_alerts a
    join students st on st.id = a.student_id
    left join classes c on c.id = st.class_id
    left join subjects sub on sub.id = a.subject_id
    ${where}
    order by case a.severity when 'high' then 0 when 'medium' then 1 else 2 end, a.created_at desc
    limit 300`);
  const counts = await db.execute(sql`
    select a.status, count(*)::int as n from early_warning_alerts a
    ${scope === "all" ? sql`` : sql`where a.student_id in (${sql.join(scope.map((i) => sql`${i}`), sql`, `)})`}
    group by a.status`);
  if (user.role === "student") throw new ApiError(403, "Early-warning alerts are visible to staff only");
  return jsonOk({ items: rows.rows, counts: Object.fromEntries((counts.rows as { status: string; n: number }[]).map((c) => [c.status, c.n])) });
});

import { subjects } from "@/db/schema";
