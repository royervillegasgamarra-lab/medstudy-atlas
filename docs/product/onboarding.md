# MedStudy Atlas — Student Onboarding & Curriculum Specification

## 1. Executive Purpose
The onboarding experience in MedStudy Atlas is engineered to minimize friction and guide newly registered medical students rapidly to educational value. It replaces cumbersome upfront questionnaires with a lightweight progressive flow that captures minimal academic context, establishes user-owned subjects, and optionally registers upcoming exam targets.

---

## 2. Minimum Completion State
To complete onboarding and unlock `/app`, the following conditions must be satisfied:
1. **Authenticated User Profile**: An active user identity exists in Supabase Auth and `public.user_profiles`.
2. **At Least One Active Subject**: At least one active (non-archived) record in `public.subjects` owned by the student (`user_id = auth.uid()`).

**Optional Elements**:
- **Medical School**: Optional free-text field (max 150 characters).
- **Year of Study**: Optional integer between 1 and 10 (covering standard LATAM medical school curricula and internships).
- **Exam Target**: Optional. Students without an immediate dated evaluation can skip this step.

---

## 3. Onboarding Flow Structure (`/onboarding`)

### Step 1: Academic Context
- **Fields**:
  - `medical_school`: Bounded free text (optional).
  - `year_of_study`: Practical range 1–10, with "Prefiero no especificar / Otro" option (optional).
- **Action**: Can save and advance to Step 2, or skip directly.

### Step 2: What Are You Studying? (Subjects)
- **Requirement**: Student must register at least one subject (e.g. *Anatomía*, *Farmacología*, *Cardiología*).
- **Uniqueness**: Active subjects are unique per user via case-insensitive, whitespace-trimmed functional unique index (`idx_subjects_user_name_unique`).
- **Action**: "Continuar al Paso 3" becomes enabled once $\ge 1$ subject exists.

### Step 3: Upcoming Exam Target (Optional)
- **Fields**:
  - `title`: Exam title (1–160 characters).
  - `exam_date`: Calendar date `YYYY-MM-DD` (today or future).
  - `subject_id`: Optional association with one of the student's subjects.
- **Actions**:
  - "Guardar examen y finalizar": Persists exam target and invokes `completeOnboardingAction()`.
  - "Omitir y Finalizar": Invokes `completeOnboardingAction()` without creating an exam.

---

## 4. Server-Side Completion & Security
- **No Client Trust**: The client cannot send `onboardingComplete=true`.
- **Server Verification**: The server action `completeOnboardingAction()` verifies from the database that at least one active subject exists for the user session under active Row Level Security (RLS).
- **Timestamp Marker**: Only upon verified database check does the server set `user_profiles.onboarding_completed_at = NOW()`.

---

## 5. Authenticated Routing & Resumability
- **Unauthenticated Users**: Visiting `/onboarding` or `/app` redirects to `/auth/login?redirect=...`.
- **Authenticated + Incomplete**: Visiting `/app` redirects to `/onboarding`.
- **Authenticated + Completed**: Visiting `/onboarding` redirects to `/app`.
- **Resumability**: Onboarding state is derived from existing database records (`user_profiles`, `subjects`). Closing the browser does not reset progress; on return, the user resumes from the incomplete step.

---

## 6. Subject & Exam Target Behaviors

### Subjects (`public.subjects`)
- User-owned and isolated via RLS.
- Operations: Create, rename, and archive (soft-delete). Hard delete is revoked from user roles.
- Once archived, the same subject name can be registered again.

### Exam Targets (`public.exam_targets`)
- User-owned and isolated via RLS.
- **Ownership Integrity**: Enforced at the database layer via composite foreign key:
  `FOREIGN KEY (subject_id, user_id) REFERENCES public.subjects(id, user_id) ON DELETE SET NULL (subject_id)`.
  User A cannot reference User B's subject under any circumstance.
- Operations: Create, edit, and archive (soft-delete).
- Dashboard display calculates deterministic days remaining without timezone conversion shifts.

---

## 7. Deferred Curriculum Features (Post-MVP)
- **Course Table Hierarchy**: A separate `Course` container (e.g., *Medicina Interna* -> *Cardiología*) is deferred until real syllabus requirements justify it. `Subject` serves as the primary curriculum container for MVP.
- **Global Official Curricula / Pre-Seeded Universities**: Medical schools and national blueprints remain user-created to eliminate early licensing and content maintenance overhead.
- **Shared Curricula & Drag-and-Drop Reordering**: Deferred to post-MVP iterations.
