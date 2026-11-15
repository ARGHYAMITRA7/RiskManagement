import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSettings } from "@/lib/settings";
import { ApiError, handle, jsonOk } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { manageableClassIds } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

/** Sessions planned per subject per semester. Used only for the shortage projection (documented assumption). */
const PLANNED_SESSIONS = 40;

/**
 * Attendance shortage monitor.
 * - current attendance per student and subject
 * - projected final attendance assuming the student continues at their recent rate
 * - how many of the remaining sessions must be attended to reach the target
 */
export const GET = handle(async (req) => {
  const user = await requireUser(["admin", "teacher"]);
  const settings = await getSettings();
  const scope = await manageableClassIds(user);
  const url = new URL(req.url);
  const filterClass = url.searchParams.get("classId") ? Number(url.searchParams.get("classId")) : null;
  if (scope !== "all" && scope.length === 0) return jsonOk({ threshold: settings.attendanceThresholdPct, plannedSessions: PLANNED_SESSIONS, items: [] });
  const classFilter =
    filterClass !== null
      ? sql`and s.class_id = ${filterClass}`
      : scope === "all"
        ? sql``
        : sql`and s.class_id in (${sql.join((scope as number[]).map((c) => sql`${c}`), sql`, `)})`;

  const rows = await db.execute(sql`
    with per as (
      select r.student_id, s.subject_id, s.class_id,
             count(*) filter (where r.status in ('present','late'))::int as att,
             count(*) filter (where r.status <> 'excused')::int as marked
      from attendance_records r join attendance_sessions s on s.id = r.session_id
      where true ${classFilter}
      group by r.student_id, s.subject_id, s.class_id),
    held as (
      select subject_id, class_id, count(*)::int as held from attendance_sessions group by subject_id, class_id)
    select per.student_id, per.subject_id, per.class_id, per.att, per.marked, held.held,
           st.student_code, st.full_name, sub.code as subject_code, sub.name as subject_name, c.code as class_code,
           (select (sum(case when x.status in ('present','late') then 1 else 0 end)::float / nullif(sum(case when x.status <> 'excused' then 1 else 0 end),0) * 100)::float
              from (select rr.status from attendance_records rr join attendance_sessions ss on ss.id = rr.session_id
                    where rr.student_id = per.student_id and ss.subject_id = per.subject_id order by ss.session_date desc limit 5) x) as recent_pct
    from per
    join held on held.subject_id = per.subject_id and held.class_id = per.class_id
    join students st on st.id = per.student_id
    join subjects sub on sub.id = per.subject_id
    join classes c on c.id = per.class_id
    where per.marked > 0 and st.status = 'active'`);

  const T = settings.attendanceThresholdPct;
  const items = (rows.rows as Record<string, unknown>[])
    .map((r) => {
      const att = Number(r.att);
      const marked = Number(r.marked);
      const held = Number(r.held);
      const pct = marked ? (att / marked) * 100 : 0;
      const recent = r.recent_pct === null ? pct : Number(r.recent_pct);
      const remaining = Math.max(0, PLANNED_SESSIONS - held);
      const projectedAttended = att + remaining * (recent / 100);
      const projectedPct = (projectedAttended / PLANNED_SESSIONS) * 100;
      const needed = Math.max(0, Math.ceil((T / 100) * PLANNED_SESSIONS - att));
      let status: "on_track" | "at_risk" | "shortage_likely" | "below_target" = "on_track";
      if (pct < T && projectedPct < T) status = "shortage_likely";
      else if (pct < T) status = "below_target";
      else if (projectedPct < T) status = "at_risk";
      return {
        studentId: Number(r.student_id),
        studentCode: r.student_code,
        fullName: r.full_name,
        classCode: r.class_code,
        subjectId: Number(r.subject_id),
        subjectCode: r.subject_code,
        subjectName: r.subject_name,
        attended: att,
        marked,
        currentPct: Math.round(pct * 10) / 10,
        recentPct: Math.round(recent * 10) / 10,
        sessionsHeld: held,
        projectedPct: Math.round(projectedPct * 10) / 10,
        sessionsNeededRemaining: needed,
        remainingSessionsEstimate: remaining,
        status,
      };
    })
    .filter((i) => i.status !== "on_track")
    .sort((a, b) => a.projectedPct - b.projectedPct)
    .slice(0, 300);
  return jsonOk({ threshold: T, plannedSessions: PLANNED_SESSIONS, assumption: "Planned sessions per subject per semester is an institutional assumption used for projections.", items });
});

export const POST = handle(async () => {
  throw new ApiError(405, "Use the attendance sessions endpoint to record attendance");
});
