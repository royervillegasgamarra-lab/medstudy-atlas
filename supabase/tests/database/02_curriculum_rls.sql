BEGIN;
SELECT plan(62);

-- ============================================================================
-- 1. Schema, Table & Column Structure
-- ============================================================================
SELECT has_table('public', 'subjects', 'Table public.subjects exists');
SELECT has_table('public', 'exam_targets', 'Table public.exam_targets exists');

SELECT has_column('public', 'subjects', 'id', 'subjects has id');
SELECT has_column('public', 'subjects', 'user_id', 'subjects has user_id');
SELECT has_column('public', 'subjects', 'name', 'subjects has name');
SELECT has_column('public', 'subjects', 'created_at', 'subjects has created_at');
SELECT has_column('public', 'subjects', 'updated_at', 'subjects has updated_at');
SELECT has_column('public', 'subjects', 'archived_at', 'subjects has archived_at');

SELECT has_column('public', 'exam_targets', 'id', 'exam_targets has id');
SELECT has_column('public', 'exam_targets', 'user_id', 'exam_targets has user_id');
SELECT has_column('public', 'exam_targets', 'subject_id', 'exam_targets has subject_id');
SELECT has_column('public', 'exam_targets', 'title', 'exam_targets has title');
SELECT has_column('public', 'exam_targets', 'exam_date', 'exam_targets has exam_date');
SELECT has_column('public', 'exam_targets', 'created_at', 'exam_targets has created_at');
SELECT has_column('public', 'exam_targets', 'updated_at', 'exam_targets has updated_at');
SELECT has_column('public', 'exam_targets', 'archived_at', 'exam_targets has archived_at');

-- Check RLS is enabled on both tables
SELECT results_eq(
    $$ SELECT relrowsecurity FROM pg_class WHERE relname = 'subjects' AND relnamespace = 'public'::regnamespace $$,
    $$ VALUES (true) $$,
    'RLS is enabled on subjects'
);
SELECT results_eq(
    $$ SELECT relrowsecurity FROM pg_class WHERE relname = 'exam_targets' AND relnamespace = 'public'::regnamespace $$,
    $$ VALUES (true) $$,
    'RLS is enabled on exam_targets'
);

-- ============================================================================
-- 2. Setup Test Users
-- ============================================================================
INSERT INTO auth.users (id, email)
VALUES 
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'usera@curriculum.test'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'userb@curriculum.test');

-- Postgres provisions a subject for User B with a known UUID so cross-user FK tests can target it
INSERT INTO public.subjects (id, user_id, name)
VALUES ('11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Fisiología de User B');

-- ============================================================================
-- 3. Anonymous (anon) Role Isolation
-- ============================================================================
SET LOCAL ROLE anon;
SET LOCAL "request.jwt.claims" = '';

SELECT throws_ok(
    $$ SELECT * FROM public.subjects $$,
    '42501',
    NULL,
    'Anon: SELECT denied on subjects'
);
SELECT throws_ok(
    $$ INSERT INTO public.subjects (user_id, name) VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Anon Subject') $$,
    '42501',
    NULL,
    'Anon: INSERT denied on subjects'
);
SELECT throws_ok(
    $$ UPDATE public.subjects SET name = 'Anon Hacked' $$,
    '42501',
    NULL,
    'Anon: UPDATE denied on subjects'
);
SELECT throws_ok(
    $$ DELETE FROM public.subjects $$,
    '42501',
    NULL,
    'Anon: DELETE denied on subjects'
);

SELECT throws_ok(
    $$ SELECT * FROM public.exam_targets $$,
    '42501',
    NULL,
    'Anon: SELECT denied on exam_targets'
);
SELECT throws_ok(
    $$ INSERT INTO public.exam_targets (user_id, title, exam_date) VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Anon Exam', '2027-01-01') $$,
    '42501',
    NULL,
    'Anon: INSERT denied on exam_targets'
);
SELECT throws_ok(
    $$ UPDATE public.exam_targets SET title = 'Anon Hacked' $$,
    '42501',
    NULL,
    'Anon: UPDATE denied on exam_targets'
);
SELECT throws_ok(
    $$ DELETE FROM public.exam_targets $$,
    '42501',
    NULL,
    'Anon: DELETE denied on exam_targets'
);

-- ============================================================================
-- 4. User A Isolation & CRUD on subjects
-- ============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}';

-- User A with 0 active subjects cannot complete onboarding
SELECT throws_ok(
    $$ SELECT public.complete_onboarding() $$,
    '23514',
    NULL,
    'User A (0 active subjects): complete_onboarding throws 23514'
);

SELECT is(
    (SELECT onboarding_completed_at FROM public.user_profiles WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    NULL,
    'User A: onboarding_completed_at remains NULL before adding active subject'
);

-- User A cannot manually supply id on subjects INSERT (privilege revoked)
SELECT throws_ok(
    $$ INSERT INTO public.subjects (id, user_id, name) VALUES ('99999999-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Manual ID') $$,
    '42501',
    NULL,
    'User A: cannot manually supply subjects.id on INSERT (privilege revoked)'
);

-- User A creates own subject using database-generated UUID
INSERT INTO public.subjects (user_id, name)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Anatomía');

SELECT results_eq(
    $$ SELECT name FROM public.subjects WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND name = 'Anatomía' $$,
    $$ VALUES ('Anatomía') $$,
    'User A: can create and select own subject'
);

-- Active duplicate prevention (case-insensitive & trimmed)
SELECT throws_ok(
    $$ INSERT INTO public.subjects (user_id, name) VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '  anatomía  ') $$,
    '23505',
    NULL,
    'User A: cannot create duplicate active subject (case-insensitive and trimmed)'
);

-- User A can rename own subject
UPDATE public.subjects
SET name = 'Anatomía Humana'
WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND name = 'Anatomía';

SELECT results_eq(
    $$ SELECT name FROM public.subjects WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND name = 'Anatomía Humana' $$,
    $$ VALUES ('Anatomía Humana') $$,
    'User A: can rename own subject'
);

-- User A cannot update protected created_at/updated_at on subjects
SELECT throws_ok(
    $$ UPDATE public.subjects SET created_at = NOW() WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
    '42501',
    NULL,
    'User A: cannot update subjects.created_at (privilege revoked)'
);
SELECT throws_ok(
    $$ UPDATE public.subjects SET updated_at = NOW() WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
    '42501',
    NULL,
    'User A: cannot update subjects.updated_at (privilege revoked)'
);

-- User A can archive own subject
UPDATE public.subjects
SET archived_at = NOW()
WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND name = 'Anatomía Humana';

SELECT ok(
    (SELECT archived_at IS NOT NULL FROM public.subjects WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND name = 'Anatomía Humana'),
    'User A: can archive own subject'
);

-- Once archived, same subject name CAN be created again
INSERT INTO public.subjects (user_id, name)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Anatomía Humana');

SELECT results_eq(
    $$ SELECT count(*)::int FROM public.subjects WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND name = 'Anatomía Humana' $$,
    $$ VALUES (2) $$,
    'User A: can re-create subject name after previous instance is archived'
);

-- User A cannot hard DELETE subjects
SELECT throws_ok(
    $$ DELETE FROM public.subjects WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
    '42501',
    NULL,
    'User A: cannot hard DELETE own subject (DELETE privilege revoked)'
);

-- User A cannot change subject owner
SELECT throws_ok(
    $$ UPDATE public.subjects SET user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
    '42501',
    NULL,
    'User A: cannot change subject user_id (UPDATE on user_id revoked)'
);

-- User A cannot insert subject owned by User B
SELECT throws_ok(
    $$ INSERT INTO public.subjects (user_id, name) VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Cardiología') $$,
    '42501',
    NULL,
    'User A: cannot INSERT subject owned by User B'
);

-- ============================================================================
-- 5. User A Onboarding Completion Verification
-- ============================================================================
-- Now that User A has an active subject, complete_onboarding must succeed
SELECT ok(
    public.complete_onboarding() IS NOT NULL,
    'User A (with active subject): complete_onboarding succeeds'
);

SELECT ok(
    (SELECT onboarding_completed_at IS NOT NULL FROM public.user_profiles WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    'User A: onboarding_completed_at is now set'
);

-- Idempotency test: calling complete_onboarding again preserves existing timestamp
SELECT is(
    public.complete_onboarding(),
    (SELECT onboarding_completed_at FROM public.user_profiles WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    'User A: complete_onboarding is idempotent (preserves timestamp)'
);

-- ============================================================================
-- 6. User B Isolation on subjects & Setup User A Known Subject
-- ============================================================================
SET LOCAL ROLE postgres;
-- Postgres provisions a known subject for User A so User B can test attaching to it
INSERT INTO public.subjects (id, user_id, name)
VALUES ('11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Bioquímica de User A');

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"}';

-- User B cannot select User A's subjects
SELECT is_empty(
    $$ SELECT * FROM public.subjects WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
    'User B: cannot SELECT User A subjects'
);

-- User B cannot update User A's subjects
UPDATE public.subjects
SET name = 'Hacked by B'
WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

SELECT pass('User B: cannot UPDATE User A subjects (0 rows affected)');

-- User B creates own subject
INSERT INTO public.subjects (user_id, name)
VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Fisiología');

SELECT results_eq(
    $$ SELECT name FROM public.subjects WHERE user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' AND name = 'Fisiología' $$,
    $$ VALUES ('Fisiología') $$,
    'User B: can create own subject'
);

-- User A cannot complete onboarding for User B (User B profile remains NULL)
SELECT is(
    (SELECT onboarding_completed_at FROM public.user_profiles WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
    NULL,
    'User A operation did not affect User B onboarding_completed_at'
);

-- ============================================================================
-- 7. Exam Targets & Composite Ownership Integrity
-- ============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}';

-- User A cannot manually supply id on exam_targets INSERT (privilege revoked)
SELECT throws_ok(
    $$ INSERT INTO public.exam_targets (id, user_id, title, exam_date) VALUES ('99999999-eeee-eeee-eeee-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Exam ID Test', '2027-01-01') $$,
    '42501',
    NULL,
    'User A: cannot manually supply exam_targets.id on INSERT (privilege revoked)'
);

-- User A creates exam target linked to own active subject
INSERT INTO public.exam_targets (user_id, subject_id, title, exam_date)
VALUES (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    (SELECT id FROM public.subjects WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND name = 'Anatomía Humana' AND archived_at IS NULL LIMIT 1),
    'Examen Parcial de Anatomía',
    '2027-05-20'
);

SELECT results_eq(
    $$ SELECT title FROM public.exam_targets WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND title = 'Examen Parcial de Anatomía' $$,
    $$ VALUES ('Examen Parcial de Anatomía') $$,
    'User A: can create and select own exam target'
);

-- User A creates exam target without subject
INSERT INTO public.exam_targets (user_id, title, exam_date)
VALUES (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'ENAM 2027',
    '2027-11-15'
);

SELECT results_eq(
    $$ SELECT title FROM public.exam_targets WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND title = 'ENAM 2027' $$,
    $$ VALUES ('ENAM 2027') $$,
    'User A: can create exam target with null subject_id'
);

-- User A cannot attach exam to User B subject on INSERT (Composite foreign key violation)
SELECT throws_ok(
    $$ INSERT INTO public.exam_targets (user_id, subject_id, title, exam_date)
       VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 
               '11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
               'Malicious Exam', '2027-06-01') $$,
    '23503',
    NULL,
    'User A: cannot attach exam target to User B subject on INSERT (composite FK violation)'
);

-- User A cannot change exam target subject_id to User B subject on UPDATE (Composite foreign key violation)
SELECT throws_ok(
    $$ UPDATE public.exam_targets 
       SET subject_id = '11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
       WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND title = 'ENAM 2027' $$,
    '23503',
    NULL,
    'User A: cannot change exam target subject_id to User B subject on UPDATE (composite FK check)'
);

-- User A can update own exam target
UPDATE public.exam_targets
SET title = 'Examen Final de Anatomía',
    exam_date = '2027-06-01'
WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND title = 'Examen Parcial de Anatomía';

SELECT results_eq(
    $$ SELECT title FROM public.exam_targets WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND title = 'Examen Final de Anatomía' $$,
    $$ VALUES ('Examen Final de Anatomía') $$,
    'User A: can update own exam target'
);

-- User A cannot update protected created_at/updated_at on exam_targets
SELECT throws_ok(
    $$ UPDATE public.exam_targets SET created_at = NOW() WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
    '42501',
    NULL,
    'User A: cannot update exam_targets.created_at (privilege revoked)'
);
SELECT throws_ok(
    $$ UPDATE public.exam_targets SET updated_at = NOW() WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
    '42501',
    NULL,
    'User A: cannot update exam_targets.updated_at (privilege revoked)'
);

-- User A can archive own exam target
UPDATE public.exam_targets
SET archived_at = NOW()
WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND title = 'Examen Final de Anatomía';

SELECT ok(
    (SELECT archived_at IS NOT NULL FROM public.exam_targets WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND title = 'Examen Final de Anatomía'),
    'User A: can archive own exam target'
);

-- User A cannot hard DELETE exam target
SELECT throws_ok(
    $$ DELETE FROM public.exam_targets WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
    '42501',
    NULL,
    'User A: cannot hard DELETE exam target (DELETE privilege revoked)'
);

-- User A cannot change exam target user_id
SELECT throws_ok(
    $$ UPDATE public.exam_targets SET user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
    '42501',
    NULL,
    'User A: cannot change exam target user_id (UPDATE on user_id revoked)'
);

-- ============================================================================
-- 8. User B Isolation on exam_targets
-- ============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"}';

-- User B cannot select User A's exam targets
SELECT is_empty(
    $$ SELECT * FROM public.exam_targets WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
    'User B: cannot SELECT User A exam targets'
);

-- User B cannot update User A's exam targets
UPDATE public.exam_targets
SET title = 'Hacked Exam'
WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

SELECT pass('User B: cannot UPDATE User A exam targets (0 rows affected)');

-- User B cannot attach exam to User A's subject
SELECT throws_ok(
    $$ INSERT INTO public.exam_targets (user_id, subject_id, title, exam_date)
       VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 
               '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 
               'User B on User A Subject', '2027-08-10') $$,
    '23503',
    NULL,
    'User B: cannot attach exam target to User A subject (composite FK violation)'
);

-- ============================================================================
-- 9. Cascade Cleanup Lifecycle
-- ============================================================================
SET LOCAL ROLE postgres;

DELETE FROM auth.users WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

SELECT is_empty(
    $$ SELECT * FROM public.subjects WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
    'Cascade: deleting auth user deletes owned subjects'
);
SELECT is_empty(
    $$ SELECT * FROM public.exam_targets WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
    'Cascade: deleting auth user deletes owned exam targets'
);

SELECT * FROM finish();
ROLLBACK;
