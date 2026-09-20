BEGIN;
SELECT plan(51);

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
SELECT has_column('public', 'documents', 'finalize_token', 'documents has finalize_token');
SELECT has_column('public', 'documents', 'created_at', 'documents has created_at');
SELECT has_column('public', 'documents', 'updated_at', 'documents has updated_at');
SELECT has_column('public', 'documents', 'archived_at', 'documents has archived_at');

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
    doc_id UUID,
    finalize_token TEXT
);
GRANT ALL ON test_doc_context TO authenticated, anon;

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
    $$ INSERT INTO public.documents (user_id, original_filename, storage_key, size_bytes, finalize_token)
       VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'anon.pdf', 'anon/anon.pdf', 1000, 'token') $$,
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
    $$ SELECT * FROM public.finalize_document_upload('11111111-1111-1111-1111-111111111111', 'token', 'READY', 1024) $$,
    '42501',
    NULL,
    'Anon: EXECUTE denied on finalize_document_upload'
);

SELECT throws_ok(
    $$ SELECT public.archive_document('11111111-1111-1111-1111-111111111111') $$,
    '42501',
    NULL,
    'Anon: EXECUTE denied on archive_document'
);

-- ============================================================================
-- 4. Authenticated Role: Least-Privilege Denials (Direct Mutations Revoked)
-- ============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}';

SELECT throws_ok(
    $$ INSERT INTO public.documents (user_id, original_filename, storage_key, size_bytes, finalize_token)
       VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'direct.pdf', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/1/source.pdf', 1000, 'tok') $$,
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

-- ============================================================================
-- 5. Authenticated Creation via request_document_upload() & Validation
-- ============================================================================

-- A. Size <= 0 rejected
SELECT throws_ok(
    $$ SELECT * FROM public.request_document_upload('zero.pdf', 0, 'application/pdf') $$,
    '22023',
    'Invalid file size',
    'Upload request rejected: zero or negative file size'
);

-- B. Oversized upload (> 25 MB) rejected
SELECT throws_ok(
    $$ SELECT * FROM public.request_document_upload('huge.pdf', 26214401, 'application/pdf') $$,
    '22023',
    'File size exceeds maximum allowed limit (25 MB)',
    'Upload request rejected: file size exceeds 25 MB'
);

-- C. Invalid MIME type rejected
SELECT throws_ok(
    $$ SELECT * FROM public.request_document_upload('script.exe', 1024, 'application/x-msdownload') $$,
    '22023',
    'Only PDF files are supported',
    'Upload request rejected: non-pdf MIME type'
);

-- D. Empty filename rejected
SELECT throws_ok(
    $$ SELECT * FROM public.request_document_upload('   ', 1024, 'application/pdf') $$,
    '22023',
    'Original filename cannot be empty',
    'Upload request rejected: empty original filename'
);

-- E. Cross-user subject reference rejected
SELECT throws_ok(
    $$ SELECT * FROM public.request_document_upload('slides.pdf', 1024, 'application/pdf', '22222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb') $$,
    '23503',
    'Subject does not exist or does not belong to user',
    'Upload request rejected: Alice cannot link Bob subject'
);

-- F. Valid upload request for User A
SELECT lives_ok(
    $$ SELECT * FROM public.request_document_upload('clase_cardiologia.pdf', 10240, 'application/pdf', '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $$,
    'Upload request succeeds for User A with valid params and own subject'
);

-- Store created document ID and token into temp context
INSERT INTO test_doc_context (doc_id, finalize_token)
SELECT id, finalize_token FROM public.documents WHERE original_filename = 'clase_cardiologia.pdf';

-- G. Verify document was created with status UPLOADING, canonical storage key, and system-generated ID
SELECT results_eq(
    $$ SELECT status FROM public.documents WHERE original_filename = 'clase_cardiologia.pdf' $$,
    $$ VALUES ('UPLOADING'::text) $$,
    'Initial document status is UPLOADING'
);

SELECT results_eq(
    $$ SELECT storage_key LIKE 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/%/source.pdf' FROM public.documents WHERE original_filename = 'clase_cardiologia.pdf' $$,
    $$ VALUES (true) $$,
    'Storage key follows canonical pattern {user_id}/{doc_id}/source.pdf'
);

SELECT results_eq(
    $$ SELECT subject_id FROM public.documents WHERE original_filename = 'clase_cardiologia.pdf' $$,
    $$ VALUES ('11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid) $$,
    'Document correctly linked to User A subject'
);

-- ============================================================================
-- 6. Quota Enforcement
-- ============================================================================

-- Create 9 more documents for User A to hit the 10-document limit
DO $$
DECLARE
    i INT;
BEGIN
    FOR i IN 2..10 LOOP
        PERFORM public.request_document_upload('doc_' || i || '.pdf', 1024, 'application/pdf');
    END LOOP;
END;
$$;

-- 11th document request must be rejected (quota = 10)
SELECT throws_ok(
    $$ SELECT * FROM public.request_document_upload('doc_11_exceeded.pdf', 1024, 'application/pdf') $$,
    '23514',
    'Active document quota exceeded (maximum 10 documents)',
    'Upload request rejected: active document quota exceeded'
);

-- ============================================================================
-- 7. Two-User Isolation
-- ============================================================================
SET LOCAL "request.jwt.claims" = '{"sub": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"}';

-- User B cannot view User A's documents
SELECT is_empty(
    $$ SELECT * FROM public.documents WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
    'User B cannot view User A documents via RLS'
);

-- User B cannot archive User A's document
SELECT throws_ok(
    $$ SELECT public.archive_document((SELECT doc_id FROM test_doc_context)) $$,
    '22023',
    NULL,
    'User B cannot archive User A document'
);

-- User B cannot finalize User A's document
SELECT throws_ok(
    $$ SELECT * FROM public.finalize_document_upload(
        (SELECT doc_id FROM test_doc_context),
        'wrong_or_any_token',
        'READY',
        10240
    ) $$,
    '22023',
    NULL,
    'User B cannot finalize User A document'
);

-- ============================================================================
-- 8. Finalization & Idempotency
-- ============================================================================
SET LOCAL "request.jwt.claims" = '{"sub": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}';

-- Finalize with invalid token rejected
SELECT throws_ok(
    $$ SELECT * FROM public.finalize_document_upload(
        (SELECT id FROM public.documents WHERE original_filename = 'clase_cardiologia.pdf'),
        'invalid_token_1234567890',
        'READY',
        10240
    ) $$,
    '42501',
    'Invalid finalization token',
    'Finalize rejected: invalid token'
);

-- Finalize to READY without storage object rejected
SELECT throws_ok(
    $$ SELECT * FROM public.finalize_document_upload(
        (SELECT id FROM public.documents WHERE original_filename = 'clase_cardiologia.pdf'),
        (SELECT finalize_token FROM public.documents WHERE original_filename = 'clase_cardiologia.pdf'),
        'READY',
        10240
    ) $$,
    '23514',
    'Storage object does not exist for this document',
    'Finalize rejected: storage object does not exist in storage.objects'
);

-- Simulate storage object upload by inserting into storage.objects
DO $$
DECLARE
    v_doc RECORD;
BEGIN
    SELECT * INTO v_doc FROM public.documents WHERE original_filename = 'clase_cardiologia.pdf';
    INSERT INTO storage.objects (bucket_id, name, owner, metadata)
    VALUES (
        v_doc.storage_bucket,
        v_doc.storage_key,
        v_doc.user_id,
        jsonb_build_object('size', 10240, 'mimetype', 'application/pdf')
    );
END;
$$;

-- Now finalize to READY succeeds
SELECT lives_ok(
    $$ SELECT * FROM public.finalize_document_upload(
        (SELECT id FROM public.documents WHERE original_filename = 'clase_cardiologia.pdf'),
        (SELECT finalize_token FROM public.documents WHERE original_filename = 'clase_cardiologia.pdf'),
        'READY',
        10240,
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    ) $$,
    'Finalize to READY succeeds when storage object exists'
);

-- Verify status is READY
SELECT results_eq(
    $$ SELECT status FROM public.documents WHERE original_filename = 'clase_cardiologia.pdf' $$,
    $$ VALUES ('READY'::text) $$,
    'Document status transitioned to READY'
);

-- Repeated finalize call is idempotent and succeeds without error
SELECT lives_ok(
    $$ SELECT * FROM public.finalize_document_upload(
        (SELECT id FROM public.documents WHERE original_filename = 'clase_cardiologia.pdf'),
        (SELECT finalize_token FROM public.documents WHERE original_filename = 'clase_cardiologia.pdf'),
        'READY',
        10240
    ) $$,
    'Repeated finalize call with READY is idempotent'
);

-- ============================================================================
-- 9. Archive & Quota Recovery
-- ============================================================================

-- Archive document
SELECT lives_ok(
    $$ SELECT public.archive_document(
        (SELECT id FROM public.documents WHERE original_filename = 'clase_cardiologia.pdf')
    ) $$,
    'User A can archive own document'
);

-- Verify archived_at is set
SELECT results_eq(
    $$ SELECT archived_at IS NOT NULL FROM public.documents WHERE original_filename = 'clase_cardiologia.pdf' $$,
    $$ VALUES (true) $$,
    'archived_at timestamp is set upon archival'
);

-- Archiving again is idempotent
SELECT lives_ok(
    $$ SELECT public.archive_document(
        (SELECT id FROM public.documents WHERE original_filename = 'clase_cardiologia.pdf')
    ) $$,
    'Repeated archive call is idempotent'
);

-- User A can now upload a new document because 1 of the 10 active documents was archived
SELECT lives_ok(
    $$ SELECT * FROM public.request_document_upload('quota_recovered.pdf', 2048, 'application/pdf') $$,
    'Archiving a document frees quota and permits new upload'
);

SELECT * FROM finish();
ROLLBACK;
