-- pgTAP Test Suite: 05_chunks_and_study_packs_rls.sql
-- Verifies Phase 1E: Document Chunks, Study Packs, Normalized Items, Citations, AI Usages,
-- Composite Foreign Keys, RLS Tenant Isolation, Claim Fencing, and Write Revocation.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(64);

-- ============================================================================
-- 1. Setup Test Fixture Data (Users, Profiles, Subjects, Documents, Runs, Pages)
-- ============================================================================

-- Alice (11111111-...)
INSERT INTO auth.users (id, email)
VALUES ('11111111-1111-1111-1111-111111111111', 'alice@medstudy.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_profiles (id, email, full_name, onboarding_completed_at)
VALUES ('11111111-1111-1111-1111-111111111111', 'alice@medstudy.test', 'Alice Student', NOW())
ON CONFLICT (id) DO NOTHING;

-- Bob (22222222-...)
INSERT INTO auth.users (id, email)
VALUES ('22222222-2222-2222-2222-222222222222', 'bob@medstudy.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_profiles (id, email, full_name, onboarding_completed_at)
VALUES ('22222222-2222-2222-2222-222222222222', 'bob@medstudy.test', 'Bob Student', NOW())
ON CONFLICT (id) DO NOTHING;

-- Alice's Document
INSERT INTO public.documents (
    id,
    user_id,
    original_filename,
    storage_key,
    size_bytes,
    status
)
VALUES (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111',
    'cardio_slides.pdf',
    '11111111-1111-1111-1111-111111111111/cardio_slides.pdf',
    1048576,
    'READY'
)
ON CONFLICT (id) DO NOTHING;

-- Alice's SUCCEEDED Processing Run
INSERT INTO public.document_processing_runs (
    id,
    document_id,
    user_id,
    pipeline_version,
    status,
    attempt_count,
    page_count,
    source_sha256
)
VALUES (
    '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111',
    '1.0.0',
    'SUCCEEDED',
    1,
    2,
    'alice_source_sha256'
)
ON CONFLICT (id) DO NOTHING;

-- Alice's Pages (Page 1 & Page 2)
INSERT INTO public.document_pages (
    id,
    processing_run_id,
    document_id,
    user_id,
    page_number,
    classification,
    extraction_method,
    text_content,
    char_count,
    width_points,
    height_points,
    text_sha256
)
VALUES
(
    '11111111-0001-aaaa-aaaa-000000000001',
    '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111',
    1,
    'TEXT_BASED',
    'NATIVE',
    'Estenosis aórtica: la etiología más frecuente en mayores de 70 años es la degenerativa calcificada.',
    99,
    595.28,
    841.89,
    'cc2d470eb7e6042ad0662e474959e51e2b50a60374e04aa45d8e86ac93753fee'
),
(
    '11111111-0002-aaaa-aaaa-000000000002',
    '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111',
    2,
    'TEXT_BASED',
    'NATIVE',
    'Tratamiento: TAVI o reemplazo quirúrgico cuando el área valvular es menor a 1 cm2 o hay síntomas.',
    97,
    595.28,
    841.89,
    '17c033ffb881257437ae37e4a0974eca3473911efde253f91b04ad80a7c37259'
)
ON CONFLICT (id) DO NOTHING;

-- Bob's Document & Run
INSERT INTO public.documents (
    id,
    user_id,
    original_filename,
    storage_key,
    size_bytes,
    status
)
VALUES (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    '22222222-2222-2222-2222-222222222222',
    'pneumo_slides.pdf',
    '22222222-2222-2222-2222-222222222222/pneumo_slides.pdf',
    2048576,
    'READY'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.document_processing_runs (
    id,
    document_id,
    user_id,
    pipeline_version,
    status,
    attempt_count,
    page_count,
    source_sha256
)
VALUES (
    '22222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    '22222222-2222-2222-2222-222222222222',
    '1.0.0',
    'SUCCEEDED',
    1,
    1,
    'bob_source_sha256'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.document_pages (
    id,
    processing_run_id,
    document_id,
    user_id,
    page_number,
    classification,
    extraction_method,
    text_content,
    char_count,
    width_points,
    height_points,
    text_sha256
)
VALUES (
    '22222222-0001-bbbb-bbbb-000000000001',
    '22222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    '22222222-2222-2222-2222-222222222222',
    1,
    'TEXT_BASED',
    'NATIVE',
    'Neumonía adquirida en la comunidad: Streptococcus pneumoniae es el agente bacteriano típico más común.',
    103,
    595.28,
    841.89,
    'bob_page1_sha256'
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 2. Test create_document_chunks_privileged RPC & Invariants
-- ============================================================================

-- Alice chunks inserted atomically via service_role
SELECT is(
    public.create_document_chunks_privileged(
        '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'chunk-v1',
        '[
            {
                "document_page_id": "11111111-0001-aaaa-aaaa-000000000001",
                "page_number": 1,
                "chunk_index": 0,
                "start_char": 0,
                "end_char": 99,
                "content": "Estenosis aórtica: la etiología más frecuente en mayores de 70 años es la degenerativa calcificada.",
                "char_count": 99,
                "content_sha256": "cc2d470eb7e6042ad0662e474959e51e2b50a60374e04aa45d8e86ac93753fee"
            },
            {
                "document_page_id": "11111111-0002-aaaa-aaaa-000000000002",
                "page_number": 2,
                "chunk_index": 0,
                "start_char": 0,
                "end_char": 97,
                "content": "Tratamiento: TAVI o reemplazo quirúrgico cuando el área valvular es menor a 1 cm2 o hay síntomas.",
                "char_count": 97,
                "content_sha256": "17c033ffb881257437ae37e4a0974eca3473911efde253f91b04ad80a7c37259"
            }
        ]'::jsonb
    ),
    2,
    'Chunk Creation: 2 chunks inserted for Alice SUCCEEDED run'
);

-- Idempotency: repeated call returns existing chunk count without duplicate rows
SELECT is(
    public.create_document_chunks_privileged(
        '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'chunk-v1',
        '[]'::jsonb
    ),
    2,
    'Chunk Creation Idempotency: Repeated call returns existing count'
);

-- Chunk Provenance Adversarial Tests (Item 7)
SELECT throws_ok(
    $$
    SELECT public.create_document_chunks_privileged(
        '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'chunk-v2',
        '[{"document_page_id": "11111111-0001-aaaa-aaaa-000000000001", "page_number": 1, "chunk_index": 0, "start_char": 0, "end_char": 999, "content": "text", "char_count": 4, "content_sha256": "sha"}]'::jsonb
    )
    $$,
    '22023',
    NULL,
    'Provenance Adversarial: Out of bounds offsets rejected'
);

SELECT throws_ok(
    $$
    SELECT public.create_document_chunks_privileged(
        '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'chunk-v2',
        '[{"document_page_id": "11111111-0001-aaaa-aaaa-000000000001", "page_number": 1, "chunk_index": 0, "start_char": 0, "end_char": 10, "content": "FORGED_TXT", "char_count": 10, "content_sha256": "sha"}]'::jsonb
    )
    $$,
    '22023',
    NULL,
    'Provenance Adversarial: Forged chunk content slice rejected'
);

SELECT throws_ok(
    $$
    SELECT public.create_document_chunks_privileged(
        '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'chunk-v2',
        '[{"document_page_id": "11111111-0001-aaaa-aaaa-000000000001", "page_number": 1, "chunk_index": 0, "start_char": 0, "end_char": 18, "content": "Estenosis aórtica:", "char_count": 18, "content_sha256": "0000000000000000000000000000000000000000000000000000000000000000"}]'::jsonb
    )
    $$,
    '22023',
    NULL,
    'Provenance Adversarial: Forged chunk SHA-256 hash rejected'
);

-- Verify Full-Text Search tsvector generated
SELECT isnt(
    (SELECT tsv_content FROM public.document_chunks WHERE page_number = 1 LIMIT 1),
    NULL,
    'FTS: tsv_content is automatically generated STORED column'
);

-- Verify no vector column exists in document_chunks
SELECT is(
    (
        SELECT COUNT(*)
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'document_chunks'
          AND data_type = 'USER-DEFINED'
          AND udt_name = 'vector'
    ),
    0::bigint,
    'No Vector Column in 1E: pgvector column must not exist in document_chunks'
);

-- ============================================================================
-- 3. Tenant Isolation on document_chunks (RLS)
-- ============================================================================

SET ROLE authenticated;
SET request.jwt.claims TO '{"sub": "11111111-1111-1111-1111-111111111111"}';

SELECT is(
    (SELECT COUNT(*) FROM public.document_chunks WHERE user_id = '11111111-1111-1111-1111-111111111111'),
    2::bigint,
    'RLS: Alice can SELECT her own chunks'
);

-- Bob cannot view Alice chunks
SET request.jwt.claims TO '{"sub": "22222222-2222-2222-2222-222222222222"}';

SELECT is_empty(
    $$ SELECT * FROM public.document_chunks WHERE user_id = '11111111-1111-1111-1111-111111111111' $$,
    'RLS Isolation: Bob cannot view Alice chunks'
);

-- Authenticated direct mutations denied on document_chunks
SELECT throws_ok(
    $$
    INSERT INTO public.document_chunks (
        user_id, document_id, processing_run_id, document_page_id,
        page_number, chunk_index, start_char, end_char,
        content, char_count, content_sha256, chunking_version
    ) VALUES (
        '22222222-2222-2222-2222-222222222222',
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        '22222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        '22222222-0001-bbbb-bbbb-000000000001',
        1, 0, 0, 10, 'content', 10, 'sha', 'chunk-v1'
    )
    $$,
    '42501',
    NULL,
    'Privilege: Authenticated INSERT denied on document_chunks'
);

SELECT throws_ok(
    $$ UPDATE public.document_chunks SET content = 'hacked' WHERE page_number = 1 $$,
    '42501',
    NULL,
    'Privilege: Authenticated UPDATE denied on document_chunks'
);

SELECT throws_ok(
    $$ DELETE FROM public.document_chunks WHERE page_number = 1 $$,
    '42501',
    NULL,
    'Privilege: Authenticated DELETE denied on document_chunks'
);

-- ============================================================================
-- 4. Composite Foreign Key Tampering Integrity on document_chunks
-- ============================================================================

SET ROLE service_role;

-- Try inserting chunk with Alice run_id but Bob document_id (cross-tenant FK tampering)
SELECT throws_ok(
    $$
    INSERT INTO public.document_chunks (
        user_id, document_id, processing_run_id, document_page_id,
        page_number, chunk_index, start_char, end_char,
        content, char_count, content_sha256, chunking_version
    ) VALUES (
        '22222222-2222-2222-2222-222222222222', -- Bob user
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', -- Bob doc
        '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', -- Alice run!
        '22222222-0001-bbbb-bbbb-000000000001',
        1, 99, 0, 10, 'tampered chunk', 14, 'sha', 'chunk-v1'
    )
    $$,
    '23503',
    NULL,
    'FK Integrity: document_chunks rejects mismatched processing_run_id / document_id / user_id'
);

-- Try inserting chunk with Alice page_id but Bob document_id
SELECT throws_ok(
    $$
    INSERT INTO public.document_chunks (
        user_id, document_id, processing_run_id, document_page_id,
        page_number, chunk_index, start_char, end_char,
        content, char_count, content_sha256, chunking_version
    ) VALUES (
        '22222222-2222-2222-2222-222222222222', -- Bob user
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', -- Bob doc
        '22222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb', -- Bob run
        '11111111-0001-aaaa-aaaa-000000000001', -- Alice page!
        1, 99, 0, 10, 'tampered page chunk', 19, 'sha', 'chunk-v1'
    )
    $$,
    '23503',
    NULL,
    'FK Integrity: document_chunks rejects mismatched document_page_id / document_id / user_id'
);

-- FK Integrity: ai_usages composite foreign key rejects mismatched (document_id, user_id)
SELECT throws_ok(
    $$
    INSERT INTO public.ai_usages (
        user_id, document_id, feature, provider, model, status
    ) VALUES (
        '22222222-2222-2222-2222-222222222222', -- Bob user
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', -- Alice doc
        'STUDY_PACK_GEN', 'mock-p', 'mock-m', 'SUCCESS'
    )
    $$,
    '23503',
    NULL,
    'FK Integrity: ai_usages rejects mismatched document_id and user_id'
);

-- Telemetry RPC: record_ai_usage_privileged rejects mismatched document_id and user_id
SELECT throws_ok(
    $$
    SELECT public.record_ai_usage_privileged(
        '22222222-2222-2222-2222-222222222222', -- Bob user
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', -- Alice doc
        NULL,
        'STUDY_PACK_GEN', 'mock-p', 'mock-m',
        100, 50, 0, 0.001, 100, 'SUCCESS'
    )
    $$,
    '22023',
    NULL,
    'Telemetry RPC Integrity: record_ai_usage_privileged rejects mismatched document_id and user_id'
);

-- Insert a Bob chunk for cross-document citation testing in Section 8
INSERT INTO public.document_chunks (
    id, user_id, document_id, processing_run_id, document_page_id,
    page_number, chunk_index, start_char, end_char,
    content, char_count, content_sha256, chunking_version
) VALUES (
    '22222222-cccc-0001-0000-000000000001',
    '22222222-2222-2222-2222-222222222222',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    '22222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    '22222222-0001-bbbb-bbbb-000000000001',
    1, 0, 0, 10, 'Neumonía a', 10, 'bob_chunk_sha', 'chunk-v1'
) ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 5. Test enqueue_study_pack_privileged RPC
-- ============================================================================

CREATE TEMP TABLE alice_pack AS
SELECT * FROM public.enqueue_study_pack_privileged(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111',
    'sp-gen-v1'
);

SELECT is(
    (SELECT status FROM alice_pack),
    'PENDING',
    'Enqueue Study Pack: Transitions to PENDING'
);

SELECT is(
    (SELECT attempt_count FROM alice_pack),
    0,
    'Enqueue Study Pack: attempt_count starts at 0'
);

-- Repeated enqueue call is idempotent and returns same study_pack_id
CREATE TEMP TABLE alice_pack_2 AS
SELECT * FROM public.enqueue_study_pack_privileged(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111',
    'sp-gen-v1'
);

SELECT is(
    (SELECT study_pack_id FROM alice_pack_2),
    (SELECT study_pack_id FROM alice_pack),
    'Enqueue Study Pack Idempotency: Returns same study_pack_id on repeat request'
);

-- Bob cannot enqueue a Study Pack for Alice document (IDOR defense)
SELECT throws_ok(
    $$
    SELECT * FROM public.enqueue_study_pack_privileged(
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '22222222-2222-2222-2222-222222222222',
        'sp-gen-v1'
    )
    $$,
    '22023',
    NULL,
    'IDOR Defense: User cannot enqueue Study Pack for another student document'
);

-- ============================================================================
-- 6. Test claim_next_study_pack RPC with Fencing
-- ============================================================================

CREATE TEMP TABLE claimed_pack AS
SELECT * FROM public.claim_next_study_pack('study-worker-01', 300);

SELECT is(
    (SELECT study_pack_id FROM claimed_pack),
    (SELECT study_pack_id FROM alice_pack),
    'Worker Claim: Successfully claimed Alice pending study pack'
);

SELECT isnt(
    (SELECT claim_token FROM claimed_pack),
    NULL,
    'Worker Claim: claim_token UUID issued'
);

-- Competing worker cannot claim already leased active job (SKIP LOCKED)
SELECT is_empty(
    $$ SELECT * FROM public.claim_next_study_pack('study-worker-02', 300) $$,
    'Worker Concurrency: Active leased job cannot be claimed by competing worker'
);

-- Validation: Lease seconds rejected if < 10 or > 1800
SELECT throws_ok(
    $$ SELECT * FROM public.claim_next_study_pack('study-worker-01', 5) $$,
    '22023',
    NULL,
    'Validation: claim_next_study_pack rejects lease < 10s'
);

SELECT throws_ok(
    $$ SELECT * FROM public.claim_next_study_pack('study-worker-01', 3600) $$,
    '22023',
    NULL,
    'Validation: claim_next_study_pack rejects lease > 1800s'
);

-- ============================================================================
-- 7. Write Revocation & Fencing on persist and fail
-- ============================================================================

-- Expire the lease to test write revocation
UPDATE public.study_packs
SET lease_expires_at = NOW() - INTERVAL '10 seconds'
WHERE id = (SELECT study_pack_id FROM claimed_pack);

-- Persist fails with 55000 due to expired lease
SELECT throws_ok(
    $$
    SELECT public.persist_study_pack_results_privileged(
        (SELECT study_pack_id FROM claimed_pack),
        (SELECT claim_token FROM claimed_pack),
        'mock-provider',
        'mock-model',
        100, 50, 0, 0.001,
        2, 2, 2, 194,
        '[]'::jsonb,
        '[]'::jsonb
    )
    $$,
    '55000',
    NULL,
    'Write Revocation: Persist rejected when lease expired'
);

-- Fail fails with 55000 due to expired lease
SELECT throws_ok(
    $$
    SELECT public.fail_study_pack_privileged(
        (SELECT study_pack_id FROM claimed_pack),
        (SELECT claim_token FROM claimed_pack),
        'AI_TIMEOUT',
        true
    )
    $$,
    '55000',
    NULL,
    'Write Revocation: Fail rejected when lease expired'
);

-- Set lease_expires_at to NULL to test rejection of missing lease
UPDATE public.study_packs
SET lease_expires_at = NULL
WHERE id = (SELECT study_pack_id FROM claimed_pack);

SELECT throws_ok(
    $$
    SELECT public.persist_study_pack_results_privileged(
        (SELECT study_pack_id FROM claimed_pack),
        (SELECT claim_token FROM claimed_pack),
        'mock-provider',
        'mock-model',
        100, 50, 0, 0.001,
        2, 2, 2, 194,
        '[]'::jsonb,
        '[]'::jsonb
    )
    $$,
    '55000',
    NULL,
    'Write Revocation: Persist rejected when lease_expires_at is NULL'
);

-- Restore active lease with wrong claim_token to test token fencing
UPDATE public.study_packs
SET lease_expires_at = NOW() + INTERVAL '300 seconds'
WHERE id = (SELECT study_pack_id FROM claimed_pack);

SELECT throws_ok(
    $$
    SELECT public.persist_study_pack_results_privileged(
        (SELECT study_pack_id FROM claimed_pack),
        '00000000-0000-0000-0000-000000000000', -- wrong token
        'mock-provider',
        'mock-model',
        100, 50, 0, 0.001,
        2, 2, 2, 194,
        '[]'::jsonb,
        '[]'::jsonb
    )
    $$,
    '55000',
    NULL,
    'Claim Fencing: Persist rejected on claim_token mismatch'
);

-- ============================================================================
-- 8. Successful Persistence with Normalized Items & Citations
-- ============================================================================

CREATE TEMP TABLE first_chunk AS
SELECT id AS chunk_id FROM public.document_chunks WHERE document_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND page_number = 1 LIMIT 1;

CREATE TEMP TABLE second_chunk AS
SELECT id AS chunk_id FROM public.document_chunks WHERE document_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND page_number = 2 LIMIT 1;

-- Persist Adversarial: Unknown item_temp_key rejected (Item 9)
SELECT throws_ok(
    $$
    SELECT public.persist_study_pack_results_privileged(
        (SELECT study_pack_id FROM claimed_pack),
        (SELECT claim_token FROM claimed_pack),
        'mock-provider', 'mock-model',
        500, 250, 50, 0.0005,
        2, 2, 2, 194,
        jsonb_build_array(
            jsonb_build_object('temp_key', 'summary-0', 'item_type', 'SUMMARY', 'ordinal', 0, 'payload', jsonb_build_object('paragraph', 'Test.'))
        ),
        jsonb_build_array(
            jsonb_build_object('item_temp_key', 'unknown-key-999', 'document_chunk_id', (SELECT chunk_id FROM first_chunk), 'ordinal', 0)
        )
    )
    $$,
    '22023',
    NULL,
    'Persist Integrity: Unknown item_temp_key rejected'
);

-- Persist Adversarial: Cross-document citation rejected (Item 8)
SELECT throws_ok(
    $$
    SELECT public.persist_study_pack_results_privileged(
        (SELECT study_pack_id FROM claimed_pack),
        (SELECT claim_token FROM claimed_pack),
        'mock-provider', 'mock-model',
        500, 250, 50, 0.0005,
        2, 2, 2, 194,
        jsonb_build_array(
            jsonb_build_object('temp_key', 'summary-0', 'item_type', 'SUMMARY', 'ordinal', 0, 'payload', jsonb_build_object('paragraph', 'Test.'))
        ),
        jsonb_build_array(
            jsonb_build_object('item_temp_key', 'summary-0', 'document_chunk_id', '22222222-cccc-0001-0000-000000000001'::UUID, 'ordinal', 0)
        )
    )
    $$,
    '22023',
    NULL,
    'Persist Integrity: Cross-document citation rejected'
);

-- Persist Adversarial: Uncited item in ready pack rejected (Item 9)
SELECT throws_ok(
    $$
    SELECT public.persist_study_pack_results_privileged(
        (SELECT study_pack_id FROM claimed_pack),
        (SELECT claim_token FROM claimed_pack),
        'mock-provider', 'mock-model',
        500, 250, 50, 0.0005,
        2, 2, 2, 194,
        jsonb_build_array(
            jsonb_build_object('temp_key', 'summary-0', 'item_type', 'SUMMARY', 'ordinal', 0, 'payload', jsonb_build_object('paragraph', 'Citated')),
            jsonb_build_object('temp_key', 'summary-1', 'item_type', 'SUMMARY', 'ordinal', 1, 'payload', jsonb_build_object('paragraph', 'Uncited'))
        ),
        jsonb_build_array(
            jsonb_build_object('item_temp_key', 'summary-0', 'document_chunk_id', (SELECT chunk_id FROM first_chunk), 'ordinal', 0)
        )
    )
    $$,
    '55000',
    NULL,
    'Persist Integrity: Uncited item in ready pack rejected'
);

SELECT is(
    public.persist_study_pack_results_privileged(
        (SELECT study_pack_id FROM claimed_pack),
        (SELECT claim_token FROM claimed_pack),
        'mock-provider',
        'mock-model',
        500, 250, 50, 0.0005,
        2, 2, 2, 194,
        jsonb_build_array(
            jsonb_build_object(
                'temp_key', 'summary-0',
                'item_type', 'SUMMARY',
                'ordinal', 0,
                'payload', jsonb_build_object('paragraph', 'La estenosis aórtica degenerativa es la causa más común en mayores de 70 años.')
            ),
            jsonb_build_object(
                'temp_key', 'obj-0',
                'item_type', 'LEARNING_OBJECTIVE',
                'ordinal', 0,
                'payload', jsonb_build_object('objective', 'Identificar la etiología y opciones de manejo en estenosis aórtica.')
            ),
            jsonb_build_object(
                'temp_key', 'concept-0',
                'item_type', 'KEY_CONCEPT',
                'ordinal', 0,
                'payload', jsonb_build_object('title', 'TAVI vs Quirúrgico', 'explanation', 'Indicado con área valvular < 1 cm2 o presencia de síntomas.')
            ),
            jsonb_build_object(
                'temp_key', 'hy-0',
                'item_type', 'HIGH_YIELD_POINT',
                'ordinal', 0,
                'payload', jsonb_build_object('point', 'Área valvular crítica < 1 cm2 es criterio clave de intervención.')
            ),
            jsonb_build_object(
                'temp_key', 'term-0',
                'item_type', 'KEY_TERM',
                'ordinal', 0,
                'payload', jsonb_build_object('term', 'TAVI', 'definition', 'Implante valvular aórtico transcatéter.')
            )
        ),
        jsonb_build_array(
            jsonb_build_object('item_temp_key', 'summary-0', 'document_chunk_id', (SELECT chunk_id FROM first_chunk), 'ordinal', 0),
            jsonb_build_object('item_temp_key', 'obj-0', 'document_chunk_id', (SELECT chunk_id FROM first_chunk), 'ordinal', 0),
            jsonb_build_object('item_temp_key', 'concept-0', 'document_chunk_id', (SELECT chunk_id FROM second_chunk), 'ordinal', 0),
            jsonb_build_object('item_temp_key', 'hy-0', 'document_chunk_id', (SELECT chunk_id FROM second_chunk), 'ordinal', 0),
            jsonb_build_object('item_temp_key', 'term-0', 'document_chunk_id', (SELECT chunk_id FROM second_chunk), 'ordinal', 0)
        )
    ),
    true,
    'Persist: Successful persist of Study Pack items and citations'
);

-- Verify study_packs transitioned to READY
SELECT is(
    (SELECT status FROM public.study_packs WHERE id = (SELECT study_pack_id FROM claimed_pack)),
    'READY',
    'Status: Study pack transitioned to READY'
);

-- Verify normalized items inserted
SELECT is(
    (SELECT COUNT(*) FROM public.study_pack_items WHERE study_pack_id = (SELECT study_pack_id FROM claimed_pack)),
    5::bigint,
    'Normalized Items: Exactly 5 items persisted across types'
);

-- Verify item citations inserted
SELECT is(
    (SELECT COUNT(*) FROM public.study_pack_item_citations WHERE study_pack_id = (SELECT study_pack_id FROM claimed_pack)),
    5::bigint,
    'Citations: Exactly 5 chunk citations persisted'
);

-- Verify server-derived page numbers through chunk relation
SELECT is(
    (
        SELECT c.page_number
        FROM public.study_pack_item_citations sc
        JOIN public.document_chunks c ON c.id = sc.document_chunk_id
        JOIN public.study_pack_items si ON si.id = sc.study_pack_item_id
        WHERE si.item_type = 'SUMMARY'
        LIMIT 1
    ),
    1,
    'Citation Resolution: Server derives page_number 1 from chunk join'
);

-- ============================================================================
-- 9. AI Usages Telemetry Recording
-- ============================================================================

SELECT isnt(
    public.record_ai_usage_privileged(
        '11111111-1111-1111-1111-111111111111',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        (SELECT study_pack_id FROM claimed_pack),
        'STUDY_PACK_GEN',
        'mock-provider',
        'mock-model',
        500,
        250,
        50,
        0.0005,
        1200,
        'SUCCESS'
    ),
    NULL,
    'Telemetry: Successfully recorded AI usage in ai_usages table'
);

SELECT is(
    (SELECT COUNT(*) FROM public.ai_usages WHERE user_id = '11111111-1111-1111-1111-111111111111'),
    1::bigint,
    'Telemetry Count: Exactly 1 record in ai_usages'
);

-- ============================================================================
-- 10. Tenant Isolation on Study Packs, Items, Citations & AI Usages (RLS)
-- ============================================================================

SET ROLE authenticated;
SET request.jwt.claims TO '{"sub": "11111111-1111-1111-1111-111111111111"}';

SELECT is(
    (SELECT COUNT(*) FROM public.study_packs WHERE user_id = '11111111-1111-1111-1111-111111111111'),
    1::bigint,
    'RLS: Alice can SELECT her own study packs'
);

SELECT is(
    (SELECT COUNT(*) FROM public.study_pack_items WHERE user_id = '11111111-1111-1111-1111-111111111111'),
    5::bigint,
    'RLS: Alice can SELECT her own study pack items'
);

SELECT is(
    (SELECT COUNT(*) FROM public.study_pack_item_citations WHERE user_id = '11111111-1111-1111-1111-111111111111'),
    5::bigint,
    'RLS: Alice can SELECT her own citations'
);

SELECT is(
    (SELECT COUNT(*) FROM public.ai_usages WHERE user_id = '11111111-1111-1111-1111-111111111111'),
    1::bigint,
    'RLS: Alice can SELECT her own ai_usages'
);

-- Bob cannot see Alice Study Pack, items, citations, or ai_usages
SET request.jwt.claims TO '{"sub": "22222222-2222-2222-2222-222222222222"}';

SELECT is_empty(
    $$ SELECT * FROM public.study_packs WHERE user_id = '11111111-1111-1111-1111-111111111111' $$,
    'RLS Isolation: Bob cannot view Alice study packs'
);

SELECT is_empty(
    $$ SELECT * FROM public.study_pack_items WHERE user_id = '11111111-1111-1111-1111-111111111111' $$,
    'RLS Isolation: Bob cannot view Alice study pack items'
);

SELECT is_empty(
    $$ SELECT * FROM public.study_pack_item_citations WHERE user_id = '11111111-1111-1111-1111-111111111111' $$,
    'RLS Isolation: Bob cannot view Alice citations'
);

SELECT is_empty(
    $$ SELECT * FROM public.ai_usages WHERE user_id = '11111111-1111-1111-1111-111111111111' $$,
    'RLS Isolation: Bob cannot view Alice ai_usages'
);

-- Authenticated mutations denied on study_packs and items
SELECT throws_ok(
    $$ INSERT INTO public.study_packs (user_id, document_id, processing_run_id) VALUES ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb') $$,
    '42501',
    NULL,
    'Privilege: Authenticated INSERT denied on study_packs'
);

SELECT throws_ok(
    $$ UPDATE public.study_packs SET status = 'READY' $$,
    '42501',
    NULL,
    'Privilege: Authenticated UPDATE denied on study_packs'
);

SELECT throws_ok(
    $$ DELETE FROM public.study_packs $$,
    '42501',
    NULL,
    'Privilege: Authenticated DELETE denied on study_packs'
);

SELECT throws_ok(
    $$ INSERT INTO public.ai_usages (user_id, feature, provider, model) VALUES ('22222222-2222-2222-2222-222222222222', 'STUDY_PACK_GEN', 'p', 'm') $$,
    '42501',
    NULL,
    'Privilege: Authenticated INSERT denied on ai_usages'
);

-- ============================================================================
-- 11. Archive vs Study Pack Race Closure
-- ============================================================================

SET ROLE service_role;

-- Enqueue Bob Study Pack, claim it to GENERATING
CREATE TEMP TABLE bob_pack AS
SELECT * FROM public.enqueue_study_pack_privileged(
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    '22222222-2222-2222-2222-222222222222',
    'sp-gen-v1'
);

CREATE TEMP TABLE bob_claimed AS
SELECT * FROM public.claim_next_study_pack('study-worker-01', 300);

-- Now archive Bob document while worker is "running"
SELECT lives_ok(
    $$ SELECT public.archive_document_privileged('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222') $$,
    'Archive: Archive Bob document succeeds'
);

-- Verify Bob study pack was marked FAILED_FINAL (DOCUMENT_ARCHIVED)
SELECT is(
    (SELECT status FROM public.study_packs WHERE id = (SELECT study_pack_id FROM bob_claimed)),
    'FAILED_FINAL',
    'Archive Race: Active study pack marked FAILED_FINAL on document archive'
);

SELECT is(
    (SELECT error_code FROM public.study_packs WHERE id = (SELECT study_pack_id FROM bob_claimed)),
    'DOCUMENT_ARCHIVED',
    'Archive Race: Error code set to DOCUMENT_ARCHIVED'
);

-- Stale worker persist attempt on archived document must be rejected
SELECT throws_ok(
    $$
    SELECT public.persist_study_pack_results_privileged(
        (SELECT study_pack_id FROM bob_claimed),
        (SELECT claim_token FROM bob_claimed),
        'mock-provider',
        'mock-model',
        100, 50, 0, 0.001,
        1, 1, 1, 100,
        '[]'::jsonb,
        '[]'::jsonb
    )
    $$,
    '55000',
    NULL,
    'Archive Race: Stale worker persist denied on archived document'
);

-- Verify derived study content deleted on archive (Item 10)
SELECT is(
    (SELECT COUNT(*) FROM public.study_pack_items WHERE user_id = '22222222-2222-2222-2222-222222222222'),
    0::bigint,
    'Archive Cascade: Derived study_pack_items deleted on document archive'
);

SELECT is(
    (SELECT COUNT(*) FROM public.study_pack_item_citations WHERE user_id = '22222222-2222-2222-2222-222222222222'),
    0::bigint,
    'Archive Cascade: Derived study_pack_item_citations deleted on document archive'
);

-- ============================================================================
-- 12. Retry Limit & Terminal Semantics
-- ============================================================================

RESET ROLE;

-- Bob un-archiving not supported, let's create a 3rd document for Charlie to test retry limits
INSERT INTO auth.users (id, email)
VALUES ('33333333-3333-3333-3333-333333333333', 'charlie@medstudy.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_profiles (id, email, full_name, onboarding_completed_at)
VALUES ('33333333-3333-3333-3333-333333333333', 'charlie@medstudy.test', 'Charlie Student', NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.documents (id, user_id, original_filename, storage_key, size_bytes, status)
VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', '33333333-3333-3333-3333-333333333333', 'c.pdf', '33/c.pdf', 1000, 'READY')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.document_processing_runs (id, document_id, user_id, status)
VALUES ('33333333-cccc-cccc-cccc-cccccccccccc', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '33333333-3333-3333-3333-333333333333', 'SUCCEEDED')
ON CONFLICT (id) DO NOTHING;

SET ROLE service_role;

-- Enqueue Charlie pack
CREATE TEMP TABLE charlie_pack AS
SELECT * FROM public.enqueue_study_pack_privileged('cccccccc-cccc-cccc-cccc-cccccccccccc', '33333333-3333-3333-3333-333333333333', 'sp-gen-v1');

-- Attempt 1: claim & fail retryable
CREATE TEMP TABLE charlie_c1 AS SELECT * FROM public.claim_next_study_pack('worker-01', 300);
SELECT is((SELECT attempt_count FROM charlie_c1), 1, 'Attempt Count: starts at 1 on first claim');
SELECT is(public.fail_study_pack_privileged((SELECT study_pack_id FROM charlie_c1), (SELECT claim_token FROM charlie_c1), 'AI_TIMEOUT', true), true, 'Fail 1: Retryable failure committed');

-- Attempt 2: re-enqueue & claim & fail retryable
SELECT * FROM public.enqueue_study_pack_privileged('cccccccc-cccc-cccc-cccc-cccccccccccc', '33333333-3333-3333-3333-333333333333', 'sp-gen-v1');
CREATE TEMP TABLE charlie_c2 AS SELECT * FROM public.claim_next_study_pack('worker-01', 300);
SELECT is((SELECT attempt_count FROM charlie_c2), 2, 'Attempt Count: incremented to 2 on second claim');
SELECT is(public.fail_study_pack_privileged((SELECT study_pack_id FROM charlie_c2), (SELECT claim_token FROM charlie_c2), 'AI_RATE_LIMITED', true), true, 'Fail 2: Retryable failure committed');

-- Attempt 3: re-enqueue & claim & fail retryable (attempt 3 reaches limit)
SELECT * FROM public.enqueue_study_pack_privileged('cccccccc-cccc-cccc-cccc-cccccccccccc', '33333333-3333-3333-3333-333333333333', 'sp-gen-v1');
CREATE TEMP TABLE charlie_c3 AS SELECT * FROM public.claim_next_study_pack('worker-01', 300);
SELECT is((SELECT attempt_count FROM charlie_c3), 3, 'Attempt Count: incremented to 3 on third claim');

-- Third failure transitions to FAILED_FINAL even if retryable was requested
SELECT public.fail_study_pack_privileged((SELECT study_pack_id FROM charlie_c3), (SELECT claim_token FROM charlie_c3), 'AI_RATE_LIMITED', true);

SELECT is(
    (SELECT status FROM public.study_packs WHERE id = (SELECT study_pack_id FROM charlie_c3)),
    'FAILED_FINAL',
    'Retry Limit: Transitions to FAILED_FINAL after exhausting attempts'
);

-- Attempting to re-enqueue FAILED_FINAL throws error
SELECT throws_ok(
    $$ SELECT * FROM public.enqueue_study_pack_privileged('cccccccc-cccc-cccc-cccc-cccccccccccc', '33333333-3333-3333-3333-333333333333', 'sp-gen-v1') $$,
    '22023',
    NULL,
    'Terminal Semantics: Cannot re-enqueue study pack after 3 failed attempts'
);

-- ============================================================================
-- 13. End of Test Suite
-- ============================================================================

SELECT * FROM finish();

ROLLBACK;
