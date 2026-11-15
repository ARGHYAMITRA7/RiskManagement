import { ApiError, handle, jsonOk } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { getGuardianForUser, getStudentForUser, getTeacherForUser, linkedStudentIds } from "@/lib/access";
import { adminDashboard, guardianStudents, studentDashboard, teacherDashboard } from "@/lib/analytics";

export const dynamic = "force-dynamic";

/** Role-specific analytics. Every value is computed from live database records. */
export const GET = handle(async (req) => {
  const user = await requireUser();
  const url = new URL(req.url);
  if (user.role === "admin") return jsonOk({ role: "admin", data: await adminDashboard() });
  if (user.role === "teacher") {
    const t = await getTeacherForUser(user.id);
    if (!t) throw new ApiError(403, "No teacher profile is linked to this account");
    return jsonOk({ role: "teacher", data: await teacherDashboard(t.id) });
  }
  if (user.role === "student") {
    const me = await getStudentForUser(user.id);
    if (!me) throw new ApiError(404, "No student record is linked to this account. Ask the administrator to link your account.");
    return jsonOk({ role: "student", data: await studentDashboard(me.id) });
  }
  // Guardian: linked and approved students only.
  const guardian = await getGuardianForUser(user.id);
  if (!guardian) throw new ApiError(403, "No guardian profile is linked to this account");
  const linked = await linkedStudentIds(user.id);
  const requested = Number(url.searchParams.get("studentId")) || linked[0];
  if (!requested || !linked.includes(requested)) {
    return jsonOk({ role: "guardian", linked: await guardianStudents(guardian.id), data: null });
  }
  return jsonOk({
    role: "guardian",
    linked: await guardianStudents(guardian.id),
    data: await studentDashboard(requested, { forGuardian: true }),
  });
});
