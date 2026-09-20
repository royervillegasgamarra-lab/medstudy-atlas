BEGIN;
SELECT plan(66);

-- 1. Schema & Relation Structure
SELECT has_table('public', 'user_profiles', 'Table public.user_profiles exists');
SELECT hasnt_view('public', 'profiles', 'View public.profiles removed (canonical relation is user_profiles)');

-- Check functions exist in private schema and not in public schema
SELECT has_function('private', 'handle_updated_at', 'Function private.handle_updated_at exists in private schema');
SELECT hasnt_function('public', 'handle_updated_at', 'Function public.handle_updated_at does not exist in public schema');
SELECT results_eq(
    $$ SELECT has_function_privilege('public', 'private.handle_updated_at()', 'execute') $$,
    $$ VALUES (false) $$,
    'Public has no EXECUTE privilege on private.handle_updated_at'
);
SELECT results_eq(
    $$ SELECT has_function_privilege('anon', 'private.handle_updated_at()', 'execute') $$,
    $$ VALUES (false) $$,
    'Anon has no EXECUTE privilege on private.handle_updated_at'
);
SELECT results_eq(
    $$ SELECT has_function_privilege('authenticated', 'private.handle_updated_at()', 'execute') $$,
    $$ VALUES (false) $$,
    'Authenticated has no EXECUTE privilege on private.handle_updated_at'
);
SELECT results_eq(
    $$ SELECT has_function_privilege('public', 'private.handle_new_user()', 'execute') $$,
    $$ VALUES (false) $$,
    'Public has no EXECUTE privilege on private.handle_new_user'
);
SELECT results_eq(
    $$ SELECT has_function_privilege('anon', 'private.handle_new_user()', 'execute') $$,
    $$ VALUES (false) $$,
    'Anon has no EXECUTE privilege on private.handle_new_user'
);
SELECT results_eq(
    $$ SELECT has_function_privilege('authenticated', 'private.handle_new_user()', 'execute') $$,
    $$ VALUES (false) $$,
    'Authenticated has no EXECUTE privilege on private.handle_new_user'
);

-- Check complete_onboarding function exists and is restricted
SELECT has_function('public', 'complete_onboarding', 'Function public.complete_onboarding exists in public schema');
SELECT results_eq(
    $$ SELECT prosecdef FROM pg_proc WHERE proname = 'complete_onboarding' AND pronamespace = 'public'::regnamespace $$,
    $$ VALUES (true) $$,
    'public.complete_onboarding is SECURITY DEFINER'
);
SELECT results_eq(
    $$ SELECT has_function_privilege('public', 'public.complete_onboarding()', 'execute') $$,
    $$ VALUES (false) $$,
    'Public has no EXECUTE privilege on public.complete_onboarding'
);
SELECT results_eq(
    $$ SELECT has_function_privilege('anon', 'public.complete_onboarding()', 'execute') $$,
    $$ VALUES (false) $$,
    'Anon has no EXECUTE privilege on public.complete_onboarding'
);
SELECT results_eq(
    $$ SELECT has_function_privilege('authenticated', 'public.complete_onboarding()', 'execute') $$,
    $$ VALUES (true) $$,
    'Authenticated has EXECUTE privilege on public.complete_onboarding'
);

-- Check columns exist
SELECT has_column('public', 'user_profiles', 'id', 'user_profiles has id');
SELECT has_column('public', 'user_profiles', 'email', 'user_profiles has email');
SELECT has_column('public', 'user_profiles', 'full_name', 'user_profiles has full_name');
SELECT has_column('public', 'user_profiles', 'medical_school', 'user_profiles has medical_school');
SELECT has_column('public', 'user_profiles', 'year_of_study', 'user_profiles has year_of_study');
SELECT has_column('public', 'user_profiles', 'onboarding_completed_at', 'user_profiles has onboarding_completed_at');
SELECT has_column('public', 'user_profiles', 'created_at', 'user_profiles has created_at');
SELECT has_column('public', 'user_profiles', 'updated_at', 'user_profiles has updated_at');
SELECT hasnt_column('public', 'user_profiles', 'target_exam_date', 'user_profiles does not have dead field target_exam_date');
SELECT hasnt_column('public', 'user_profiles', 'target_exam_id', 'user_profiles does not have dead field target_exam_id');

-- Check RLS is enabled
SELECT results_eq(
    $$ SELECT relrowsecurity FROM pg_class WHERE relname = 'user_profiles' AND relnamespace = 'public'::regnamespace $$,
    $$ VALUES (true) $$,
    'RLS is enabled on user_profiles'
);

-- 2. Trigger Provisioning on auth.users INSERT
INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES 
    ('11111111-1111-1111-1111-111111111111', 'user1@example.com', '{"full_name": "User One", "medical_school": "UNMSM", "year_of_study": 5}'::jsonb),
    ('22222222-2222-2222-2222-222222222222', 'user2@example.com', '{"full_name": "User Two", "medical_school": "UPCH", "year_of_study": 3}'::jsonb),
    ('33333333-3333-3333-3333-333333333333', 'user3@example.com', '{}'::jsonb);

SELECT is(
    (SELECT full_name FROM public.user_profiles WHERE id = '11111111-1111-1111-1111-111111111111'),
    'User One',
    'User 1 profile auto-created by hardened trigger'
);
SELECT is(
    (SELECT medical_school FROM public.user_profiles WHERE id = '11111111-1111-1111-1111-111111111111'),
    'UNMSM',
    'User 1 medical school auto-populated by hardened trigger'
);
SELECT is(
    (SELECT year_of_study FROM public.user_profiles WHERE id = '11111111-1111-1111-1111-111111111111'),
    5,
    'User 1 year of study auto-populated by hardened trigger'
);
SELECT is(
    (SELECT full_name FROM public.user_profiles WHERE id = '33333333-3333-3333-3333-333333333333'),
    'Colega Médico',
    'User 3 profile defaults to Colega Médico when metadata is empty'
);

-- 3. Anonymous (anon) Role Isolation
SET LOCAL ROLE anon;
SET LOCAL "request.jwt.claims" = '';

SELECT throws_ok(
    $$ SELECT * FROM public.user_profiles $$,
    '42501',
    NULL,
    'Anon: SELECT denied (permission denied)'
);

SELECT throws_ok(
    $$ UPDATE public.user_profiles SET full_name = 'Anon Hacked' WHERE id = '11111111-1111-1111-1111-111111111111' $$,
    '42501',
    NULL,
    'Anon: UPDATE denied'
);

SELECT throws_ok(
    $$ INSERT INTO public.user_profiles (id, email, full_name) VALUES ('33333333-3333-3333-3333-333333333333', 'anon@test.com', 'Anon') $$,
    '42501',
    NULL,
    'Anon: INSERT denied'
);

SELECT throws_ok(
    $$ DELETE FROM public.user_profiles WHERE id = '11111111-1111-1111-1111-111111111111' $$,
    '42501',
    NULL,
    'Anon: DELETE denied'
);

SELECT throws_ok(
    $$ SELECT private.handle_updated_at() $$,
    '42501',
    NULL,
    'Anon: cannot call private.handle_updated_at directly'
);

SELECT throws_ok(
    $$ SELECT private.handle_new_user() $$,
    '42501',
    NULL,
    'Anon: cannot call private.handle_new_user directly'
);

-- 4. User 1 (authenticated) Isolation & Permissions
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111111111"}';

-- Can SELECT own profile
SELECT results_eq(
    $$ SELECT id FROM public.user_profiles $$,
    $$ VALUES ('11111111-1111-1111-1111-111111111111'::uuid) $$,
    'User 1: can SELECT own profile'
);

-- Cannot SELECT User 2 profile
SELECT is_empty(
    $$ SELECT * FROM public.user_profiles WHERE id = '22222222-2222-2222-2222-222222222222' $$,
    'User 1: cannot SELECT User 2 profile'
);

-- Can UPDATE explicitly permitted own profile fields
DO $$
BEGIN
    UPDATE public.user_profiles
    SET full_name = 'User One Updated',
        medical_school = 'Universidad Nacional Mayor de San Marcos',
        year_of_study = 6
    WHERE id = '11111111-1111-1111-1111-111111111111';
END $$;

SELECT is(
    (SELECT full_name FROM public.user_profiles WHERE id = '11111111-1111-1111-1111-111111111111'),
    'User One Updated',
    'User 1: can UPDATE explicitly permitted own profile fields'
);

SELECT ok(
    (SELECT updated_at >= created_at FROM public.user_profiles WHERE id = '11111111-1111-1111-1111-111111111111'),
    'User 1: updated_at was refreshed by handle_updated_at trigger'
);

-- Cannot UPDATE User 2 profile (0 rows affected by RLS)
DO $$
DECLARE
    affected_rows int;
BEGIN
    UPDATE public.user_profiles
    SET full_name = 'Hacked User Two'
    WHERE id = '22222222-2222-2222-2222-222222222222';
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows != 0 THEN
        RAISE EXCEPTION 'RLS UPDATE violation: User 1 was able to update User 2 profile!';
    END IF;
END $$;
SELECT pass('User 1: cannot UPDATE User 2 profile (0 rows affected)');

-- Cannot INSERT own profile manually (privilege revoked)
SELECT throws_ok(
    $$ INSERT INTO public.user_profiles (id, email, full_name) VALUES ('11111111-1111-1111-1111-111111111111', 'user1@example.com', 'Duplicate') $$,
    '42501',
    NULL,
    'User 1: cannot INSERT own profile manually (privilege revoked)'
);

-- Cannot INSERT User 2 profile manually (privilege revoked)
SELECT throws_ok(
    $$ INSERT INTO public.user_profiles (id, email, full_name) VALUES ('22222222-2222-2222-2222-222222222222', 'imposter@test.com', 'Imposter') $$,
    '42501',
    NULL,
    'User 1: cannot INSERT User 2 profile manually (privilege revoked)'
);

-- Cannot DELETE own profile directly (privilege revoked)
SELECT throws_ok(
    $$ DELETE FROM public.user_profiles WHERE id = '11111111-1111-1111-1111-111111111111' $$,
    '42501',
    NULL,
    'User 1: cannot DELETE own profile directly (privilege revoked)'
);

-- Cannot change ownership / id (column update privilege not granted)
SELECT throws_ok(
    $$ UPDATE public.user_profiles SET id = '22222222-2222-2222-2222-222222222222' WHERE id = '11111111-1111-1111-1111-111111111111' $$,
    '42501',
    NULL,
    'User 1: cannot change ownership/id (column update privilege not granted)'
);

-- Cannot update system-managed column email (column update privilege not granted)
SELECT throws_ok(
    $$ UPDATE public.user_profiles SET email = 'hacked@example.com' WHERE id = '11111111-1111-1111-1111-111111111111' $$,
    '42501',
    NULL,
    'User 1: cannot update system-managed email column'
);

-- Cannot update system-managed column created_at (column update privilege not granted)
SELECT throws_ok(
    $$ UPDATE public.user_profiles SET created_at = NOW() WHERE id = '11111111-1111-1111-1111-111111111111' $$,
    '42501',
    NULL,
    'User 1: cannot update system-managed created_at column'
);

-- Cannot update system-managed column updated_at (column update privilege not granted)
SELECT throws_ok(
    $$ UPDATE public.user_profiles SET updated_at = NOW() WHERE id = '11111111-1111-1111-1111-111111111111' $$,
    '42501',
    NULL,
    'User 1: cannot update system-managed updated_at column'
);

-- Cannot update onboarding_completed_at directly (column update privilege revoked)
SELECT throws_ok(
    $$ UPDATE public.user_profiles SET onboarding_completed_at = NOW() WHERE id = '11111111-1111-1111-1111-111111111111' $$,
    '42501',
    NULL,
    'User 1: cannot directly UPDATE onboarding_completed_at (privilege revoked)'
);

-- Cannot clear onboarding_completed_at directly (column update privilege revoked)
SELECT throws_ok(
    $$ UPDATE public.user_profiles SET onboarding_completed_at = NULL WHERE id = '11111111-1111-1111-1111-111111111111' $$,
    '42501',
    NULL,
    'User 1: cannot directly clear onboarding_completed_at (privilege revoked)'
);

SELECT throws_ok(
    $$ SELECT private.handle_updated_at() $$,
    '42501',
    NULL,
    'User 1: cannot call private.handle_updated_at directly'
);

SELECT throws_ok(
    $$ SELECT private.handle_new_user() $$,
    '42501',
    NULL,
    'User 1: cannot call private.handle_new_user directly'
);

-- 5. User 2 (authenticated) Symmetric Isolation
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222222222"}';

SELECT results_eq(
    $$ SELECT id FROM public.user_profiles $$,
    $$ VALUES ('22222222-2222-2222-2222-222222222222'::uuid) $$,
    'User 2: can SELECT own profile'
);

SELECT is_empty(
    $$ SELECT * FROM public.user_profiles WHERE id = '11111111-1111-1111-1111-111111111111' $$,
    'User 2: cannot SELECT User 1 profile'
);

DO $$
DECLARE
    affected_rows int;
BEGIN
    UPDATE public.user_profiles
    SET full_name = 'Hacked User One'
    WHERE id = '11111111-1111-1111-1111-111111111111';
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows != 0 THEN
        RAISE EXCEPTION 'RLS UPDATE violation: User 2 was able to update User 1 profile!';
    END IF;
END $$;
SELECT pass('User 2: cannot UPDATE User 1 profile (0 rows affected)');

DO $$
BEGIN
    UPDATE public.user_profiles
    SET full_name = 'User Two Updated',
        medical_school = 'Universidad Peruana Cayetano Heredia',
        year_of_study = 4
    WHERE id = '22222222-2222-2222-2222-222222222222';
END $$;

SELECT is(
    (SELECT full_name FROM public.user_profiles WHERE id = '22222222-2222-2222-2222-222222222222'),
    'User Two Updated',
    'User 2: can UPDATE explicitly permitted own profile fields'
);

-- User 2 cannot directly UPDATE onboarding_completed_at
SELECT throws_ok(
    $$ UPDATE public.user_profiles SET onboarding_completed_at = NOW() WHERE id = '22222222-2222-2222-2222-222222222222' $$,
    '42501',
    NULL,
    'User 2: cannot directly UPDATE onboarding_completed_at (privilege revoked)'
);

SELECT ok(
    (SELECT updated_at >= created_at FROM public.user_profiles WHERE id = '22222222-2222-2222-2222-222222222222'),
    'User 2: updated_at was refreshed by handle_updated_at trigger'
);

SELECT throws_ok(
    $$ INSERT INTO public.user_profiles (id, email, full_name) VALUES ('22222222-2222-2222-2222-222222222222', 'user2@example.com', 'Duplicate') $$,
    '42501',
    NULL,
    'User 2: cannot INSERT own profile manually (privilege revoked)'
);

SELECT throws_ok(
    $$ INSERT INTO public.user_profiles (id, email, full_name) VALUES ('11111111-1111-1111-1111-111111111111', 'imposter@test.com', 'Imposter') $$,
    '42501',
    NULL,
    'User 2: cannot INSERT User 1 profile manually (privilege revoked)'
);

SELECT throws_ok(
    $$ DELETE FROM public.user_profiles WHERE id = '22222222-2222-2222-2222-222222222222' $$,
    '42501',
    NULL,
    'User 2: cannot DELETE own profile directly (privilege revoked)'
);

-- Cannot change ownership / id (column update privilege not granted)
SELECT throws_ok(
    $$ UPDATE public.user_profiles SET id = '11111111-1111-1111-1111-111111111111' WHERE id = '22222222-2222-2222-2222-222222222222' $$,
    '42501',
    NULL,
    'User 2: cannot change ownership/id (column update privilege not granted)'
);

-- Cannot update system-managed column email (column update privilege not granted)
SELECT throws_ok(
    $$ UPDATE public.user_profiles SET email = 'hacked2@example.com' WHERE id = '22222222-2222-2222-2222-222222222222' $$,
    '42501',
    NULL,
    'User 2: cannot update system-managed email column'
);

-- Cannot update system-managed column created_at (column update privilege not granted)
SELECT throws_ok(
    $$ UPDATE public.user_profiles SET created_at = NOW() WHERE id = '22222222-2222-2222-2222-222222222222' $$,
    '42501',
    NULL,
    'User 2: cannot update system-managed created_at column'
);

-- Cannot update system-managed column updated_at (column update privilege not granted)
SELECT throws_ok(
    $$ UPDATE public.user_profiles SET updated_at = NOW() WHERE id = '22222222-2222-2222-2222-222222222222' $$,
    '42501',
    NULL,
    'User 2: cannot update system-managed updated_at column'
);

-- 6. Cascade Deletion Test
SET LOCAL ROLE postgres;
DELETE FROM auth.users WHERE id = '11111111-1111-1111-1111-111111111111';

SELECT is_empty(
    $$ SELECT * FROM public.user_profiles WHERE id = '11111111-1111-1111-1111-111111111111' $$,
    'Cascade: deleting auth.users row deletes related user_profiles row'
);

SELECT * FROM finish();
ROLLBACK;
