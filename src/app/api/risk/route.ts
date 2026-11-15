import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { ApiError, assertSameOrigin, handle, jsonOk, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { accessibleStudentIds, assertStudentAccess } from "@/lib/access";
import { runRiskAssessments } from "@/lib/ml/predict";
import { runEarlyWarningScan } from "@/lib/early-warning";
import { audit } from "@/lib/events";
import { RISK_CATEGORIES } from "@/lib/constants";

export const dynamic = "force-dynamic";

/** Prediction history for one student, or the latest assessment for every student in the caller's scope. */
export const GET = handle(async (req) => {
  const user = await requireUser();
  const url = new URL(req.url);
  const studentParam = url.searchParams.get("studentId");
  if (studentParam) {
    const student = await assertStudentAccess(user, Number(studentParam));
    const rows = await db.execute(sql`
      select id, risk_category, rule_category, risk_score, probability, method, explanation, suggested_intervention, features, missing_features, predicted_at, is_demo, label_source
      from risk_predictions where student_id = ${student.id} order by predicted_at desc limit 50`);
    return jsonOk({ studentId: student.id, items: rows.rows });
  }
  if (user.role === "guardian") throw new ApiError(403, "Select a linked student");
  const scope = await accessibleStudentIds(user);
  if (scope !== "all" && scope.length === 0) return jsonOk({ items: [], counts: { low: 0, medium: 0, high: 0 } });
  const scopeSql = scope === "all" ? sql`` : sql`and st.id in (${sql.join(scope.map((i) => sql`${i}`), sql`, `)})`;
  const category = url.searchParams.get("risk");
  const rows = await db.execute(sql`
    select st.id as student_id, st.student_code, st.full_name, c.code as class_code, p.risk_category, p.risk_score, p.probability,
           p.method, p.suggested_intervention, p.predicted_at
    from (select distinct on (student_id) * from risk_predictions order by student_id, predicted_at desc) p
    join students st on st.id = p.student_id
    left join classes c on c.id = st.class_id
    where st.status = 'active' ${scopeSql}
    order by p.risk_score desc, st.student_code limit 1000`);
  const all = rows.rows as { risk_category: string }[];
  const counts = { low: 0, medium: 0, high: 0 };
  for (const r of all) if (r.risk_category in counts) counts[r.risk_category as keyof typeof counts]++;
  const items = category && (RISK_CATEGORIES as readonly string[]).includes(category) ? (rows.rows as { risk_category: string }[]).filter((r) => r.risk_category === category) : rows.rows;
  return jsonOk({ items, counts });
});

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("assess"), studentIds: z.array(z.coerce.number().int().positive()).optional() }),
  z.object({ action: z.literal("scan"), studentIds: z.array(z.coerce.number().int().positive()).optional() }),
]);

/** Runs risk assessments (ML if a model is active, otherwise rule screening) and/or the early-warning scan for the caller's scope. */
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const user = await requireUser(["admin", "teacher"]);
  const body = await readJson(req, schema);
  const scope = await accessibleStudentIds(user);
  let ids: number[] | undefined;
  if (scope === "all") {
    ids = body.studentIds?.length ? body.studentIds : undefined;
  } else {
    if (scope.length === 0) throw new ApiError(400, "No students are in your allocated classes");
    ids = body.studentIds?.length ? scope.filter((s) => body.studentIds!.includes(s)) : scope;
    if (ids.length === 0) throw new ApiError(403, "None of the selected students are in your allocated classes");
  }
  if (body.action === "assess") {
    const result = await runRiskAssessments(ids);
    await audit({ id: user.id, role: user.role }, "risk.assess", "risk_prediction", null, { count: result.count, method: result.method });
    return jsonOk({ count: result.count, byCategory: result.byCategory, method: result.method });
  }
  const scan = await runEarlyWarningScan(ids);
  await audit({ id: user.id, role: user.role }, "alerts.scan", "early_warning_alerts", null, scan);
  return jsonOk(scan);
});
