# Execution Report: Phase 1B — Onboarding, Curriculum & Exam Targets

- **Phase / Task**: Phase 1B — Onboarding, Curriculum & Exam Targets
- **Status**: COMPLETE
- **Mode**: LOCAL-FIRST
- **Branch**: `phase/01b-onboarding`
- **Review Package**: `review-output/phase-01b-review.zip`
- **Review Target**: Phase 1B committed checkpoint on `phase/01b-onboarding`
- **Canonical Commit SHA**: Exact commit SHA is captured in `review-output/phase-01b-review.zip` (`REVIEW.md` and `test-results/*.log`).
- **Objective**: Implement student onboarding wizard, academic context capture, normalized curriculum structure (subjects), upcoming exam targets with deterministic countdowns, database-enforced onboarding completion, and the first useful authenticated dashboard for medical students with local-first isolation and $0.00 cloud spend.

---

## 1. Work Completed

1. **Phase 1A Housekeeping & Review Package Script Hardening**:
   - `scripts/create-review-package.ps1`: Hardened verification pipeline with mandatory `install` check (`pnpm install --frozen-lockfile`), commit-bound execution log headers (`COMMAND`, `EXIT_CODE`, `TIMESTAMP`, `BRANCH`, `HEAD_SHA`, `PHASE`), strict validation of logs against current commit SHA, branch, and phase, and post-verification clean working tree enforcement.
   - `docs/status.md`: Updated to Phase 1B snapshot and generalized database test suite phrasing.
   - `docs/reports/phase-01a-identity.md`: Corrected ADR 001 attribution.

2. **Database Schema & Curriculum Normalization (Migration `20260919210000_curriculum_and_onboarding.sql`)**:
   - Normalized `user_profiles`: Added `onboarding_completed_at TIMESTAMPTZ DEFAULT NULL`, dropped deprecated `target_exam_date` column, and updated `year_of_study` check constraint to support 1–10 years of medical study.
   - Created `subjects` table: `(id, user_id, name, created_at, updated_at, archived_at)`.
   - Added partial unique index `idx_subjects_user_name_unique` on `(user_id, lower(trim(name))) WHERE archived_at IS NULL` to prevent active duplicate names per user while allowing archival.
   - Created `exam_targets` table: `(id, user_id, subject_id, title, exam_date, created_at, updated_at, archived_at)`.
   - Enforced database-level composite foreign key:
     `FOREIGN KEY (subject_id, user_id) REFERENCES subjects(id, user_id) ON DELETE SET NULL (subject_id)`
     guaranteeing cross-user subject hijacking is impossible at the database engine level.
   - Attached `private.handle_updated_at()` trigger to both `subjects` and `exam_targets`.
   - Applied explicit PostgreSQL least-privilege model: Revoked all permissions from `PUBLIC` and `anon`. Direct table `DELETE` is strictly REVOKED from `authenticated` on `subjects` and `exam_targets` (soft-deletion/archival is performed via `UPDATE` on `archived_at`). Granted `authenticated` SELECT, INSERT (column-restricted: `user_id, name` for `subjects`; `user_id, subject_id, title, exam_date` for `exam_targets`), and UPDATE (column-restricted: `name, archived_at` for `subjects`; `subject_id, title, exam_date, archived_at` for `exam_targets`) guarded by Row Level Security (RLS) with `auth.uid() = user_id`.
   - Database-enforced onboarding completion: Direct `UPDATE` on `user_profiles.onboarding_completed_at` is revoked from `authenticated` and `anon`. Onboarding completion is enforced at the database layer via `public.complete_onboarding()` RPC (`SECURITY DEFINER`, `SET search_path = ''`). The function validates caller identity via `auth.uid()`, strictly verifies caller owns at least one active (non-archived) subject, and stamps `onboarding_completed_at` idempotently.

3. **Database Quality Verification (pgTAP Test Suite)**:
   - Updated `supabase/tests/database/01_user_profiles_rls.sql` (66 assertions): verified `onboarding_completed_at`, absence of `target_exam_date`, `year_of_study` up to 10, function privileges, and direct UPDATE denial on `onboarding_completed_at`.
   - Authored `supabase/tests/database/02_curriculum_rls.sql` (62 assertions):
     - Table existence, columns, types, and defaults for `subjects` and `exam_targets`.
     - Active unique index `idx_subjects_user_name_unique` on `subjects (user_id, lower(trim(name)))` preventing duplicate active names.
     - Database-level composite foreign key preventing User 1 from linking User 2's subject.
     - `ON DELETE SET NULL (subject_id)` composite behavior upon subject deletion.
     - Anon denial (SELECT, INSERT, UPDATE, DELETE throw 42501).
     - Full User 1 and User 2 RLS isolation (SELECT, INSERT, UPDATE).
     - Direct DELETE denial for authenticated users.
     - Manual `id` supply denial on INSERT for `subjects` and `exam_targets`.
     - `complete_onboarding()` RPC caller validation, active subject requirement, and idempotency.
   - Executed `pnpm db:reset`, `pnpm db:types`, and `pnpm db:test`: Total 128 tests across 2 test files, all passing (`PASS`).

4. **Deterministic Date & Countdown Utilities (`src/lib/date-utils.ts`)**:
   - Centralized `America/Lima` (UTC-5) timezone constant (`MVP_TIMEZONE`).
   - Pure string-based calendar date parsing (`parseDateParts`) that avoids UTC timezone offsets.
   - `formatExamDate`: Formats dates deterministically into Peruvian Spanish (`es-PE`) (e.g., `15 de agosto de 2027`).
   - `getRemainingDays`: Computes precise integer day differences relative to Lima timezone (`America/Lima`) calendar-day boundaries.
   - `getCalendarDateInLima`: Returns current calendar date in Lima for input constraints and filtering.
   - Covered by 12 comprehensive unit tests in `tests/unit/date-utils.test.ts` (including UTC boundary and midnight transition tests).

5. **Curriculum Module (`src/modules/curriculum`)**:
   - `types.ts`: Domain models `Subject`, `ExamTarget`, `ExamTargetWithSubject`, and input types.
   - `validation.ts`: Zod schemas for creating and updating subjects and exam targets with calendar validation, future date checks, and trimmed strings.
   - `service.ts`: Backend service methods (`getActiveSubjects`, `createSubject`, `renameSubject`, `archiveSubject`, `getUpcomingExamTargets`, `createExamTarget`, `updateExamTarget`, `archiveExamTarget`). `getUpcomingExamTargets()` strictly filters `exam_date >= today in Lima`.
   - `actions.ts`: Next.js Server Actions with error sanitization to protect database internals.
   - Covered by 16 comprehensive unit tests in `tests/unit/curriculum.test.ts`.

6. **Identity & Onboarding Completion Logic (`src/modules/identity`)**:
   - Added `saveAcademicBasicsAction` and `completeOnboardingAction`.
   - Database-enforced onboarding completion: `completeOnboarding()` calls `public.complete_onboarding()` RPC which verifies $\ge 1$ active subject exists before stamping `onboarding_completed_at` on `user_profiles`. Client assertion is never trusted.
   - Removed `onboarding_completed_at` from application `UpdateProfileInput` and `updateProfile()` service to prevent direct modification.
   - Updated `ProfileUpdateSchema` and `SignupSchema` to support years 1–10 and nullable optional fields.
   - Updated `src/components/auth/profile-form.tsx` to reflect the normalized schema.
   - Covered by 17 unit tests in `tests/unit/identity.test.ts`.

7. **Onboarding Wizard & Resumability (`src/app/onboarding`, `src/components/onboarding`)**:
   - 3-step progressive wizard:
     - Step 1: Academic context (medical school, year of study 1–10) with skip option.
     - Step 2: What are you studying? (at least 1 active subject required to proceed).
     - Step 3: Upcoming exam target (optional, requires both title and date to save) or skip & finish.
   - Partial exam input protection: "Guardar examen y finalizar" requires both non-empty title and date; handler rejects partial input with defense in depth; "Omitir y Finalizar" provides explicit skip path with zero silent discard.
   - Full resumability: Wizard checks existing database state on reload. If subjects already exist, resumes at Step 3; if academic context exists, resumes at Step 2; otherwise starts at Step 1.
   - Trapping defense: Users who attempt to access `/onboarding` after completing onboarding are redirected to `/app`.

8. **First Useful Authenticated Dashboard (`src/app/app/page.tsx`, `src/components/curriculum`)**:
   - Greeting with student name, medical school, and year of study.
   - Upcoming Exam Banner: Highlights the earliest upcoming exam with days-remaining countdown badge.
   - `SubjectManager`: List active subjects, add new subject with duplicate name validation, inline rename, and soft-delete archive with confirmation dialog.
   - `ExamManager`: List upcoming exams with dates and countdowns, add new exam, inline edit, and archive with confirmation dialog.
   - Empty states for students with no scheduled exams.

9. **Route Protection & Middleware (`src/proxy.ts`, `src/app/app/layout.tsx`, `src/app/onboarding/layout.tsx`)**:
   - `/onboarding` is included in protected routes.
   - `/app/layout.tsx` redirects authenticated users who have not completed onboarding (`onboarding_completed_at IS NULL`) to `/onboarding`.
   - `/onboarding/layout.tsx` redirects authenticated users who have already completed onboarding to `/app`.

10. **E2E & Browser Verification (Playwright)**:
    - 16 E2E tests across 4 test files (`auth-isolation.spec.ts`, `curriculum-management.spec.ts`, `onboarding.spec.ts`, `smoke.spec.ts`).
    - Open redirect protection verified in `auth-isolation.spec.ts`.
    - User-content XSS regression verified for both subject and exam title in `curriculum-management.spec.ts`.
    - Partial exam input handling and non-discard verified in `onboarding.spec.ts`.
    - Captured required screenshots in `docs/screenshots`: `onboarding-desktop.png`, `onboarding-mobile.png`, `dashboard.png`, `subjects.png`, `exam-targets.png`, `authenticated-app.png`, `profile.png`, `mobile-authenticated.png`, `desktop-light.png`, `desktop-dark.png`.
    - All 16 E2E tests pass cleanly.

---

## 2. File Changes

### Important Files Created
- `supabase/migrations/20260919210000_curriculum_and_onboarding.sql` — Schema migration for `subjects`, `exam_targets`, `onboarding_completed_at`, composite foreign key, `complete_onboarding()` RPC, and least-privilege RLS policies.
- `supabase/tests/database/02_curriculum_rls.sql` — 62 pgTAP tests verifying curriculum tables, active unique constraint, composite foreign key isolation, manual id denial, direct DELETE denial, and complete_onboarding RPC.
- `src/lib/date-utils.ts` — Deterministic date formatting (`es-PE`) and countdown utilities avoiding timezone shifts.
- `src/modules/curriculum/types.ts` — Curriculum TypeScript domain models.
- `src/modules/curriculum/validation.ts` — Zod schemas for subjects and exam targets.
- `src/modules/curriculum/service.ts` — Database query service for subjects and exam targets.
- `src/modules/curriculum/actions.ts` — Server actions for curriculum management with error sanitization.
- `src/modules/curriculum/index.ts` — Module barrel export.
- `src/components/curriculum/subject-manager.tsx` — Interactive subject CRUD and archival UI component.
- `src/components/curriculum/exam-manager.tsx` — Interactive exam target CRUD and archival UI component.
- `src/components/onboarding/onboarding-wizard.tsx` — 3-step progressive onboarding wizard with database resumability and partial exam validation.
- `src/app/onboarding/layout.tsx` — Layout protecting `/onboarding` and redirecting completed users to `/app`.
- `src/app/onboarding/page.tsx` — Page rendering the onboarding wizard.
- `docs/product/onboarding.md` — Product specification for student onboarding.
- `tests/unit/curriculum.test.ts` — 16 unit tests for curriculum validation schemas.
- `tests/unit/date-utils.test.ts` — 12 unit tests for date, boundary, and countdown utilities.
- `tests/e2e/curriculum-management.spec.ts` — E2E test verifying subject and exam CRUD, editing, archival, subject + exam-title XSS regression, and screenshot capture.
- `tests/e2e/onboarding.spec.ts` — E2E test verifying onboarding scenarios (skip exam, with exam, resumability, partial exam non-discard, trapping defense).
- `docs/screenshots/onboarding-desktop.png` — Visual evidence of desktop onboarding.
- `docs/screenshots/onboarding-mobile.png` — Visual evidence of mobile onboarding.
- `docs/screenshots/dashboard.png` — Visual evidence of authenticated dashboard.
- `docs/screenshots/subjects.png` — Visual evidence of subject management.
- `docs/screenshots/exam-targets.png` — Visual evidence of exam targets and countdowns.

### Important Files Modified
- `scripts/create-review-package.ps1` — Hardened verification checks, mandatory install check, commit-bound log headers, stale evidence detection, and post-verification clean tree check.
- `docs/status.md` — Updated to Phase 1B snapshot and generalized database test suite phrasing.
- `docs/reports/phase-01a-identity.md` — Corrected ADR 001 attribution.
- `docs/architecture/data-model.md` — Updated data model with Phase 1B normalized schema and Course entity simplification note.
- `docs/security/threat-model.md` — Updated with subjects/exam_targets RLS, column-level restrictions, and complete_onboarding RPC.
- `docs/engineering/local-quality-gates.md` — Generalized verification pipeline to reusable baseline.
- `docs/product/mvp-definition.md` — Synchronized with Subject-first hierarchy, optional exam target, and 1C/1D scope.
- `README.md` — Updated current phase to 1B and next checkpoint to 1C.
- `supabase/tests/database/01_user_profiles_rls.sql` — 66 pgTAP tests for `onboarding_completed_at`, `year_of_study` 1–10, and direct UPDATE denial on `onboarding_completed_at`.
- `src/types/database.ts` — Regenerated TypeScript types from local Supabase database.
- `src/config/app.ts` — Updated phase metadata to Phase 1B.
- `src/proxy.ts` — Added `/onboarding` to protected route matcher.
- `src/app/app/layout.tsx` — Added check redirecting uncompleted users to `/onboarding`.
- `src/app/app/page.tsx` — Replaced placeholder dashboard with first useful authenticated dashboard.
- `src/app/page.tsx` — Updated landing page badges and links to Phase 1B.
- `src/components/auth/profile-form.tsx` — Removed deprecated target exam date; updated year of study to 1–10.
- `src/modules/identity/actions.ts` — Added `saveAcademicBasicsAction` and `completeOnboardingAction`.
- `src/modules/identity/service.ts` — Added `completeOnboarding` with `public.complete_onboarding()` RPC call.
- `src/modules/identity/types.ts` — Added `onboarding_completed_at` to `UserProfile`, removed from `UpdateProfileInput`.
- `src/modules/identity/validation.ts` — Updated `SignupSchema`, `ProfileUpdateSchema`, and added `AcademicProfileSchema`.
- `tests/unit/config.test.ts` — Updated to expect Phase 1B.
- `tests/unit/identity.test.ts` — Added tests for `AcademicProfileSchema` and year of study range.
- `tests/e2e/smoke.spec.ts` — Updated to verify Phase 1B landing page badges and copy.
- `tests/e2e/auth-isolation.spec.ts` — Added open-redirect protection test; updated lifecycle test to navigate through onboarding.

---

## 3. Architecture & Subsystem Impact

- **Architecture Decisions**:
  - Maintained ADR 001 and ADR 002 principles.
  - Simplified curriculum model for MVP: `Subject` is the primary curriculum container; `Course` entity is deferred.
  - Enforced cross-user subject ownership integrity at the database layer via composite foreign key `FOREIGN KEY (subject_id, user_id) REFERENCES subjects(id, user_id)`.
  - Database-enforced onboarding completion: Direct `UPDATE` on `user_profiles.onboarding_completed_at` is revoked. `public.complete_onboarding()` RPC (`SECURITY DEFINER`, `SET search_path = ''`) verifies `auth.uid()` and requires $\ge 1$ active subject before stamping `onboarding_completed_at`.
- **Database Impact**:
  - `user_profiles` updated (`onboarding_completed_at` added, `target_exam_date` dropped, `year_of_study` constraint 1–10).
  - New tables `subjects` and `exam_targets` with active unique index, composite foreign key, and strict RLS.
- **API Impact**:
  - Next.js Server Actions for curriculum and onboarding operations: `createSubjectAction`, `renameSubjectAction`, `archiveSubjectAction`, `createExamTargetAction`, `updateExamTargetAction`, `archiveExamTargetAction`, `saveAcademicBasicsAction`, `completeOnboardingAction`.
  - Zero SQL or internal database error leakage.
- **AI Impact**: NONE. (Scheduled per repository roadmap: 1C documents/storage, 1D document ingestion/processing, 1E Study Pack generation, 1F AI Tutor).
- **Background-Job Impact**: NONE.
- **Dependencies Introduced**: NONE. Zero new npm packages added.

---

## 4. Security & Compliance Review

- **Security Review**:
  - ASVS-aligned security review performed; no known blocking findings.
  - Cross-tenant data isolation verified via composite foreign key and RLS policies on `subjects` and `exam_targets`.
  - Database-enforced onboarding completion: direct `UPDATE` on `user_profiles.onboarding_completed_at` is revoked. `complete_onboarding()` RPC with `SECURITY DEFINER` and `SET search_path = ''` verifies caller owns $\ge 1$ active subject before recording completion.
  - Least-privilege column grants: `id` manual supply denied for `subjects` and `exam_targets`; direct table `DELETE` revoked on curriculum tables.
  - Open redirect defense: protocol-relative and backslash bypass targets sanitized.
  - User-content XSS regression: script and HTML tags rendered safely as plain text without execution.
  - Sanitized backend error handling ensures database internals are never leaked.
  - Zero secrets or credentials committed.
- **Medical & Content Safety**:
  - Educational positioning maintained throughout UI copy ("Entorno de Estudio Médico", "asignaturas y metas de evaluación").
  - Zero PHI or unverified proprietary medical content included.
- **Environment Variables**:
  - No new environment variables required. Existing:
    - `NEXT_PUBLIC_SUPABASE_URL`
    - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
    - `NEXT_PUBLIC_APP_URL`
    - `NODE_ENV`

---

## 5. Verification & Quality

- **Tests / Checks Executed**:
  - `pnpm install --frozen-lockfile`: PASS
  - `pnpm format:check`: PASS (All matched files use Prettier code style)
  - `pnpm lint`: PASS (0 errors, 0 warnings)
  - `pnpm typecheck`: PASS (0 TypeScript errors)
  - `pnpm test`: PASS (8 test files, 66 unit tests passing)
  - `pnpm build`: PASS (Turbopack production build succeeded; all static and dynamic routes compiled)
  - `pnpm test:e2e`: PASS (16 E2E tests passing across 4 test files, screenshots captured)
  - `pnpm audit`: PASS (No known vulnerabilities found)
  - `pnpm db:reset`: PASS (Local database reset, migrations applied cleanly)
  - `pnpm db:types`: PASS (TypeScript database types generated)
  - `pnpm db:test`: PASS (128 pgTAP tests passing across 2 test files)
- **Browser Verification**:
  - Desktop light & dark mode verified.
  - Mobile viewport verified with zero horizontal overflow.
  - Onboarding flow, subject CRUD, exam CRUD, open redirect defense, user-content XSS regression, and dashboard countdown verified via Playwright.
- **Performance Impact**:
  - Server Components used for initial dashboard data fetch.
  - Separate service calls for upcoming exam targets and active subjects.
- **Analytics Impact**: NONE.
- **Cost Impact**: $0.00. 100% local-first execution.

---

## 6. Deviations, Issues & Debt

- **Deviations from Specification**: NONE. All Phase 1B requirements and external review corrections fulfilled.
- **Known Issues**: NONE.
- **Blockers**: NONE.
- **Technical Debt Knowingly Introduced**:
  - `Course` entity deferred to a future phase; `Subject` serves as the curriculum container for MVP.
  - Email duplication between `auth.users` and `public.user_profiles` remains documented non-blocking technical debt from Phase 1A.

---

## 7. Next Steps & Readiness

- **Git Status**: Committed clean checkpoint on `phase/01b-onboarding`.
- **Recommended Next Step**: Review package inspection, followed by Vertical Slice 1C — Document Library & Secure Upload (`phase/01c-documents`).
- **READY_FOR_EXTERNAL_REVIEW**: YES

