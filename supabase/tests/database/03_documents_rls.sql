BEGIN;
SELECT plan(50);

-- ============================================================================
-- 1. Schema, Table & Column Structure
-- ============================================================================
SELECT has_table('public', 'documents', 'Table public.documents exists');

SELECT has_column('public', 'documents', 'id', 'documents has id');
SELECT has_column('public', 'documents', 'user_id', 'documents has user_id');
SELECT has_column('public', 'documents', 'subject_id', 'documents has subject_id');
SELECT has_column('public', 'documents', 'original_filename', 'documents has original_filename');
SELECT has_column('public', 'documents', 'storage_provider', 'documents has storage_provider');
SELECT has_column('public', 'documents', 'storage_bucket', 'documents has storage_bucket');
SELECT has_column('public', 'documents', 'storage_key', 'documents has storage_key');
SELECT has_column('public', 'documents', 'mime_type', 'documents has mime_type');
SELECT has_column('public', 'documents', 'size_bytes', 'documents has size_bytes');
SELECT has_column('public', 'documents', 'status', 'documents has status');
SELECT has_column('public', 'documents', 'validation_error_code', 'documents has validation_error_code');
SELECT has_column('public', 'documents', 'sha256_hash', 'documents has sha256_hash');
SELECT has_column('public', 'documents', 'created_at', 'documents has created_at');
SELECT has_column('public', 'documents', 'updated_at', 'documents has updated_at');
SELECT has_column('public', 'documents', 'archived_at', 'documents has archived_at');

-- P0-1: Confirm finalize_token does NOT exist
SELECT hasnt_column('public', 'documents', 'finalize_token', 'documents does NOT have finalize_token');

-- Check RLS is enabled on public.documents
SELECT results_eq(
    $$ SELECT relrowsecurity FROM pg_class WHERE relname = 'documents' AND relnamespace = 'public'::regnamespace $$,
    $$ VALUES (true) $$,
    'RLS is enabled on public.documents'
);

-- Check storage bucket 'documents' is private
SELECT results_eq(
    $$ SELECT public FROM storage.buckets WHERE id = 'documents' $$,
    $$ VALUES (false) $$,
    'Storage bucket documents is strictly private'
);

-- ============================================================================
-- 2. Setup Test Users & Fixtures
-- ============================================================================
INSERT INTO auth.users (id, email)
VALUES 
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'usera@documents.test'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'userb@documents.test');

-- User A subject
INSERT INTO public.subjects (id, user_id, name)
VALUES ('11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Cardiología de User A');

-- User B subject
INSERT INTO public.subjects (id, user_id, name)
VALUES ('22222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Neumología de User B');

-- Temp table to store User A's test document ID across role changes
CREATE TEMP TABLE test_doc_context (
    doc_id UUID
);
GRANT ALL ON test_doc_context TO authenticated, anon, service_role;

-- ============================================================================
-- 3. Anonymous (anon) Role Isolation
-- ============================================================================
SET LOCAL ROLE anon;
SET LOCAL "request.jwt.claims" = '';

SELECT throws_ok(
    $$ SELECT * FROM public.documents $$,
    '42501',
    NULL,
    'Anon: SELECT denied on public.documents'
);

SELECT throws_ok(
    $$ INSERT INTO public.documents (user_id, original_filename, storage_key, size_bytes)
       VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'anon.pdf', 'anon/anon.pdf', 1000) $$,
    '42501',
    NULL,
    'Anon: INSERT denied on public.documents'
);

SELECT throws_ok(
    $$ UPDATE public.documents SET status = 'READY' $$,
    '42501',
    NULL,
    'Anon: UPDATE denied on public.documents'
);

SELECT throws_ok(
    $$ DELETE FROM public.documents $$,
    '42501',
    NULL,
    'Anon: DELETE denied on public.documents'
);

SELECT throws_ok(
    $$ SELECT * FROM public.request_document_upload('anon.pdf', 1024, 'application/pdf') $$,
    '42501',
    NULL,
    'Anon: EXECUTE denied on request_document_upload'
);

SELECT throws_ok(
    $$ SELECT * FROM public.finalize_document_upload_privileged('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1024) $$,
    '42501',
    NULL,
    'Anon: EXECUTE denied on finalize_document_upload_privileged'
);

SELECT throws_ok(
    $$ SELECT public.archive_document('11111111-1111-1111-1111-111111111111') $$,
    '42501',
    NULL,
    'Anon: EXECUTE denied on archive_document'
);

-- ============================================================================
-- 4. Authenticated Role: Least-Privilege Denials (P0-1, P0-3)
-- ============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}';

SELECT throws_ok(
    $$ INSERT INTO public.documents (user_id, original_filename, storage_key, size_bytes)
       VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'direct.pdf', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/1/source.pdf', 1000) $$,
    '42501',
    NULL,
    'Authenticated: Direct INSERT denied on public.documents'
);

SELECT throws_ok(
    $$ UPDATE public.documents SET status = 'READY' $$,
    '42501',
    NULL,
    'Authenticated: Direct UPDATE denied on public.documents'
);

SELECT throws_ok(
    $$ DELETE FROM public.documents $$,
    '42501',
    NULL,
    'Authenticated: Direct DELETE denied on public.documents'
);

-- P0-1 & P0-7: Authenticated cannot execute privileged finalization
SELECT throws_ok(
    $$ SELECT * FROM public.finalize_document_upload_privileged('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1024) $$,
    '42501',
    NULL,
    'Authenticated: EXECUTE denied on finalize_document_upload_privileged'
);

-- P0-3: Direct storage.objects mutation and select policies are removed
SELECT is_empty(
    $$ SELECT * FROM storage.objects WHERE bucket_id = 'documents' $$,
    'Authenticated: Direct SELECT on storage.objects returns empty (no broad select policy)'
);

-- ============================================================================
-- 5. DB Input Hardening (P1-2)
-- ============================================================================

-- Filename cannot be empty
SELECT throws_ok(
    $$ SELECT * FROM public.request_document_upload('', 1024, 'application/pdf') $$,
    '22023',
    NULL,
    'request_document_upload: Rejects empty filename'
);

-- Size cannot be <= 0
SELECT throws_ok(
    $$ SELECT * FROM public.request_document_upload('file.pdf', 0, 'application/pdf') $$,
    '22023',
    NULL,
    'request_document_upload: Rejects size <= 0'
);

-- Size cannot exceed 25 MB
SELECT throws_ok(
    $$ SELECT * FROM public.request_document_upload('file.pdf', 26214401, 'application/pdf') $$,
    '22023',
    NULL,
    'request_document_upload: Rejects size > 25 MB'
);

-- MIME must be application/pdf
SELECT throws_ok(
    $$ SELECT * FROM public.request_document_upload('file.exe', 1024, 'application/x-msdownload') $$,
    '22023',
    NULL,
    'request_document_upload: Rejects non-PDF MIME'
);

-- Cross-user subject hijacking check (User A tries to link User B's subject)
SELECT throws_ok(
    $$ SELECT * FROM public.request_document_upload('file.pdf', 1024, 'application/pdf', '22222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb') $$,
    '23503',
    NULL,
    'request_document_upload: Rejects linking another user subject'
);

-- ============================================================================
-- 6. Successful Upload Request & Canonical Key (P0-3)
-- ============================================================================

DO $$
DECLARE
    v_res RECORD;
BEGIN
    SELECT * INTO v_res FROM public.request_document_upload('guia_cardiologia.pdf', 1048576, 'application/pdf', '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    INSERT INTO test_doc_context (doc_id) VALUES (v_res.document_id);
END $$;

SELECT results_eq(
    $$ SELECT storage_key FROM public.documents WHERE id = (SELECT doc_id FROM test_doc_context LIMIT 1) $$,
    $$ VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/' || (SELECT doc_id::text FROM test_doc_context LIMIT 1) || '/source.pdf') $$,
    'request_document_upload: Generates canonical storage key {user_id}/{doc_id}/source.pdf'
);

SELECT results_eq(
    $$ SELECT status FROM public.documents WHERE id = (SELECT doc_id FROM test_doc_context LIMIT 1) $$,
    $$ VALUES ('UPLOADING') $$,
    'request_document_upload: Sets initial status to UPLOADING'
);

-- ============================================================================
-- 7. Total Storage Quota Reservation (P0-4)
-- ============================================================================

-- User A already has 1 MB (1048576 bytes) reserved as UPLOADING.
-- Now reserve 3 documents of 25 MB each (26214400 bytes * 3 = 78643200 bytes).
-- Total reserved = 1 MB + 75 MB = 76 MB.
SELECT lives_ok(
    $$ SELECT * FROM public.request_document_upload('doc1.pdf', 26214400, 'application/pdf') $$,
    'Quota: 25MB doc 1 accepted'
);
SELECT lives_ok(
    $$ SELECT * FROM public.request_document_upload('doc2.pdf', 26214400, 'application/pdf') $$,
    'Quota: 25MB doc 2 accepted'
);
SELECT lives_ok(
    $$ SELECT * FROM public.request_document_upload('doc3.pdf', 26214400, 'application/pdf') $$,
    'Quota: 25MB doc 3 accepted'
);

-- Now total reserved is 76 MB. Trying to reserve another 25 MB would reach 101 MB > 100 MB.
-- P0-4: Must fail even though existing rows are in UPLOADING status!
SELECT throws_ok(
    $$ SELECT * FROM public.request_document_upload('doc4_overflow.pdf', 26214400, 'application/pdf') $$,
    '23514',
    NULL,
    'Quota: Rejects upload request that would exceed 100MB including UPLOADING rows'
);

-- ============================================================================
-- 8. Privileged Finalization (P0-1, P0-4, P0-7)
-- ============================================================================
SET LOCAL ROLE service_role;

-- Size mismatch rejection (declared size 1048576, actual size 2000)
SELECT throws_ok(
    $$ SELECT * FROM public.finalize_document_upload_privileged(
           (SELECT doc_id FROM test_doc_context LIMIT 1),
           'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
           2000
       ) $$,
    '23514',
    NULL,
    'Privileged finalize: Rejects actual size mismatch against reserved size'
);

-- Successful finalization when actual size matches declared size
SELECT results_eq(
    $$ SELECT status FROM public.finalize_document_upload_privileged(
           (SELECT doc_id FROM test_doc_context LIMIT 1),
           'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
           1048576
       ) $$,
    $$ VALUES ('READY') $$,
    'Privileged finalize: Transitions status to READY when size matches'
);

-- Idempotency: Repeating finalization on READY document succeeds
SELECT results_eq(
    $$ SELECT status FROM public.finalize_document_upload_privileged(
           (SELECT doc_id FROM test_doc_context LIMIT 1),
           'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
           1048576
       ) $$,
    $$ VALUES ('READY') $$,
    'Privileged finalize: Idempotent repeat call returns READY'
);

-- ============================================================================
-- 9. User Isolation (User A vs User B)
-- ============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"}';

-- User B cannot see User A documents
SELECT is_empty(
    $$ SELECT * FROM public.documents WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
    'Isolation: User B cannot SELECT User A documents'
);

-- User B cannot archive User A documents
SELECT throws_ok(
    $$ SELECT public.archive_document((SELECT doc_id FROM test_doc_context LIMIT 1)) $$,
    '22023',
    NULL,
    'Isolation: User B cannot archive User A document'
);

-- ============================================================================
-- 10. Archival & Idempotency (P0-6)
-- ============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}';

SELECT ok(
    (SELECT public.archive_document((SELECT doc_id FROM test_doc_context LIMIT 1))),
    'Archive: User A archives own document successfully'
);

SELECT results_eq(
    $$ SELECT (archived_at IS NOT NULL) FROM public.documents WHERE id = (SELECT doc_id FROM test_doc_context LIMIT 1) $$,
    $$ VALUES (true) $$,
    'Archive: archived_at is stamped'
);

-- Idempotent repeat archival
SELECT ok(
    (SELECT public.archive_document((SELECT doc_id FROM test_doc_context LIMIT 1))),
    'Archive: Idempotent repeat call succeeds'
);

SELECT * FROM finish();
ROLLBACK;
