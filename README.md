# AI-Based Student Digital Learning Risk & Adaptive Recommendation System

An academic monitoring platform that estimates student academic risk, explains the factors behind each estimate, generates personalised learning recommendations, runs adaptive quizzes, tracks topic mastery, and gives teachers and administrators the workflows needed to act on the results.

**Demonstration data is synthetic.** Every generated student has an ID beginning `SYN-`, every outcome label is marked `synthetic`, and the UI shows a SYNTHETIC badge. The metrics produced on demonstration data verify the pipeline; they do not establish real-world predictive accuracy.

---

## 1. Architecture and deviations from the brief

The platform runtime for this project is **Next.js 16 (App Router) + TypeScript + Tailwind CSS 4 + Drizzle ORM + PostgreSQL**. The brief named a Vite/React frontend with a separate FastAPI/Python backend. Those were replaced by a single Next.js application for these reasons: one runtime to install on Windows, one process to start, one language end to end, and no network hop between UI and API. The mapping is:

| Brief requirement | Implementation here |
|---|---|
| React + Vite + React Router | Next.js App Router pages (client components) |
| FastAPI REST routes (`/api/...`) | Route handlers under `src/app/api/**` (same route groups) |
| SQLAlchemy / Alembic | Drizzle ORM schema in `src/db/schema.ts`; migrations applied with `drizzle-kit push` |
| SQLite dev / PostgreSQL | PostgreSQL only (`DATABASE_URL`) |
| Scikit-learn LR / RF / GB | Logistic Regression and Gaussian Naive Bayes implemented in TypeScript (no Python runtime). Random Forest and Gradient Boosting are **not implemented** (future work) |
| Pandas / NumPy / Joblib / SHAP | Not used. Permutation importance and coefficient contributions are implemented directly; models are persisted as JSON in `model_versions` |
| ReportLab / OpenPyXL | `pdf-lib` (PDF), `exceljs` (Excel), hand-written CSV |
| Pytest / RTL / Playwright | Vitest unit tests (`tests/`). Browser and API end-to-end tests are listed as pending |
| TanStack Query / Axios / React Hook Form | Small `useFetch` hook over `fetch`; forms use controlled state with server-side Zod validation |

Pure functions (ML maths, grading, mastery rules, CSV validation) are dependency-free and unit tested.

### Security model
- Passwords: `scrypt` (Node built-in) with a per-user random salt; never stored in plain text.
- Sessions: random 256-bit token in an `httpOnly`, `SameSite=Lax` cookie. Only the SHA-256 hash is stored; sessions expire after 8 hours and are deleted on logout or password reset.
- Account protection: failed-login counter, 15-minute lock after 5 failures, admin unlock, rate limits on login, registration and password reset.
- Account lifecycle: self-registration creates a *pending* account linked to an existing student ID; an administrator approves it. Accounts can be suspended and reactivated.
- Authorisation: every API handler calls `requireUser(roles)`; object-level checks (`assertStudentAccess`, `assertTeacherClassSubject`, `classesForSubject`) enforce teacher class allocation, student self-access and guardian approved links. Layouts also guard pages, but the API never relies on the UI.
- Input validation: Zod on every mutating endpoint; SQL is parameterised through Drizzle or `sql` template placeholders.
- Uploads: extension allow-list, MIME allow-list, size limits and file-signature (magic byte) checks; files are stored under random names and served only through an authenticated route.
- Other: same-origin check on mutations, `nosniff` on files, audit log for security and academic-data events, and generic error messages for unexpected failures.

---

## 2. Roles

| Role | Scope |
|---|---|
| Administrator | Everything: academic setup, people and accounts, allocations, students (create, edit, import, archive), ML training and activation, settings and policies, audit log, reports, dataset tools |
| Teacher | Students in allocated classes; attendance, exams and marks, assignments, quizzes and question bank for allocated subjects; early warnings and interventions for their students; private observations |
| Student | Own record only: results, attendance, assignments, quizzes, learning plan, recommendations, mastery, planner, assistant, own reports |
| Guardian | Approved linked students only, read-only: published results, attendance, assignments, exam schedule, progress summary, published report. Never private observations |

---

## 3. Demo accounts

Passwords are read from `DEMO_PASSWORD` in `.env` (default in `.env.example`: `ChangeMe@12345`; the shipped `.env` uses `Demo@12345`). Change it before any shared use.

| Role | Email | Password |
|---|---|---|
| Administrator | `admin@demo.edu` | `Demo@12345` |
| Teacher (class BCA-S3-A/B: Database Systems, Operating Systems) | `teacher@demo.edu` | `Demo@12345` |
| Teacher (Web Technologies, Software Engineering) | `vikram.iyer@demo.edu` | `Demo@12345` |
| Student (synthetic record `SYN-0001`) | `student@demo.edu` | `Demo@12345` |
| Guardian (approved link to `SYN-0001`) | `guardian@demo.edu` | `Demo@12345` |

Self-registration as a student or guardian requires a student ID (for example `SYN-0002`) and administrator approval.

---

## 4. Installation and running on Windows 10/11

### Prerequisites
1. **Node.js 20 LTS or newer** (includes npm): https://nodejs.org. Check with `node -v` and `npm -v`.
2. **PostgreSQL 14+**: https://www.postgresql.org/download/windows/. Remember the `postgres` password and create a database named `app_db`:
   ```bat
   psql -U postgres -c "CREATE DATABASE app_db;"
   ```
3. Visual Studio Code is optional but recommended.

### Configure
Copy `.env.example` to `.env` (the launcher does this automatically) and check:
```
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db
DEMO_PASSWORD=Demo@12345
COOKIE_SECURE=false
EMAIL_ENABLED=false
```

### First run (creates tables and seeds demo data)
```bat
run_project.bat --seed
```
The launcher checks Node and npm, installs dependencies if needed, applies the schema with `drizzle-kit push` (non-destructive), seeds the synthetic dataset only if the database is empty, builds the app if necessary, and starts the server on port 3000 (or 3100 if 3000 is busy).

Open **http://localhost:3000** and sign in with a demo account.

### Subsequent runs
```bat
run_project.bat
```
Existing academic data is never overwritten on launch. Use `run_project.bat --rebuild` after code changes.

### Reset the demonstration data
```bat
reset_demo_data.bat
```
Requires typing `RESET`. This deletes all application data and regenerates the synthetic dataset.

### Manual commands (any OS)
```bash
npm install
npx drizzle-kit push
npx tsx scripts/seed.ts            # only when the database is empty
npm run build
npx next start -p 3000
npx vitest run                     # unit tests
```

### Troubleshooting
- *Schema push fails with a connection error:* PostgreSQL is not running, the port differs, or `DATABASE_URL` is wrong.
- *Login says the account is awaiting approval:* only self-registered accounts need approval; the seeded demo accounts are active.
- *"Account temporarily locked":* wait 15 minutes, or an administrator can unlock it in People & Accounts.
- *Port 3000 busy:* the launcher falls back to 3100 automatically.

---

## 5. Using the system: the end-to-end workflow

1. **Administrator** creates departments, programmes, classes, subjects and topics in *Academic Setup*; creates teacher accounts and allocates them to subject-and-class pairs in *People & Accounts*; adds students (or imports a CSV/Excel file after preview and validation) in *Students*.
2. **Teacher** records attendance in *Attendance* (duplicate sessions are blocked; corrections require a reason), schedules examinations and enters marks in *Examinations & Marks* (a blank mark is stored as "not entered", never zero), and publishes results, which notifies students and guardians.
3. **Teacher** creates assignments (with validated attachments), evaluates submissions with marks and feedback, and maintains the question bank.
4. **Student** signs in, views the dashboard, submits assignments, takes timed adaptive quizzes (difficulty adapts to accuracy and mastery) and reads explanations after submission.
5. **Administrator** (Risk & AI Models) trains the risk model: the pipeline compares Logistic Regression, Gaussian Naive Bayes and the rule-based baseline, selects by cross-validated F2, evaluates once on the held-out test split, and stores the version. Then *Run risk assessments* scores every student.
6. **Student** opens *Learning Plan & AI*: explainable factors for the latest assessment, recommendations with measurable goals (mark complete, rate usefulness), mastery history, a weekly study plan generated from weak topics, upcoming exams and pending work, and the academic assistant.
7. **Student** completes recommended activities; subsequent quiz results update topic mastery, and each recommendation records a measured before/after score change.
8. **Teacher** reviews early-warning alerts (acknowledge, resolve, reopen), opens an intervention case, logs a support session, a private observation, a follow-up and a revision task, then closes the case when appropriate.
9. **Administrator** reviews the institutional dashboard and generates PDF, CSV and Excel reports.

---

## 6. Machine learning methodology

**Features (12).** Internal assessment average; mid-semester average; previous-semester end-exam average; attendance (present + late over marked sessions, excused excluded); assignment completion over past-deadline assignments; missed assignments; quiz average; practice quizzes completed; study hours per day (last 14 days); active learning days (14 days); learning consistency (1 − coefficient of variation of weekly minutes, clamped); share of weak subjects. Protected personal characteristics are not used.

**Missing data.** Missing values remain `null`. They are imputed with the **training median** (never zero), flagged in every prediction record, and listed in the explanation.

**Leakage controls.** End-semester results are excluded from features because they define the outcome label. Median and standardisation statistics are fitted on training rows only, and cross-validation refits preprocessing inside every fold. The test split is used once for reporting, never for selection.

**Training.** Stratified 80/20 split (seed 42). Logistic regression with L2 regularisation, λ chosen from {0.0001, 0.001, 0.01, 0.1, 1} by 5-fold stratified CV, class-balanced loss weights, and a decision threshold tuned on out-of-fold predictions to maximise F2 (recall-weighted). Gaussian Naive Bayes is fitted with the same CV protocol. The model with the higher CV F2 is selected.

**Evaluation.** Accuracy, precision, recall (at-risk class), F1, F2, specificity, false-positive rate, ROC-AUC, confusion matrix, per-class classification report, CV results, train-versus-test AUC gap (overfitting check), permutation importance and data-quality report (missing rates, outliers |z| > 3, duplicate feature rows, class balance).

**Risk classes.** Probability thresholds are configurable in *Policies & grading* (low < high, validated). Low, medium and high map to the probability bands. A transparent rule-based screen (count of nine indicators: 0–1 low, 2–3 medium, 4+ high) is always computed alongside the model.

**Explanations.** For each assessment: category, probability and score; risk-increasing and protective factors ranked by standardised coefficient × value; global permutation importance; plain-language observations; rule triggers; change since the previous assessment; suggested intervention; and a causal disclaimer. Explanations are associations, not causes.

---

## 7. Testing

```bash
npx vitest run
```
Unit tests cover: stratified splitting and determinism; median imputation and training-only scaling; logistic regression and Naive Bayes behaviour; ROC-AUC, confusion matrix and threshold search; rule screening and missing-value handling; risk categories; grading bands; mastery levels and evidence rules; CSV parsing; student import validation (missing columns, duplicates, existing IDs, invalid semester); password hashing, policy and rate limiting.

Results of the most recent run are recorded in `DEVELOPMENT_PROGRESS.md`. Browser (Playwright) and HTTP end-to-end suites are documented as pending in `FEATURE_TRACEABILITY.md`.

---

## 8. Project structure

```
src/
  app/
    (app)/            authenticated pages (layout guards by role)
      admin/ teacher/ student/ guardian/   role dashboards and admin tools
      students/ attendance/ exams/ assignments/ quizzes/ alerts/ interventions/
      resources/ timetable/ discussions/ reports/ notifications/ profile/
    api/              REST route handlers (auth, users, academics, students, teachers,
                      allocations, attendance, exams, assignments, quizzes, resources,
                      ml, risk, recommendations, planner, interventions, alerts,
                      notifications, timetable, analytics, reports, guardians, admin,
                      discussions, assistant, settings, files)
    login/ register/ forgot-password/
  components/         UI primitives, app shell, charts
  db/                 Drizzle client and schema
  lib/
    ml/               logistic regression, Naive Bayes, metrics, features, rules, training, prediction
    mastery.ts quiz.ts recommendations.ts early-warning.ts analytics.ts
    reports.ts csv.ts uploads.ts seed.ts security.ts auth.ts access.ts settings.ts events.ts
scripts/seed.ts       command-line seeding
tests/unit/           Vitest suites
run_project.bat       Windows launcher
reset_demo_data.bat   confirmed reset of demonstration data
```

---

## 9. Limitations

- The synthetic dataset demonstrates the pipeline. Predictions from it have no real-world validity. Train on validated institutional outcome labels (CSV/Excel column `historical_outcome`) before any operational use.
- Random Forest and Gradient Boosting are not implemented in this runtime.
- Email delivery is not configured; password reset links are shown on screen.
- Discussions have basic moderation (report, flag, close, remove); there is no automated content filtering.
- The AI assistant is rule-based retrieval over approved resources and the student's records. It does not call an external LLM and does not generate new educational content.
- Rate limiting and the session store are in-process; a multi-instance deployment needs a shared store.
- Backup is performed with standard PostgreSQL tools (`pg_dump`); no in-app backup scheduler is provided.
- Mobile layout is responsive, but dense tables are best used on tablet or desktop widths.

## 10. Future scope

Random Forest and Gradient Boosting in a Python microservice with SHAP; institutional outcome-label ingestion pipeline; SMS/email notifications; LMS integration; full browser and API end-to-end test suites; in-app encrypted backups; accessibility audit (WCAG 2.2 AA) and localisation.
