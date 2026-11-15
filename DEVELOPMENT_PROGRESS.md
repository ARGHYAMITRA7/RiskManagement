# Development Progress

## Phase summary

| Phase | Status | Notes |
|---|---|---|
| 1. Environment inspection, architecture, schema | Completed | Stack fixed to Next.js 16 + Drizzle + PostgreSQL (see README §1). |
| 2. Database, authentication, permissions, user management | Completed | scrypt hashing, sessions, lockout, approval, admin provisioning. |
| 3. Institutional management, students, teachers | Completed | Generic academic CRUD, student lifecycle, import/export, allocations. |
| 4. Attendance, examinations, marks, assignments | Completed | Duplicate prevention, corrections, unmarked ≠ absent, publication, correction workflow, uploads. |
| 5. Frontend dashboards and role interfaces | Completed | Four role layouts; 35+ pages; dark and light themes. |
| 6. Dataset management and preprocessing | Completed | Synthetic generator (520 students, labelled); data-quality report; CSV/Excel import workflow. |
| 7. ML training, evaluation, risk prediction | Completed | LR and Gaussian NB vs rule baseline; CV; test-once evaluation; stored versions. RF/GB not implemented. |
| 8. Explainable AI and early warning | Completed | Factor contributions, permutation importance, narrative, change tracking; six alert categories. |
| 9. Recommendations and topic mastery | Completed | Rule engine, dedupe, effectiveness tracking; mastery bands with evidence rule. |
| 10. Adaptive quizzes and study planner | Completed | Timed attempts, server-side scoring, adaptive difficulty, planner generation and editing. |
| 11. Resource library and interventions | Completed | Approval workflow, bookmarks/completion; intervention lifecycle with private observations. |
| 12. Notifications, timetable, calendar | Completed | Preferences, conflict validation, calendar. |
| 13. Analytics and reporting | Completed | Live aggregates; PDF/CSV/Excel reports with permission checks and logs. |
| 14. Guardian portal, discussions, AI assistant | Completed | Approved links only; moderation; rule-based assistant. |
| 15. Security, backups, monitoring | Partially completed | Security controls implemented; backups via pg_dump documented; no in-app backup. |
| 16. Integration and end-to-end testing | In progress | See verification log below. |
| 17. Documentation and deployment | Completed (README, traceability, progress) | Academic report chapters not generated. |

## Files created (principal)

- Database: `src/db/schema.ts` (≈50 tables), `drizzle.config.json` (existing).
- Core libraries: `src/lib/{constants,security,http,auth,access,api-helpers,settings,events,utils,csv,uploads,students,quiz,mastery,recommendations,early-warning,analytics,reports,seed}.ts`.
- ML: `src/lib/ml/{logistic,features,rules,train,predict}.ts`.
- API: ~60 route handlers under `src/app/api/**`.
- UI: `src/app/**` role-based pages; `src/components/{ui,charts,AppShell,AuthShell}.tsx`.
- Operations: `run_project.bat`, `reset_demo_data.bat`, `scripts/seed.ts`, `.env`, `.env.example`, `.gitignore`.
- Tests: `vitest.config.mts`, `tests/unit/ml-and-domain.test.ts`.
- Documentation: `README.md`, `FEATURE_TRACEABILITY.md`, `DEVELOPMENT_PROGRESS.md`.

## Files modified (principal)

- `src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx` (replaced template starter).
- `src/app/api/health/route.ts` retained from the template.
- `.env` (added `DEMO_PASSWORD`, flags).

## Errors encountered and resolutions

- Tool path rejected for `[...path]` catch-all folder → created the file via a shell heredoc.
- Next.js route modules exported non-handler symbols during drafting → removed; route modules export HTTP handlers and `dynamic` only.
- Drizzle generic table writes produced union types → explicit `any` table handles in generic CRUD only.
- Settings page closure narrowing → typed merged settings.
- Corrections form sent the student ID where the result ID was required → fixed by exposing `resultId` from the marks API.

## Verification log

| Check | Result |
|---|---|
| `npx tsc --noEmit` (whole project) | Passed |
| `npx next typegen` | Passed |
| `npm run build` | Passed (all routes compiled) |
| `npx vitest run` | Passed: 25 of 25 unit tests |
| `build_and_start` (health check) | Passed; `/api/health` returned ok |

Test results and any seed/smoke outputs are appended below by the final validation run.

## Pending work

- Browser end-to-end tests (Playwright) and HTTP integration suite.
- Random Forest and Gradient Boosting (Python microservice recommended).
- In-app backup/restore; email delivery (optional).
- Academic project report chapters (cover page, certificate, screenshots) — the README and this log contain the factual content for them.

## Next development step

Run the seeded demo end to end (admin → teacher → student → guardian), correct any runtime issues found, then extend the vitest suite with API handler tests.

### Runtime verification (executed against the running build)

- `drizzle-kit push` applied the schema to PostgreSQL (`app_db`).
- Synthetic dataset generated with `npx tsx scripts/seed.ts --reset`: 520 students (all IDs `SYN-`), 2 teachers, 14 subjects, 40 examinations, about 14,000 exam results, about 25,000 attendance records, 24 assignments with about 1,500 submissions, about 1,400 quiz attempts, about 6,800 learning-activity rows, 520 synthetic outcome labels, one trained demonstration model, 520 stored risk assessments, and early-warning alerts.
- Authentication: admin, teacher, student and guardian sign-in returned the correct role redirect.
- Authorisation: a student received HTTP 403 for the staff student list and for another student's record. A teacher's student list returned the 260 students in their allocated classes.
- Analytics: role dashboards returned live aggregates (admin totals, student attendance and results, guardian linked-student view).
- Reports: institutional report downloaded as PDF, CSV and XLSX; a student PDF report downloaded.
- Adaptive quiz: a timed attempt returned five questions without correct answers; submission returned scores and per-question explanations.
- Recommendations: generation produced 29 deduplicated items for the demo student.
- Study planner: weekly plan generated (12 tasks, 60 minutes/day goal).
- Academic assistant: answered from the student's own mastery and the approved resource library.
- Unit tests: `npx vitest run` passed 25 of 25 after correcting one incorrect test expectation (the password policy correctly rejects a password containing the email name).

### Model evaluation note

The first seed run (before attendance and performance calibration) produced a demonstration model with test ROC-AUC of about 0.99 and recall of 1.0 on the synthetic test split. Those values reflect the synthetic generator, which is designed with a strong latent relationship, and must not be cited as real predictive validity. The current metrics are shown on the Risk & AI Models page for the active version.

### Corrections made during verification

- Demo student record was placed in a semester-1 class by the generator; fixed so the demo student is in semester 3 (quizzes, mastery and assignments populate).
- Synthetic attendance was calibrated (average about 80%) so the demonstration is realistic.
- Test case corrected as described above.
