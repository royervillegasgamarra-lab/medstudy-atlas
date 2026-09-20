-- pgTAP Test: 04_processing_runs_rls.sql
-- Description: Test RLS, tenant isolation, and privileged RPC security for document_processing_runs and document_pages

BEGIN;
SELECT plan(33);

-- Setup test users
CREATE EXTENSION IF NOT EXISTS pgtap;

INSERT INTO auth.users (id, email)
VALUES 
    ('11111111-1111-1111-1111-111111111111', 'alice.proc@test.com'),
    ('22222222-2222-2222-2222-222222222222', 'bob.proc@test.com')
ON CONFLICT (id) DO NOTHING;

-- Create READY documents for Alice and Bob
INSERT INTO public.documents (
    id, user_id, original_filename, storage_bucket, storage_key, mime_type, size_bytes, status
)
VALUES (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111',
    'alice-doc.pdf',
    'documents',
    '11111111-1111-1111-1111-111111111111/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/source.pdf',
    'application/pdf',
    1024,
    'READY'
), (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    '22222222-2222-2222-2222-222222222222',
    'bob-doc.pdf',
    'documents',
    '22222222-2222-2222-2222-222222222222/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/source.pdf',
    'application/pdf',
    2048,
    'READY'
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 1. Anonymous Security Checks
-- ============================================================================

SET ROLE anon;

SELECT throws_ok(
    $$ SELECT * FROM public.document_processing_runs $$,
    '42501',
    NULL,
    'Anon: SELECT denied on document_processing_runs'
);

SELECT throws_ok(
    $$ SELECT * FROM public.document_pages $$,
    '42501',
    NULL,
    'Anon: SELECT denied on document_pages'
);

SELECT throws_ok(
    $$ INSERT INTO public.document_processing_runs (document_id, user_id) VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111') $$,
    '42501',
    NULL,
    'Anon: INSERT denied on document_processing_runs'
);

SELECT throws_ok(
    $$ SELECT public.claim_next_processing_run('worker-1', 300) $$,
    '42501',
    NULL,
    'Anon: EXECUTE denied on claim_next_processing_run'
);

SELECT throws_ok(
    $$ SELECT public.enqueue_document_processing_privileged('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111') $$,
    '42501',
    NULL,
    'Anon: EXECUTE denied on enqueue_document_processing_privileged'
);

SELECT throws_ok(
    $$ SELECT public.persist_processing_run_results_privileged(gen_random_uuid(), '{}'::jsonb, '[]'::jsonb) $$,
    '42501',
    NULL,
    'Anon: EXECUTE denied on persist_processing_run_results_privileged'
);

SELECT throws_ok(
    $$ SELECT public.fail_processing_run_privileged(gen_random_uuid(), 'ERROR', false) $$,
    '42501',
    NULL,
    'Anon: EXECUTE denied on fail_processing_run_privileged'
);

-- ============================================================================
-- 2. Authenticated Direct Mutation Denials
-- ============================================================================

SET ROLE authenticated;
SET request.jwt.claims TO '{"sub": "11111111-1111-1111-1111-111111111111"}';

SELECT throws_ok(
    $$ INSERT INTO public.document_processing_runs (document_id, user_id) VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111') $$,
    '42501',
    NULL,
    'Auth: INSERT denied on document_processing_runs'
);

SELECT throws_ok(
    $$ UPDATE public.document_processing_runs SET status = 'SUCCEEDED' WHERE document_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
    '42501',
    NULL,
    'Auth: UPDATE denied on document_processing_runs'
);

SELECT throws_ok(
    $$ DELETE FROM public.document_processing_runs WHERE document_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
    '42501',
    NULL,
    'Auth: DELETE denied on document_processing_runs'
);

SELECT throws_ok(
    $$ INSERT INTO public.document_pages (processing_run_id, document_id, user_id, page_number, classification, extraction_method, text_content, width_points, height_points, text_sha256)
       VALUES (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 1, 'TEXT_BASED', 'NATIVE', 'test', 100, 100, 'hash') $$,
    '42501',
    NULL,
    'Auth: INSERT denied on document_pages'
);

SELECT throws_ok(
    $$ UPDATE public.document_pages SET text_content = 'hacked' $$,
    '42501',
    NULL,
    'Auth: UPDATE denied on document_pages'
);

SELECT throws_ok(
    $$ DELETE FROM public.document_pages $$,
    '42501',
    NULL,
    'Auth: DELETE denied on document_pages'
);

-- ============================================================================
-- 3. Authenticated Privileged RPC Denials
-- ============================================================================

SELECT throws_ok(
    $$ SELECT public.claim_next_processing_run('worker-1', 300) $$,
    '42501',
    NULL,
    'Auth: EXECUTE denied on claim_next_processing_run'
);

SELECT throws_ok(
    $$ SELECT public.enqueue_document_processing_privileged('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111') $$,
    '42501',
    NULL,
    'Auth: EXECUTE denied on enqueue_document_processing_privileged'
);

SELECT throws_ok(
    $$ SELECT public.persist_processing_run_results_privileged(gen_random_uuid(), '{}'::jsonb, '[]'::jsonb) $$,
    '42501',
    NULL,
    'Auth: EXECUTE denied on persist_processing_run_results_privileged'
);

SELECT throws_ok(
    $$ SELECT public.fail_processing_run_privileged(gen_random_uuid(), 'ERROR', false) $$,
    '42501',
    NULL,
    'Auth: EXECUTE denied on fail_processing_run_privileged'
);

-- ============================================================================
-- 4. Privileged Enqueue and Claim Flow (service_role)
-- ============================================================================

SET ROLE service_role;

-- Enqueue processing for Alice's document
SELECT lives_ok(
    $$ SELECT public.enqueue_document_processing_privileged('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', '1.0.0') $$,
    'service_role: Enqueue Alice document succeeds'
);

-- Idempotency check: repeat enqueue does not fail
SELECT lives_ok(
    $$ SELECT public.enqueue_document_processing_privileged('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', '1.0.0') $$,
    'service_role: Repeat enqueue is idempotent'
);

-- Claim the run using worker claim mechanism
CREATE TEMP TABLE claimed_job AS
SELECT * FROM public.claim_next_processing_run('worker-test-1', 300);

SELECT is(
    (SELECT document_id FROM claimed_job),
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
    'Claim: Worker claims Alice pending job'
);

SELECT is(
    (SELECT status FROM public.document_processing_runs WHERE id = (SELECT run_id FROM claimed_job)),
    'RUNNING',
    'Claim: Run status transitions to RUNNING'
);

-- Second claim attempt returns empty (FOR UPDATE SKIP LOCKED prevents duplicate claim)
SELECT is_empty(
    $$ SELECT * FROM public.claim_next_processing_run('worker-test-2', 300) $$,
    'Claim Concurrency: Second worker finds no available jobs'
);

-- ============================================================================
-- 5. Privileged Persistence & Page Provenance
-- ============================================================================

-- Persist page results for Alice's run
SELECT lives_ok(
    $$
    SELECT public.persist_processing_run_results_privileged(
        (SELECT run_id FROM claimed_job),
        '{
            "page_count": 2,
            "native_text_page_count": 1,
            "ocr_page_count": 1,
            "no_text_page_count": 0,
            "source_sha256": "abcdef123456"
        }'::jsonb,
        '[
            {
                "page_number": 1,
                "classification": "TEXT_BASED",
                "extraction_method": "NATIVE",
                "text_content": "Page 1 native text content",
                "char_count": 26,
                "native_char_count": 26,
                "ocr_char_count": 0,
                "ocr_confidence": null,
                "width_points": 595.28,
                "height_points": 841.89,
                "rotation_degrees": 0,
                "text_sha256": "page1sha256"
            },
            {
                "page_number": 2,
                "classification": "SCANNED",
                "extraction_method": "OCR",
                "text_content": "Page 2 OCR text content",
                "char_count": 23,
                "native_char_count": 0,
                "ocr_char_count": 23,
                "ocr_confidence": 92.50,
                "width_points": 595.28,
                "height_points": 841.89,
                "rotation_degrees": 0,
                "text_sha256": "page2sha256"
            }
        ]'::jsonb
    )
    $$,
    'service_role: Persist results succeeds'
);

SELECT is(
    (SELECT status FROM public.document_processing_runs WHERE id = (SELECT run_id FROM claimed_job)),
    'SUCCEEDED',
    'Persistence: Run status transitions to SUCCEEDED'
);

SELECT is(
    (SELECT COUNT(*) FROM public.document_pages WHERE processing_run_id = (SELECT run_id FROM claimed_job)),
    2::bigint,
    'Persistence: Exact 2 page records persisted'
);

-- ============================================================================
-- 6. Tenant Isolation: User A vs User B
-- ============================================================================

-- Alice queries her processing runs and pages
SET ROLE authenticated;
SET request.jwt.claims TO '{"sub": "11111111-1111-1111-1111-111111111111"}';

SELECT is(
    (SELECT COUNT(*) FROM public.document_processing_runs WHERE user_id = '11111111-1111-1111-1111-111111111111'),
    1::bigint,
    'Isolation: Alice can view her own processing run'
);

SELECT is(
    (SELECT COUNT(*) FROM public.document_pages WHERE user_id = '11111111-1111-1111-1111-111111111111'),
    2::bigint,
    'Isolation: Alice can view her own document pages'
);

-- Bob queries Alice's runs and pages
SET request.jwt.claims TO '{"sub": "22222222-2222-2222-2222-222222222222"}';

SELECT is_empty(
    $$ SELECT * FROM public.document_processing_runs WHERE user_id = '11111111-1111-1111-1111-111111111111' $$,
    'Isolation: Bob cannot view Alice processing run'
);

SELECT is_empty(
    $$ SELECT * FROM public.document_pages WHERE user_id = '11111111-1111-1111-1111-111111111111' $$,
    'Isolation: Bob cannot view Alice document pages'
);

-- Bob queries his own (which should be 0)
SELECT is(
    (SELECT COUNT(*) FROM public.document_processing_runs WHERE user_id = '22222222-2222-2222-2222-222222222222'),
    0::bigint,
    'Isolation: Bob has 0 processing runs'
);

-- ============================================================================
-- 7. Failure Handling
-- ============================================================================

SET ROLE service_role;

-- Enqueue and claim Bob's document
SELECT public.enqueue_document_processing_privileged('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', '1.0.0');

CREATE TEMP TABLE bob_job AS
SELECT * FROM public.claim_next_processing_run('worker-test-bob', 300);

-- Mark Bob's job as retryable failure
SELECT lives_ok(
    $$ SELECT public.fail_processing_run_privileged((SELECT run_id FROM bob_job), 'PARSER_TIMEOUT', true) $$,
    'service_role: fail_processing_run_privileged with retryable succeeds'
);

SELECT is(
    (SELECT status FROM public.document_processing_runs WHERE id = (SELECT run_id FROM bob_job)),
    'FAILED_RETRYABLE',
    'Failure: Run status is FAILED_RETRYABLE'
);

SELECT is(
    (SELECT error_code FROM public.document_processing_runs WHERE id = (SELECT run_id FROM bob_job)),
    'PARSER_TIMEOUT',
    'Failure: Error code is PARSER_TIMEOUT'
);

SELECT * FROM finish();
ROLLBACK;
