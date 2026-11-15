import { handle } from "@/lib/http";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** CSV template for student bulk import (administrators). */
export const GET = handle(async () => {
  await requireUser(["admin"]);
  const header = "student_code,full_name,course_code,semester,class_code,email,phone,guardian_name,guardian_email,guardian_phone,daily_study_goal_minutes,historical_outcome";
  const sample = "STU20260900,Example Student,BCA,3,BCA-S3-A,student@example.edu,+91-90000-12345,Example Guardian,guardian@example.edu,+91-90000-54321,60,on_track";
  return new Response(`${header}\r\n${sample}\r\n`, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="student-import-template.csv"' },
  });
});
