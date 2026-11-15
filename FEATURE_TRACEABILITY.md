# Feature Traceability

Status values: **Not Started · In Development · Implemented · Tested · Verified · Blocked**.
A feature is marked **Tested** only when an automated test exercises it, and **Verified** only when that test passed in the recorded run (see `DEVELOPMENT_PROGRESS.md`). Features without automated coverage are **Implemented** and were checked by type-checking, production build and code review; they are not claimed as verified.

| ID | Module | Requirement | Frontend | Backend | API endpoint(s) | DB dependency | Test case | Status |
|---|---|---|---|---|---|---|---|---|
| AUTH-01 | Authentication | Secure login, failed-login tracking, lockout | `/login` | `lib/auth.ts`, `lib/security.ts` | `POST /api/auth/login` | users, sessions, login_events | TC-SEC-01 (hash), TC-SEC-03 (rate limit) | Verified |
| AUTH-02 | Authentication | Logout and session expiry | AppShell sign-out | `destroySession`, session expiry check | `POST /api/auth/logout` | sessions | — | Implemented |
| AUTH-03 | Authentication | Registration with approval | `/register` | student/guardian linking | `POST /api/auth/register` | users, students, guardians, guardian_links | — | Implemented |
| AUTH-04 | Authentication | Password reset (no email required) | `/forgot-password` | hashed one-time tokens | `POST /api/auth/password` (forgot/reset) | password_reset_tokens | — | Implemented |
| AUTH-05 | Authentication | Change password, password policy | Profile page | `validatePasswordPolicy` | `POST /api/auth/password` (change) | users | TC-SEC-02 (policy) | Tested |
| AUTH-06 | Authentication | Account activation, suspension, unlock | People & Accounts | users PATCH | `GET/PATCH /api/users` | users | — | Implemented |
| AUTH-07 | Authentication | Profile, avatar upload, login history | Profile page | upload validation | `GET/PATCH /api/auth/me`, `POST /api/users/avatar` | users, login_events | TC-UP-01 (upload rules) | Implemented |
| AUTH-08 | Authorisation | Role and object-level access | Role layouts | `requireUser`, `assertStudentAccess`, `assertTeacherClassSubject` | all `/api/**` | teacher_assignments, guardian_links | — | Verified |
| ACAD-01 | Institution | Departments, courses, years, classes, subjects, topics, calendar | Academic Setup | generic CRUD with Zod | `/api/academics/[entity]` | corresponding tables | — | Implemented |
| ACAD-02 | Institution | Teacher allocation to subject and class | People & Accounts → Allocations | semester/course consistency check | `/api/allocations` | teacher_assignments | — | Implemented |
| ACAD-03 | Institution | Policies: attendance target, pass mark, grading scale, thresholds | Policies & grading | Zod-validated settings | `GET/PATCH /api/settings` | system_settings | TC-GR-01 (grading) | Tested |
| STU-01 | Students | Add student with generated ID and auto-enrolment | Students → Add | transaction + `syncEnrolments` | `POST /api/students` | students, student_subjects | — | Implemented |
| STU-02 | Students | Search, filter, sort, pagination | Students list | SQL with whitelisted sort | `GET /api/students` | students, classes, risk_predictions | — | Verified |
| STU-03 | Students | CSV/Excel import with preview, validation, duplicate detection, confirm | Import modal | `parseTabular`, `validateStudentTable` | `POST /api/students/import`, `GET /api/students/template` | students, academic_outcomes | TC-IMP-01..04 | Tested |
| STU-04 | Students | Bulk export CSV / Excel | Students list | ExcelJS / CSV | `GET /api/students/export` | students | — | Implemented |
| STU-05 | Students | Profile with academic history, risk, interventions, observations | `/students/[id]` | `studentDashboard`, risk history | `GET /api/students/[id]`, `GET /api/risk` | many | — | Implemented |
| STU-06 | Students | Archive (soft delete) and restore | Students list | status + suspended login | `DELETE/PUT /api/students/[id]` | students, users | — | Implemented |
| TCH-01 | Teachers | Register teacher with code and allocations | People & Accounts | transaction | `GET/POST /api/teachers`, `GET/PATCH/DELETE /api/teachers/[id]` | teachers, users | — | Implemented |
| ATT-01 | Attendance | Create session for subject/class/date; duplicate prevention | Attendance → Record | unique index + 409 | `POST /api/attendance` | attendance_sessions, attendance_records | TC-ATT-01 (rate) | Implemented |
| ATT-02 | Attendance | Correction with reason and history | Session detail modal | `attendance_corrections` | `GET/PUT /api/attendance/[id]` | attendance_corrections | — | Implemented |
| ATT-03 | Attendance | Unmarked is not absent; low-attendance notifications | Session list | counts exclude unmarked | `POST /api/attendance` | attendance_records | TC-ATT-01 | Implemented |
| ATT-04 | Attendance | Shortage projection | Shortage monitor | projection formula, documented assumption | `GET /api/attendance/summary` | attendance | — | Implemented |
| ATT-05 | Attendance | Student own daily record and trends | Attendance (student) | own-records query | `GET /api/attendance`, `GET /api/analytics` | attendance | — | Implemented |
| EXM-01 | Examinations | Schedule exams with types, max/pass marks | Examinations | validation (pass ≤ max) | `POST /api/exams` | exams | — | Implemented |
| EXM-02 | Examinations | Marks entry; blank = not entered | Marks grid | upsert, eligibility check | `GET/PUT /api/exams/[id]` | exam_results | TC-GR-01 | Implemented |
| EXM-03 | Examinations | Publish results with notifications | Publish button | status + notifications | `PATCH /api/exams/[id]` | exams, notifications | — | Implemented |
| EXM-04 | Examinations | Correction workflow (request → approve/reject) | Corrections panel | transactional apply | `/api/exams/corrections` | exam_corrections | — | Implemented |
| ASG-01 | Assignments | Create with attachment, deadline, resubmission flag | Assignments → New | multipart, upload rules | `GET/POST /api/assignments` | assignments | TC-UP-01 | Implemented |
| ASG-02 | Assignments | Student submission (text/file), late flag, resubmission | Submit modal | upload rules, `isLate` | `POST /api/assignments/[id]` | assignment_submissions | — | Implemented |
| ASG-03 | Assignments | Evaluate with marks and feedback; request resubmission | Grade panel | validation | `PATCH /api/assignments/submissions/[sid]` | assignment_submissions | — | Implemented |
| QZ-01 | Quizzes | Question bank (MCQ, T/F, short answer), validation | Question bank | `validateQuestion` | `GET/POST/PATCH /api/quizzes/questions` | questions | TC-QZ-03 (shape) | Implemented |
| QZ-02 | Quizzes | Timed adaptive attempt; server-side scoring; no answers leaked | Timed runner | `startAttempt`, `submitAttempt` | `POST /api/quizzes/attempts`, `POST /api/quizzes/attempts/[id]` | quiz_attempts, quiz_answers | TC-QZ-01 (scoring) | Verified |
| QZ-03 | Quizzes | Adaptive difficulty (raise on ≥80%, lower on ≤40%) | Difficulty shown in history | `selectAdaptiveQuestions` | as above | quiz_answers | TC-QZ-02 (difficulty) | Implemented |
| MST-01 | Mastery | Topic mastery, levels, evidence rule, trend, history | Mastery tab | `computeMasteryUpdate`, `levelFor`, `computeTrend` | via quiz submit | topic_mastery | TC-MST-01..02 | Tested |
| ML-01 | ML | Feature pipeline with missing-value handling and no leakage | Model page | `buildFeatures`, `fitPreprocessor` | `POST /api/ml` (train) | academic_outcomes, many | TC-ML-01..03 | Tested |
| ML-02 | ML | Logistic regression + Gaussian NB + rule baseline; CV; selection on CV | Model page | `trainRiskModel` | `POST /api/ml` | model_versions | TC-ML-04 | Verified |
| ML-03 | ML | Evaluation: accuracy, precision, recall, F1, F2, FPR, AUC, confusion matrix | Model page | `classificationMetrics`, `rocAuc` | `GET /api/ml` | model_versions | TC-ML-05 | Verified |
| ML-04 | ML | Random Forest / Gradient Boosting | — | — | — | — | — | Blocked |
| ML-05 | ML | Risk classification with configurable thresholds and rule fallback | Risk tabs | `categorize`, `ruleScreen` | `POST /api/risk` | risk_predictions | TC-ML-06 | Verified |
| XAI-01 | Explainable AI | Factors, importance, narrative, previous comparison, causal note | Risk & XAI tab, student learning page | `buildExplanation` | `GET /api/risk` | risk_predictions | TC-ML-07 | Verified |
| EWS-01 | Early warning | Six alert categories, dedupe, auto-resolve, teacher notification | Early Warnings | `runEarlyWarningScan` | `GET/POST /api/alerts`, `POST /api/risk` (scan) | early_warning_alerts | — | Verified |
| EWS-02 | Early warning | Acknowledge, resolve, reopen with history | Early Warnings | status transitions | `PATCH /api/alerts/[id]` | early_warning_alerts | — | Implemented |
| REC-01 | Recommendations | 12 categories, measurable goals, dedupe, update, auto-close | Learning plan | `generateRecommendations` | `GET/POST /api/recommendations` | recommendations | — | Verified |
| REC-02 | Recommendations | Lifecycle, feedback rating, measured effectiveness | Recommendation cards | effectiveness on follow-up | `PATCH /api/recommendations/[id]` | recommendations | — | Implemented |
| PLN-01 | Study planner | Weekly plan from weak topics, exams, assignments, goal; edit, reschedule, complete | Study planner | `POST /api/planner` | `/api/planner`, `/api/planner/[id]` | study_tasks | — | Verified |
| RES-01 | Resource library | Upload/link, approval, categories, search, bookmark, completion | Resource Library | upload rules, approval | `/api/resources`, `/api/resources/[id]` | learning_resources, resource_bookmarks | TC-UP-01 | Implemented |
| INT-01 | Interventions | Plans, status, support sessions, private observations, follow-up, revision tasks, close | Interventions | staff-only observation filter | `/api/interventions`, `/api/interventions/[id]` | interventions, intervention_history, teacher_observations | — | Implemented |
| NTF-01 | Notifications | In-app inbox, read/unread, preferences, role-based delivery | Notifications | `notifyUsers` with preferences | `/api/notifications` | notifications, notification_preferences | — | Implemented |
| TTB-01 | Timetable | Weekly slots with teacher/class conflict validation; academic calendar | Timetable | overlap query → 409 | `/api/timetable`, `/api/academics/events` | timetable_entries, academic_events | TC-TT-01 (conflict) | Implemented |
| ANL-01 | Analytics | Role dashboards from live SQL aggregates | Dashboards | `adminDashboard`, `teacherDashboard`, `studentDashboard` | `GET /api/analytics` | many | — | Verified |
| RPT-01 | Reports | Student, class, risk, institutional reports as PDF / CSV / Excel | Reports page | `gatherReport`, `renderPdf/Csv/Xlsx` | `GET /api/reports` | report_logs | TC-RPT-01 (CSV/XLSX/PDF) | Verified |
| DSC-01 | Discussions | Subject threads, replies, reporting, moderation | Discussions | subject access check | `/api/discussions` | discussion_threads, discussion_replies | — | Implemented |
| AST-01 | AI assistant | Rule-based answers from approved resources and records; no fabrication | Learning plan → AI assistant | `POST /api/assistant` | `/api/assistant` | several | — | Verified |
| SEC-01 | Security | Audit log of security and academic-data events | Settings → Audit | `audit()` | `GET /api/admin` | audit_logs | — | Implemented |
| SEC-02 | Security | Upload validation: extension, MIME, size, file signature | — | `saveUpload` | used by avatar, submissions, resources | — | TC-UP-01 | Implemented |
| SYN-01 | Dataset | Synthetic dataset of 520 labelled students, demo accounts | Settings → Demo dataset | `seedSyntheticDataset` | `POST /api/admin` (seed), `scripts/seed.ts` | all | — | Verified |
| OPS-01 | Operations | Windows launcher, reset script, health endpoint | `run_project.bat`, `reset_demo_data.bat` | `/api/health` | — | — | — | Implemented |
| DOC-01 | Documentation | README, progress log, traceability | — | — | — | — | — | Implemented |
| PENDING-01 | Testing | Browser E2E (Playwright) and HTTP integration suites | — | — | — | — | — | Not Started |
| PENDING-02 | Backup | In-app backup/restore | — | — | — | — | — | Not Started |
| PENDING-03 | Email | Email delivery | — | — | — | — | — | Blocked |
