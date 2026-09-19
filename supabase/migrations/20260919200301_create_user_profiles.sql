-- Migration: 20260919200301_create_user_profiles.sql
-- Description: Create user_profiles table, hardened trigger, column-level privileges, and RLS policies

-- 1. Create user_profiles table (canonical profile relation)
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    full_name TEXT,
    medical_school TEXT,
    year_of_study INT CHECK (year_of_study BETWEEN 1 AND 7),
    target_exam_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Drop unused compatibility view if it exists (canonical model is public.user_profiles)
DROP VIEW IF EXISTS public.profiles;

-- 2. Explicit Privilege Model (Table and Column Level)
-- Revoke all table-wide permissions from PUBLIC, anon, and authenticated
REVOKE ALL ON TABLE public.user_profiles FROM PUBLIC, anon, authenticated;

-- anon: no permissions (no SELECT, no INSERT, no UPDATE, no DELETE)
-- authenticated: SELECT permitted (subject to RLS)
GRANT SELECT ON TABLE public.user_profiles TO authenticated;

-- authenticated: explicit column-level UPDATE grants ONLY on user-editable fields
-- System-managed columns (id, email, created_at, updated_at) have NO update grant
GRANT UPDATE (full_name, medical_school, year_of_study, target_exam_date) ON TABLE public.user_profiles TO authenticated;

-- 3. Enable Row Level Security
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies
-- SELECT: Authenticated users can view only their own profile
DROP POLICY IF EXISTS "Users can view own profile" ON public.user_profiles;
CREATE POLICY "Users can view own profile"
    ON public.user_profiles
    FOR SELECT
    TO authenticated
    USING (auth.uid() = id);

-- UPDATE: Authenticated users can update only their own profile
DROP POLICY IF EXISTS "Users can update own profile" ON public.user_profiles;
CREATE POLICY "Users can update own profile"
    ON public.user_profiles
    FOR UPDATE
    TO authenticated
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- No INSERT policy: Profile creation is strictly controlled by trusted auth.users trigger.
-- Direct INSERT is forbidden and revoked.
DROP POLICY IF EXISTS "Users can insert own profile" ON public.user_profiles;

-- 5. Private Schema & Updated_at trigger function
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO postgres, supabase_auth_admin, service_role;

CREATE OR REPLACE FUNCTION private.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- Revoke execute from public/anon/authenticated on handle_updated_at
REVOKE ALL ON FUNCTION private.handle_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.handle_updated_at() TO postgres, supabase_auth_admin, service_role;

DROP TRIGGER IF EXISTS on_user_profiles_updated ON public.user_profiles;
CREATE TRIGGER on_user_profiles_updated
    BEFORE UPDATE ON public.user_profiles
    FOR EACH ROW
    EXECUTE FUNCTION private.handle_updated_at();

-- Also clean up legacy public function if exists
DROP FUNCTION IF EXISTS public.handle_updated_at();

-- 6. Hardened Security Definer Trigger for User Provisioning
-- Helper function in private schema to isolate privileged logic
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
            WHEN (NEW.raw_user_meta_data->>'year_of_study') ~ '^[1-7]$' 
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

-- Revoke execute from public/anon/authenticated on the trigger function
REVOKE ALL ON FUNCTION private.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.handle_new_user() TO postgres, supabase_auth_admin, service_role;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION private.handle_new_user();

-- Also clean up legacy public function if exists
DROP FUNCTION IF EXISTS public.handle_new_user();
