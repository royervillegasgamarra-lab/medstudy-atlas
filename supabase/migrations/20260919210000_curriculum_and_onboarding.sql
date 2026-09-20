-- Migration: 20260919210000_curriculum_and_onboarding.sql
-- Description: Normalize user_profiles, add subjects and exam_targets with composite ownership foreign key and strict RLS

-- ============================================================================
-- 1. Normalize public.user_profiles
-- ============================================================================

-- Add onboarding_completed_at marker
ALTER TABLE public.user_profiles
    ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

-- Drop obsolete Phase 1A prework field target_exam_date
ALTER TABLE public.user_profiles
    DROP COLUMN IF EXISTS target_exam_date;

-- Expand year_of_study check constraint to practical range 1-10
ALTER TABLE public.user_profiles
    DROP CONSTRAINT IF EXISTS user_profiles_year_of_study_check;

ALTER TABLE public.user_profiles
    ADD CONSTRAINT user_profiles_year_of_study_check CHECK (year_of_study BETWEEN 1 AND 10);

-- Update private.handle_new_user() trigger function to support 1-10 range and omit target_exam_date
CREATE OR REPLACE FUNCTION private.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.user_profiles (
        id,
        email,
        full_name,
        medical_school,
        year_of_study
    )
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''), 'Colega Médico'),
        NULLIF(TRIM(NEW.raw_user_meta_data->>'medical_school'), ''),
        CASE 
            WHEN (NEW.raw_user_meta_data->>'year_of_study') ~ '^([1-9]|10)$' 
            THEN (NEW.raw_user_meta_data->>'year_of_study')::int 
            ELSE NULL 
        END
    )
    ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), public.user_profiles.full_name),
        medical_school = COALESCE(EXCLUDED.medical_school, public.user_profiles.medical_school),
        year_of_study = COALESCE(EXCLUDED.year_of_study, public.user_profiles.year_of_study);
    RETURN NEW;
END;
$$;

-- Refresh explicit grants on public.user_profiles
REVOKE ALL ON TABLE public.user_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.user_profiles TO authenticated;
GRANT UPDATE (full_name, medical_school, year_of_study) ON TABLE public.user_profiles TO authenticated;

-- ============================================================================
-- 2. Curriculum: public.subjects
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.subjects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at TIMESTAMPTZ,
    CONSTRAINT uq_subjects_id_user_id UNIQUE (id, user_id)
);

-- Case-insensitive, whitespace-trimmed unique index on active subjects per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_subjects_user_name_unique
    ON public.subjects (user_id, lower(trim(name)))
    WHERE archived_at IS NULL;

-- Trigger for updated_at
DROP TRIGGER IF EXISTS on_subjects_updated ON public.subjects;
CREATE TRIGGER on_subjects_updated
    BEFORE UPDATE ON public.subjects
    FOR EACH ROW
    EXECUTE FUNCTION private.handle_updated_at();

-- Row Level Security
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own subjects" ON public.subjects;
CREATE POLICY "Users can view own subjects"
    ON public.subjects
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own subjects" ON public.subjects;
CREATE POLICY "Users can insert own subjects"
    ON public.subjects
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own subjects" ON public.subjects;
CREATE POLICY "Users can update own subjects"
    ON public.subjects
    FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Explicit Privilege Model for subjects
REVOKE ALL ON TABLE public.subjects FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT (user_id, name) ON TABLE public.subjects TO authenticated;
GRANT UPDATE (name, archived_at) ON TABLE public.subjects TO authenticated;

-- ============================================================================
-- 3. Exam Targets: public.exam_targets
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.exam_targets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    subject_id UUID,
    title TEXT NOT NULL,
    exam_date DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at TIMESTAMPTZ,
    -- Composite foreign key enforcing: exam_targets.user_id = subjects.user_id when subject_id IS NOT NULL
    CONSTRAINT fk_exam_targets_subject_owner FOREIGN KEY (subject_id, user_id)
        REFERENCES public.subjects(id, user_id)
        ON DELETE SET NULL (subject_id)
);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS on_exam_targets_updated ON public.exam_targets;
CREATE TRIGGER on_exam_targets_updated
    BEFORE UPDATE ON public.exam_targets
    FOR EACH ROW
    EXECUTE FUNCTION private.handle_updated_at();

-- Row Level Security
ALTER TABLE public.exam_targets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own exam targets" ON public.exam_targets;
CREATE POLICY "Users can view own exam targets"
    ON public.exam_targets
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own exam targets" ON public.exam_targets;
CREATE POLICY "Users can insert own exam targets"
    ON public.exam_targets
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own exam targets" ON public.exam_targets;
CREATE POLICY "Users can update own exam targets"
    ON public.exam_targets
    FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Explicit Privilege Model for exam_targets
REVOKE ALL ON TABLE public.exam_targets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT (user_id, subject_id, title, exam_date) ON TABLE public.exam_targets TO authenticated;
GRANT UPDATE (subject_id, title, exam_date, archived_at) ON TABLE public.exam_targets TO authenticated;

-- ============================================================================
-- 4. Secure Onboarding Completion RPC: public.complete_onboarding()
-- ============================================================================

CREATE OR REPLACE FUNCTION public.complete_onboarding()
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_has_active_subject BOOLEAN;
    v_completed_at TIMESTAMPTZ;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
    END IF;

    -- Verify caller owns at least one active subject
    SELECT EXISTS (
        SELECT 1
        FROM public.subjects
        WHERE user_id = v_user_id
          AND archived_at IS NULL
    ) INTO v_has_active_subject;

    IF NOT v_has_active_subject THEN
        RAISE EXCEPTION 'Cannot complete onboarding without at least one active subject.' USING ERRCODE = '23514';
    END IF;

    -- Update onboarding_completed_at idempotently (retain initial timestamp if already set)
    UPDATE public.user_profiles
    SET onboarding_completed_at = COALESCE(public.user_profiles.onboarding_completed_at, clock_timestamp())
    WHERE id = v_user_id
    RETURNING onboarding_completed_at INTO v_completed_at;

    RETURN v_completed_at;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_onboarding() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_onboarding() TO authenticated;
