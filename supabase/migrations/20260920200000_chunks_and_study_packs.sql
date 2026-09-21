-- Migration: 20260920200000_chunks_and_study_packs.sql
-- Description: Phase 1E: Canonical Document Chunks, Study Packs, Normalized Items, Citations & AI Usage Telemetry
-- Strict composite ownership integrity, least privilege model, FOR UPDATE SKIP LOCKED job claim,
-- claim token fencing, and write revocation on expired/null lease.

-- ============================================================================
-- 1. Prerequisites: Ensure Composite Unique Constraint on document_pages
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'uq_document_pages_id_doc_user'
          AND conrelid = 'public.document_pages'::regclass
    ) THEN
        ALTER TABLE public.document_pages
            ADD CONSTRAINT uq_document_pages_id_doc_user UNIQUE (id, document_id, user_id);
    END IF;
END $$;

-- ============================================================================
-- 2. Table: public.document_chunks
-- Deterministic canonical document chunks; strictly page-bounded in v1.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.document_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    document_id UUID NOT NULL,
    processing_run_id UUID NOT NULL,
    document_page_id UUID NOT NULL,
    page_number INT NOT NULL CHECK (page_number > 0),
    chunk_index INT NOT NULL CHECK (chunk_index >= 0),
    start_char INT NOT NULL CHECK (start_char >= 0),
    end_char INT NOT NULL CHECK (end_char > start_char),
    content TEXT NOT NULL,
    char_count INT NOT NULL CHECK (char_count > 0),
    content_sha256 TEXT NOT NULL,
    chunking_version TEXT NOT NULL DEFAULT 'chunk-v1',
    tsv_content TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_document_chunks_run_ver_page_idx UNIQUE (processing_run_id, chunking_version, page_number, chunk_index),
    CONSTRAINT uq_document_chunks_id_doc_user UNIQUE (id, document_id, user_id),
    CONSTRAINT uq_document_chunks_id_user UNIQUE (id, user_id),
    CONSTRAINT fk_document_chunks_run_owner FOREIGN KEY (processing_run_id, document_id, user_id)
        REFERENCES public.document_processing_runs(id, document_id, user_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_document_chunks_page_owner FOREIGN KEY (document_page_id, document_id, user_id)
        REFERENCES public.document_pages(id, document_id, user_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_document_chunks_doc_owner FOREIGN KEY (document_id, user_id)
        REFERENCES public.documents(id, user_id)
        ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_chunks_tsv ON public.document_chunks USING GIN(tsv_content);
CREATE INDEX IF NOT EXISTS idx_chunks_doc_page ON public.document_chunks(document_id, page_number);
CREATE INDEX IF NOT EXISTS idx_chunks_run ON public.document_chunks(processing_run_id);
CREATE INDEX IF NOT EXISTS idx_chunks_user ON public.document_chunks(user_id);

-- Enable RLS
ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;

-- SELECT policy: Users can only view their own chunks
DROP POLICY IF EXISTS "Users can view own document chunks" ON public.document_chunks;
CREATE POLICY "Users can view own document chunks"
    ON public.document_chunks
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

-- Strict privilege model: no direct mutations by authenticated or anon
REVOKE ALL ON TABLE public.document_chunks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.document_chunks TO authenticated;

-- ============================================================================
-- 3. Table: public.study_packs
-- Cached Study Pack entity with queue/claim fencing
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.study_packs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    document_id UUID NOT NULL,
    processing_run_id UUID NOT NULL,
    chunking_version TEXT NOT NULL DEFAULT 'chunk-v1',
    generation_version TEXT NOT NULL DEFAULT 'sp-gen-v1',
    prompt_version TEXT NOT NULL DEFAULT 'sp-prompt-v1',
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'GENERATING', 'READY', 'FAILED_RETRYABLE', 'FAILED_FINAL')),
    attempt_count INT NOT NULL DEFAULT 0,
    claimed_by TEXT,
    claim_token UUID,
    lease_expires_at TIMESTAMPTZ,
    error_code TEXT,
    provider TEXT,
    model TEXT,
    input_tokens INT NOT NULL DEFAULT 0,
    output_tokens INT NOT NULL DEFAULT 0,
    cached_tokens INT NOT NULL DEFAULT 0,
    estimated_cost_usd NUMERIC(10, 6),
    source_page_count INT,
    evidence_page_count INT,
    source_chunk_count INT,
    evidence_chunk_count INT,
    evidence_char_count INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_study_packs_gen UNIQUE (document_id, processing_run_id, generation_version),
    CONSTRAINT uq_study_packs_id_doc_user UNIQUE (id, document_id, user_id),
    CONSTRAINT uq_study_packs_id_user UNIQUE (id, user_id),
    CONSTRAINT fk_study_packs_run_owner FOREIGN KEY (processing_run_id, document_id, user_id)
        REFERENCES public.document_processing_runs(id, document_id, user_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_study_packs_doc_owner FOREIGN KEY (document_id, user_id)
        REFERENCES public.documents(id, user_id)
        ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_study_packs_user ON public.study_packs(user_id);
CREATE INDEX IF NOT EXISTS idx_study_packs_doc ON public.study_packs(document_id);
CREATE INDEX IF NOT EXISTS idx_study_packs_status ON public.study_packs(status);
CREATE INDEX IF NOT EXISTS idx_study_packs_lease ON public.study_packs(lease_expires_at);

-- Attach updated_at trigger
DROP TRIGGER IF EXISTS on_study_packs_updated ON public.study_packs;
CREATE TRIGGER on_study_packs_updated
    BEFORE UPDATE ON public.study_packs
    FOR EACH ROW
    EXECUTE FUNCTION private.handle_updated_at();

-- Enable RLS
ALTER TABLE public.study_packs ENABLE ROW LEVEL SECURITY;

-- SELECT policy: Users can only view their own study packs
DROP POLICY IF EXISTS "Users can view own study packs" ON public.study_packs;
CREATE POLICY "Users can view own study packs"
    ON public.study_packs
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

REVOKE ALL ON TABLE public.study_packs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.study_packs TO authenticated;

-- ============================================================================
-- 4. Table: public.study_pack_items
-- Normalized Study Pack content items
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.study_pack_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    study_pack_id UUID NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    item_type TEXT NOT NULL CHECK (item_type IN ('SUMMARY', 'LEARNING_OBJECTIVE', 'KEY_CONCEPT', 'HIGH_YIELD_POINT', 'KEY_TERM')),
    ordinal INT NOT NULL CHECK (ordinal >= 0),
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_study_pack_items_id_pack_user UNIQUE (id, study_pack_id, user_id),
    CONSTRAINT uq_study_pack_items_pack_type_ord UNIQUE (study_pack_id, item_type, ordinal),
    CONSTRAINT fk_study_pack_items_pack_owner FOREIGN KEY (study_pack_id, user_id)
        REFERENCES public.study_packs(id, user_id)
        ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_study_pack_items_pack ON public.study_pack_items(study_pack_id);
CREATE INDEX IF NOT EXISTS idx_study_pack_items_user ON public.study_pack_items(user_id);

-- Enable RLS
ALTER TABLE public.study_pack_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own study pack items" ON public.study_pack_items;
CREATE POLICY "Users can view own study pack items"
    ON public.study_pack_items
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

REVOKE ALL ON TABLE public.study_pack_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.study_pack_items TO authenticated;

-- ============================================================================
-- 5. Table: public.study_pack_item_citations
-- Chunk citations linking normalized items to exact canonical chunks
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.study_pack_item_citations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    study_pack_item_id UUID NOT NULL,
    study_pack_id UUID NOT NULL,
    document_chunk_id UUID NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    ordinal INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_study_pack_citations_item_chunk UNIQUE (study_pack_item_id, document_chunk_id),
    CONSTRAINT fk_study_pack_item_citations_item FOREIGN KEY (study_pack_item_id, study_pack_id, user_id)
        REFERENCES public.study_pack_items(id, study_pack_id, user_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_study_pack_item_citations_chunk FOREIGN KEY (document_chunk_id, user_id)
        REFERENCES public.document_chunks(id, user_id)
        ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_study_pack_citations_item ON public.study_pack_item_citations(study_pack_item_id);
CREATE INDEX IF NOT EXISTS idx_study_pack_citations_chunk ON public.study_pack_item_citations(document_chunk_id);
CREATE INDEX IF NOT EXISTS idx_study_pack_citations_user ON public.study_pack_item_citations(user_id);

-- Enable RLS
ALTER TABLE public.study_pack_item_citations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own study pack citations" ON public.study_pack_item_citations;
CREATE POLICY "Users can view own study pack citations"
    ON public.study_pack_item_citations
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

REVOKE ALL ON TABLE public.study_pack_item_citations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.study_pack_item_citations TO authenticated;

-- ============================================================================
-- 6. Table: public.ai_usages
-- AI generation telemetry and cost tracking (zero secrets, zero prompt text)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ai_usages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    document_id UUID,
    study_pack_id UUID,
    feature TEXT NOT NULL CHECK (feature IN ('STUDY_PACK_GEN', 'STUDY_PACK_VERIFY', 'BENCHMARK')),
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INT NOT NULL DEFAULT 0,
    output_tokens INT NOT NULL DEFAULT 0,
    cached_tokens INT NOT NULL DEFAULT 0,
    estimated_cost_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,
    latency_ms INT,
    status TEXT NOT NULL CHECK (status IN ('SUCCESS', 'FAILED', 'RATE_LIMITED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_ai_usages_doc_owner FOREIGN KEY (document_id, user_id)
        REFERENCES public.documents(id, user_id) ON DELETE SET NULL (document_id),
    CONSTRAINT fk_ai_usages_pack_owner FOREIGN KEY (study_pack_id, user_id)
        REFERENCES public.study_packs(id, user_id) ON DELETE SET NULL (study_pack_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ai_usages_user_created ON public.ai_usages(user_id, created_at);

-- Enable RLS
ALTER TABLE public.ai_usages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own AI usages" ON public.ai_usages;
CREATE POLICY "Users can view own AI usages"
    ON public.ai_usages
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

REVOKE ALL ON TABLE public.ai_usages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.ai_usages TO authenticated;

-- ============================================================================
-- 7. Privileged Function: public.record_ai_usage_privileged()
-- Records an AI telemetry entry safely.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.record_ai_usage_privileged(
    p_user_id UUID,
    p_document_id UUID,
    p_study_pack_id UUID,
    p_feature TEXT,
    p_provider TEXT,
    p_model TEXT,
    p_input_tokens INT,
    p_output_tokens INT,
    p_cached_tokens INT,
    p_estimated_cost_usd NUMERIC,
    p_latency_ms INT,
    p_status TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_id UUID;
BEGIN
    IF p_document_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.documents WHERE id = p_document_id AND user_id = p_user_id
    ) THEN
        RAISE EXCEPTION 'Document % does not belong to user %', p_document_id, p_user_id USING ERRCODE = '22023';
    END IF;

    IF p_study_pack_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.study_packs WHERE id = p_study_pack_id AND user_id = p_user_id
    ) THEN
        RAISE EXCEPTION 'Study pack % does not belong to user %', p_study_pack_id, p_user_id USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.ai_usages (
        user_id,
        document_id,
        study_pack_id,
        feature,
        provider,
        model,
        input_tokens,
        output_tokens,
        cached_tokens,
        estimated_cost_usd,
        latency_ms,
        status
    )
    VALUES (
        p_user_id,
        p_document_id,
        p_study_pack_id,
        p_feature,
        p_provider,
        p_model,
        COALESCE(p_input_tokens, 0),
        COALESCE(p_output_tokens, 0),
        COALESCE(p_cached_tokens, 0),
        COALESCE(p_estimated_cost_usd, 0),
        p_latency_ms,
        p_status
    )
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_ai_usage_privileged(UUID, UUID, UUID, TEXT, TEXT, TEXT, INT, INT, INT, NUMERIC, INT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_ai_usage_privileged(UUID, UUID, UUID, TEXT, TEXT, TEXT, INT, INT, INT, NUMERIC, INT, TEXT) TO service_role;

-- ============================================================================
-- 8. Privileged Function: public.create_document_chunks_privileged()
-- Atomically inserts canonical chunks for a SUCCEEDED run and validates source integrity.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_document_chunks_privileged(
    p_processing_run_id UUID,
    p_chunking_version TEXT,
    p_chunks JSONB
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_run RECORD;
    v_doc RECORD;
    v_page RECORD;
    v_chunk RECORD;
    v_count INT := 0;
BEGIN
    -- Verify processing run exists and succeeded
    SELECT pr.id, pr.document_id, pr.user_id, pr.status
    INTO v_run
    FROM public.document_processing_runs pr
    WHERE pr.id = p_processing_run_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Processing run % not found', p_processing_run_id USING ERRCODE = '22023';
    END IF;

    IF v_run.status != 'SUCCEEDED' THEN
        RAISE EXCEPTION 'Processing run must be SUCCEEDED to create chunks (current: %)', v_run.status USING ERRCODE = '55000';
    END IF;

    -- Verify document is READY and unarchived
    SELECT d.id, d.status, d.archived_at
    INTO v_doc
    FROM public.documents d
    WHERE d.id = v_run.document_id AND d.user_id = v_run.user_id;

    IF NOT FOUND OR v_doc.status != 'READY' OR v_doc.archived_at IS NOT NULL THEN
        RAISE EXCEPTION 'Document is not in READY state or is archived' USING ERRCODE = '55000';
    END IF;

    -- Check if chunks for this processing run and version already exist
    SELECT COUNT(*) INTO v_count
    FROM public.document_chunks
    WHERE processing_run_id = p_processing_run_id
      AND chunking_version = p_chunking_version;

    IF v_count > 0 THEN
        RETURN v_count;
    END IF;

    -- Insert chunks from JSONB array with strict provenance validation
    FOR v_chunk IN
        SELECT
            (c->>'document_page_id')::UUID AS document_page_id,
            (c->>'page_number')::INT AS page_number,
            (c->>'chunk_index')::INT AS chunk_index,
            (c->>'start_char')::INT AS start_char,
            (c->>'end_char')::INT AS end_char,
            (c->>'content')::TEXT AS content,
            (c->>'char_count')::INT AS char_count,
            (c->>'content_sha256')::TEXT AS content_sha256
        FROM jsonb_array_elements(p_chunks) AS c
    LOOP
        -- 1. Verify document_page exists and belongs to this run, doc, and user
        SELECT dp.id, dp.page_number, dp.text_content
        INTO v_page
        FROM public.document_pages dp
        WHERE dp.id = v_chunk.document_page_id
          AND dp.processing_run_id = v_run.id
          AND dp.document_id = v_run.document_id
          AND dp.user_id = v_run.user_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Page % does not belong to processing run %', v_chunk.document_page_id, p_processing_run_id USING ERRCODE = '22023';
        END IF;

        -- 2. Verify page number matches
        IF v_page.page_number != v_chunk.page_number THEN
            RAISE EXCEPTION 'Page number mismatch: page has %, chunk has %', v_page.page_number, v_chunk.page_number USING ERRCODE = '22023';
        END IF;

        -- 3. Verify offsets are valid
        IF v_chunk.start_char < 0 OR v_chunk.end_char > length(v_page.text_content) OR v_chunk.start_char >= v_chunk.end_char THEN
            RAISE EXCEPTION 'Chunk offsets out of bounds: [%, %] on page length %', v_chunk.start_char, v_chunk.end_char, length(v_page.text_content) USING ERRCODE = '22023';
        END IF;

        -- 4. Verify char count matches slice
        IF v_chunk.char_count != (v_chunk.end_char - v_chunk.start_char) THEN
            RAISE EXCEPTION 'Chunk char_count mismatch' USING ERRCODE = '22023';
        END IF;

        -- 5. Verify chunk content matches exact page substring
        IF v_chunk.content != substring(v_page.text_content from (v_chunk.start_char + 1) for v_chunk.char_count) THEN
            RAISE EXCEPTION 'Chunk content does not match page substring at [%, %]', v_chunk.start_char, v_chunk.end_char USING ERRCODE = '22023';
        END IF;

        -- 6. Verify SHA-256 matches content
        IF v_chunk.content_sha256 != pg_catalog.encode(extensions.digest(convert_to(v_chunk.content, 'UTF8'), 'sha256'), 'hex') THEN
            RAISE EXCEPTION 'Chunk content_sha256 mismatch' USING ERRCODE = '22023';
        END IF;

        INSERT INTO public.document_chunks (
            user_id,
            document_id,
            processing_run_id,
            document_page_id,
            page_number,
            chunk_index,
            start_char,
            end_char,
            content,
            char_count,
            content_sha256,
            chunking_version
        )
        VALUES (
            v_run.user_id,
            v_run.document_id,
            v_run.id,
            v_chunk.document_page_id,
            v_chunk.page_number,
            v_chunk.chunk_index,
            v_chunk.start_char,
            v_chunk.end_char,
            v_chunk.content,
            v_chunk.char_count,
            v_chunk.content_sha256,
            p_chunking_version
        );
        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.create_document_chunks_privileged(UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_document_chunks_privileged(UUID, TEXT, JSONB) TO service_role;

-- ============================================================================
-- 9. Privileged Function: public.enqueue_study_pack_privileged()
-- Idempotently creates or re-enqueues a study pack generation job.
-- ============================================================================

DROP FUNCTION IF EXISTS public.enqueue_study_pack_privileged(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.enqueue_study_pack_privileged(UUID, UUID, TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.enqueue_study_pack_privileged(
    p_document_id UUID,
    p_user_id UUID,
    p_generation_version TEXT DEFAULT 'sp-gen-v1',
    p_chunking_version TEXT DEFAULT 'chunk-v1',
    p_prompt_version TEXT DEFAULT 'sp-prompt-v1'
)
RETURNS TABLE (
    study_pack_id UUID,
    document_id UUID,
    user_id UUID,
    processing_run_id UUID,
    chunking_version TEXT,
    generation_version TEXT,
    prompt_version TEXT,
    status TEXT,
    attempt_count INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
    v_doc RECORD;
    v_run RECORD;
    v_existing RECORD;
    v_pack RECORD;
BEGIN
    -- Acquire transaction-level advisory lock scoped to (document_id, generation_version)
    -- to serialize concurrent enqueues and guarantee convergent idempotency
    PERFORM pg_advisory_xact_lock(hashtext(p_document_id::text || ':' || p_generation_version));

    -- Verify document is READY and unarchived
    SELECT d.id, d.status, d.archived_at
    INTO v_doc
    FROM public.documents d
    WHERE d.id = p_document_id AND d.user_id = p_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Document % not found or not owned by user %', p_document_id, p_user_id USING ERRCODE = '22023';
    END IF;

    IF v_doc.archived_at IS NOT NULL THEN
        RAISE EXCEPTION 'Document % is archived', p_document_id USING ERRCODE = '55000';
    END IF;

    IF v_doc.status != 'READY' THEN
        RAISE EXCEPTION 'Document % is not in READY state (current: %)', p_document_id, v_doc.status USING ERRCODE = '55000';
    END IF;

    -- Verify active processing run is SUCCEEDED
    SELECT pr.id, pr.status
    INTO v_run
    FROM public.document_processing_runs pr
    WHERE pr.document_id = p_document_id
      AND pr.user_id = p_user_id
    ORDER BY pr.created_at DESC
    LIMIT 1;

    IF NOT FOUND OR v_run.status != 'SUCCEEDED' THEN
        RAISE EXCEPTION 'Document has no SUCCEEDED processing run' USING ERRCODE = '55000';
    END IF;

    -- Check if a study pack row exists
    SELECT sp.id, sp.document_id, sp.user_id, sp.processing_run_id, sp.chunking_version, sp.generation_version, sp.prompt_version, sp.status, sp.attempt_count, sp.error_code
    INTO v_existing
    FROM public.study_packs sp
    WHERE sp.document_id = p_document_id
      AND sp.processing_run_id = v_run.id
      AND sp.generation_version = p_generation_version;

    IF FOUND THEN
        -- If READY, PENDING, or actively GENERATING: return existing without mutation
        IF v_existing.status IN ('READY', 'PENDING', 'GENERATING') THEN
            RETURN QUERY
            SELECT v_existing.id, v_existing.document_id, v_existing.user_id, v_existing.processing_run_id, v_existing.chunking_version, v_existing.generation_version, v_existing.prompt_version, v_existing.status, v_existing.attempt_count;
            RETURN;
        END IF;

        -- If FAILED_RETRYABLE OR operational configuration failure: reset to PENDING
        IF v_existing.status = 'FAILED_RETRYABLE' OR (v_existing.status = 'FAILED_FINAL' AND v_existing.error_code IN ('AI_DISABLED', 'AI_NOT_CONFIGURED')) THEN
            UPDATE public.study_packs sp
            SET status = 'PENDING',
                chunking_version = p_chunking_version,
                prompt_version = p_prompt_version,
                error_code = NULL,
                claimed_by = NULL,
                claim_token = NULL,
                lease_expires_at = NULL,
                started_at = NULL,
                finished_at = NULL,
                updated_at = NOW()
            WHERE sp.id = v_existing.id
            RETURNING sp.id, sp.document_id, sp.user_id, sp.processing_run_id, sp.chunking_version, sp.generation_version, sp.prompt_version, sp.status, sp.attempt_count
            INTO v_pack;

            RETURN QUERY
            SELECT v_pack.id, v_pack.document_id, v_pack.user_id, v_pack.processing_run_id, v_pack.chunking_version, v_pack.generation_version, v_pack.prompt_version, v_pack.status, v_pack.attempt_count;
            RETURN;
        END IF;

        -- If FAILED_FINAL with real content/attempt failures: cannot re-enqueue
        IF v_existing.status = 'FAILED_FINAL' THEN
            RAISE EXCEPTION 'Cannot re-enqueue study pack after % failed attempts', v_existing.attempt_count USING ERRCODE = '22023';
        END IF;
    END IF;

    -- Create new PENDING study pack with ON CONFLICT convergence
    INSERT INTO public.study_packs (
        user_id,
        document_id,
        processing_run_id,
        chunking_version,
        generation_version,
        prompt_version,
        status,
        attempt_count
    )
    VALUES (
        p_user_id,
        p_document_id,
        v_run.id,
        p_chunking_version,
        p_generation_version,
        p_prompt_version,
        'PENDING',
        0
    )
    ON CONFLICT (document_id, processing_run_id, generation_version) DO NOTHING
    RETURNING
        public.study_packs.id,
        public.study_packs.document_id,
        public.study_packs.user_id,
        public.study_packs.processing_run_id,
        public.study_packs.chunking_version,
        public.study_packs.generation_version,
        public.study_packs.prompt_version,
        public.study_packs.status,
        public.study_packs.attempt_count
    INTO v_pack;

    -- If another concurrent insert won the race, fetch and return the winning row
    IF v_pack.id IS NULL THEN
        SELECT sp.id, sp.document_id, sp.user_id, sp.processing_run_id, sp.chunking_version, sp.generation_version, sp.prompt_version, sp.status, sp.attempt_count
        INTO v_pack
        FROM public.study_packs sp
        WHERE sp.document_id = p_document_id
          AND sp.processing_run_id = v_run.id
          AND sp.generation_version = p_generation_version;
    END IF;

    RETURN QUERY
    SELECT v_pack.id, v_pack.document_id, v_pack.user_id, v_pack.processing_run_id, v_pack.chunking_version, v_pack.generation_version, v_pack.prompt_version, v_pack.status, v_pack.attempt_count;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_study_pack_privileged(UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_study_pack_privileged(UUID, UUID, TEXT, TEXT, TEXT) TO service_role;

-- ============================================================================
-- 10. Privileged Function: public.claim_next_study_pack()
-- FOR UPDATE SKIP LOCKED job claim with lease fencing and recovery
-- ============================================================================

CREATE OR REPLACE FUNCTION public.claim_next_study_pack(
    p_worker_id TEXT,
    p_lease_seconds INT DEFAULT 300
)
RETURNS TABLE (
    study_pack_id UUID,
    document_id UUID,
    user_id UUID,
    processing_run_id UUID,
    chunking_version TEXT,
    generation_version TEXT,
    prompt_version TEXT,
    attempt_count INT,
    claim_token UUID,
    original_filename TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
    v_pack_id UUID;
    v_claim_token UUID;
BEGIN
    IF p_worker_id IS NULL OR trim(p_worker_id) = '' THEN
        RAISE EXCEPTION 'p_worker_id is required' USING ERRCODE = '22023';
    END IF;

    IF p_lease_seconds IS NULL OR p_lease_seconds < 10 OR p_lease_seconds > 1800 THEN
        RAISE EXCEPTION 'Lease seconds must be between 10 and 1800' USING ERRCODE = '22023';
    END IF;

    -- Maintenance: mark expired GENERATING jobs that exceeded retries as FAILED_FINAL
    UPDATE public.study_packs
    SET status = 'FAILED_FINAL',
        error_code = 'STUDY_PACK_RETRY_LIMIT',
        claimed_by = NULL,
        claim_token = NULL,
        lease_expires_at = NULL,
        finished_at = NOW(),
        updated_at = NOW()
    WHERE status = 'GENERATING'
      AND lease_expires_at < NOW()
      AND attempt_count >= 3;

    -- Select candidate row using FOR UPDATE SKIP LOCKED
    SELECT sp.id INTO v_pack_id
    FROM public.study_packs sp
    JOIN public.documents d ON d.id = sp.document_id
    WHERE d.archived_at IS NULL
      AND d.status = 'READY'
      AND (
          sp.status = 'PENDING'
          OR (sp.status = 'GENERATING' AND sp.lease_expires_at < NOW() AND sp.attempt_count < 3)
      )
    ORDER BY sp.created_at ASC
    LIMIT 1
    FOR UPDATE OF sp SKIP LOCKED;

    IF v_pack_id IS NULL THEN
        RETURN;
    END IF;

    v_claim_token := gen_random_uuid();

    UPDATE public.study_packs sp
    SET status = 'GENERATING',
        attempt_count = sp.attempt_count + 1,
        claimed_by = p_worker_id,
        claim_token = v_claim_token,
        lease_expires_at = NOW() + (p_lease_seconds || ' seconds')::INTERVAL,
        started_at = COALESCE(sp.started_at, NOW()),
        updated_at = NOW()
    WHERE sp.id = v_pack_id;

    RETURN QUERY
    SELECT
        sp.id AS study_pack_id,
        sp.document_id,
        sp.user_id,
        sp.processing_run_id,
        sp.chunking_version,
        sp.generation_version,
        sp.prompt_version,
        sp.attempt_count,
        sp.claim_token,
        d.original_filename
    FROM public.study_packs sp
    JOIN public.documents d ON d.id = sp.document_id
    WHERE sp.id = v_pack_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_study_pack(TEXT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_study_pack(TEXT, INT) TO service_role;

-- ============================================================================
-- 11. Privileged Function: public.persist_study_pack_results_privileged()
-- Persists normalized Study Pack items, citations, metadata and transitions to READY.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.persist_study_pack_results_privileged(
    p_study_pack_id UUID,
    p_claim_token UUID,
    p_provider TEXT,
    p_model TEXT,
    p_input_tokens INT,
    p_output_tokens INT,
    p_cached_tokens INT,
    p_estimated_cost_usd NUMERIC,
    p_source_page_count INT,
    p_source_chunk_count INT,
    p_evidence_chunk_count INT,
    p_evidence_char_count INT,
    p_items JSONB,
    p_citations JSONB,
    p_evidence_page_count INT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_pack RECORD;
    v_doc RECORD;
    v_item RECORD;
    v_citation RECORD;
    v_item_id_map JSONB := '{}'::jsonb;
    v_new_item_id UUID;
    v_authoritative_page_count INT;
    v_calculated_evidence_pages INT;
BEGIN
    -- Verify active claim lease and token
    SELECT sp.id, sp.document_id, sp.user_id, sp.processing_run_id, sp.chunking_version, sp.status, sp.claim_token, sp.lease_expires_at
    INTO v_pack
    FROM public.study_packs sp
    WHERE sp.id = p_study_pack_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Study pack % not found', p_study_pack_id USING ERRCODE = '22023';
    END IF;

    IF v_pack.claim_token IS NULL OR v_pack.claim_token != p_claim_token THEN
        RAISE EXCEPTION 'Claim token mismatch or revoked' USING ERRCODE = '55000';
    END IF;

    IF v_pack.lease_expires_at IS NULL OR v_pack.lease_expires_at <= NOW() THEN
        RAISE EXCEPTION 'Worker lease expired or null; write revoked' USING ERRCODE = '55000';
    END IF;

    -- Verify parent document is active and unarchived
    SELECT d.id, d.status, d.archived_at
    INTO v_doc
    FROM public.documents d
    WHERE d.id = v_pack.document_id AND d.user_id = v_pack.user_id;

    IF NOT FOUND OR v_doc.archived_at IS NOT NULL THEN
        RAISE EXCEPTION 'Document is archived or missing; write revoked' USING ERRCODE = '55000';
    END IF;

    -- Delete any existing items/citations for this study pack (idempotent overwrite)
    DELETE FROM public.study_pack_items WHERE study_pack_id = p_study_pack_id;

    -- Insert normalized items from JSONB array
    FOR v_item IN
        SELECT
            (i->>'temp_key')::TEXT AS temp_key,
            (i->>'item_type')::TEXT AS item_type,
            (i->>'ordinal')::INT AS ordinal,
            (i->'payload')::JSONB AS payload
        FROM jsonb_array_elements(p_items) AS i
    LOOP
        INSERT INTO public.study_pack_items (
            study_pack_id,
            user_id,
            item_type,
            ordinal,
            payload
        )
        VALUES (
            p_study_pack_id,
            v_pack.user_id,
            v_item.item_type,
            v_item.ordinal,
            v_item.payload
        )
        RETURNING id INTO v_new_item_id;

        -- Record mapping from temp_key to generated UUID
        v_item_id_map := jsonb_set(v_item_id_map, ARRAY[v_item.temp_key], to_jsonb(v_new_item_id::text));
    END LOOP;

    -- Insert citations with strict ownership and cross-document verification
    FOR v_citation IN
        SELECT
            (c->>'item_temp_key')::TEXT AS item_temp_key,
            (c->>'document_chunk_id')::UUID AS document_chunk_id,
            (c->>'ordinal')::INT AS ordinal
        FROM jsonb_array_elements(p_citations) AS c
    LOOP
        -- Resolve foreign key to inserted item
        v_new_item_id := (v_item_id_map->>v_citation.item_temp_key)::UUID;
        IF v_new_item_id IS NULL THEN
            RAISE EXCEPTION 'Item temp_key % not found in inserted items', v_citation.item_temp_key USING ERRCODE = '22023';
        END IF;

        -- Verify cited chunk belongs strictly to this document, run, chunking version, and user
        IF NOT EXISTS (
            SELECT 1 FROM public.document_chunks dc
            WHERE dc.id = v_citation.document_chunk_id
              AND dc.document_id = v_pack.document_id
              AND dc.processing_run_id = v_pack.processing_run_id
              AND dc.user_id = v_pack.user_id
              AND dc.chunking_version = v_pack.chunking_version
        ) THEN
            RAISE EXCEPTION 'Citation references chunk % not belonging to study pack document % (run %, version %)',
                v_citation.document_chunk_id, v_pack.document_id, v_pack.processing_run_id, v_pack.chunking_version USING ERRCODE = '22023';
        END IF;

        INSERT INTO public.study_pack_item_citations (
            study_pack_item_id,
            study_pack_id,
            document_chunk_id,
            user_id,
            ordinal
        )
        VALUES (
            v_new_item_id,
            p_study_pack_id,
            v_citation.document_chunk_id,
            v_pack.user_id,
            COALESCE(v_citation.ordinal, 0)
        )
        ON CONFLICT (study_pack_item_id, document_chunk_id) DO NOTHING;
    END LOOP;

    -- Verify every item has at least one citation (Item 9)
    IF EXISTS (
        SELECT 1
        FROM public.study_pack_items spi
        LEFT JOIN public.study_pack_item_citations spic ON spic.study_pack_item_id = spi.id
        WHERE spi.study_pack_id = p_study_pack_id
          AND spic.id IS NULL
    ) THEN
        RAISE EXCEPTION 'Study pack cannot be marked READY with uncited items' USING ERRCODE = '55000';
    END IF;

    -- Authoritative page counts: source_page_count from document_processing_runs, evidence_page_count from distinct pages in document_chunks
    SELECT pr.page_count INTO v_authoritative_page_count
    FROM public.document_processing_runs pr
    WHERE pr.id = v_pack.processing_run_id;

    SELECT COUNT(DISTINCT dc.page_number) INTO v_calculated_evidence_pages
    FROM public.document_chunks dc
    WHERE dc.processing_run_id = v_pack.processing_run_id;

    -- Update study_packs record to READY
    UPDATE public.study_packs
    SET status = 'READY',
        provider = p_provider,
        model = p_model,
        input_tokens = p_input_tokens,
        output_tokens = p_output_tokens,
        cached_tokens = p_cached_tokens,
        estimated_cost_usd = p_estimated_cost_usd,
        source_page_count = COALESCE(v_authoritative_page_count, p_source_page_count),
        evidence_page_count = COALESCE(p_evidence_page_count, v_calculated_evidence_pages, 0),
        source_chunk_count = p_source_chunk_count,
        evidence_chunk_count = p_evidence_chunk_count,
        evidence_char_count = p_evidence_char_count,
        error_code = NULL,
        claimed_by = NULL,
        claim_token = NULL,
        lease_expires_at = NULL,
        finished_at = NOW(),
        updated_at = NOW()
    WHERE id = p_study_pack_id;

    RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.persist_study_pack_results_privileged(UUID, UUID, TEXT, TEXT, INT, INT, INT, NUMERIC, INT, INT, INT, INT, JSONB, JSONB, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_study_pack_results_privileged(UUID, UUID, TEXT, TEXT, INT, INT, INT, NUMERIC, INT, INT, INT, INT, JSONB, JSONB, INT) TO service_role;

-- ============================================================================
-- 12. Privileged Function: public.fail_study_pack_privileged()
-- Handles terminal or retryable failures with lease fencing.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fail_study_pack_privileged(
    p_study_pack_id UUID,
    p_claim_token UUID,
    p_error_code TEXT,
    p_retryable BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_pack RECORD;
    v_next_status TEXT;
BEGIN
    SELECT sp.id, sp.attempt_count, sp.claim_token, sp.lease_expires_at
    INTO v_pack
    FROM public.study_packs sp
    WHERE sp.id = p_study_pack_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Study pack % not found', p_study_pack_id USING ERRCODE = '22023';
    END IF;

    IF v_pack.claim_token IS NULL OR v_pack.claim_token != p_claim_token THEN
        RAISE EXCEPTION 'Claim token mismatch or revoked' USING ERRCODE = '55000';
    END IF;

    IF v_pack.lease_expires_at IS NULL OR v_pack.lease_expires_at <= NOW() THEN
        RAISE EXCEPTION 'Worker lease expired or null; write revoked' USING ERRCODE = '55000';
    END IF;

    IF p_error_code IN ('AI_DISABLED', 'AI_NOT_CONFIGURED') THEN
        -- Operational configuration states do not consume attempt budget and are always recoverable
        v_next_status := 'FAILED_RETRYABLE';
        UPDATE public.study_packs
        SET attempt_count = GREATEST(0, attempt_count - 1)
        WHERE id = p_study_pack_id;
    ELSIF p_retryable AND v_pack.attempt_count < 3 THEN
        v_next_status := 'FAILED_RETRYABLE';
    ELSE
        v_next_status := 'FAILED_FINAL';
    END IF;

    UPDATE public.study_packs
    SET status = v_next_status,
        error_code = p_error_code,
        claimed_by = NULL,
        claim_token = NULL,
        lease_expires_at = NULL,
        finished_at = NOW(),
        updated_at = NOW()
    WHERE id = p_study_pack_id;

    RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.fail_study_pack_privileged(UUID, UUID, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_study_pack_privileged(UUID, UUID, TEXT, BOOLEAN) TO service_role;

-- ============================================================================
-- 13. Update archive_document_privileged() to also cancel active Study Packs
-- ============================================================================

CREATE OR REPLACE FUNCTION public.archive_document_privileged(
    p_document_id UUID,
    p_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_doc RECORD;
BEGIN
    -- Verify document exists and belongs to user
    SELECT d.id, d.archived_at
    INTO v_doc
    FROM public.documents d
    WHERE d.id = p_document_id AND d.user_id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Document % not found or not owned by user %', p_document_id, p_user_id USING ERRCODE = '22023';
    END IF;

    IF v_doc.archived_at IS NOT NULL THEN
        RETURN TRUE;
    END IF;

    -- Mark document as archived
    UPDATE public.documents
    SET archived_at = NOW(),
        updated_at = NOW()
    WHERE id = p_document_id;

    -- 2. Close and cancel any processing runs
    UPDATE public.document_processing_runs
    SET status = 'FAILED_FINAL',
        error_code = 'DOCUMENT_ARCHIVED',
        claimed_by = NULL,
        claim_token = NULL,
        lease_expires_at = NULL,
        finished_at = NOW(),
        updated_at = NOW()
    WHERE document_id = p_document_id;

    -- 3. Fail any active or pending study packs as FAILED_FINAL (DOCUMENT_ARCHIVED)
    UPDATE public.study_packs
    SET status = 'FAILED_FINAL',
        error_code = 'DOCUMENT_ARCHIVED',
        claimed_by = NULL,
        claim_token = NULL,
        lease_expires_at = NULL,
        finished_at = NOW(),
        updated_at = NOW()
    WHERE document_id = p_document_id;

    -- Delete derived study content (Item 10)
    DELETE FROM public.study_pack_item_citations
    WHERE study_pack_id IN (SELECT id FROM public.study_packs WHERE document_id = p_document_id);

    DELETE FROM public.study_pack_items
    WHERE study_pack_id IN (SELECT id FROM public.study_packs WHERE document_id = p_document_id);

    -- Delete document chunks
    DELETE FROM public.document_chunks WHERE document_id = p_document_id;

    -- Delete document pages
    DELETE FROM public.document_pages WHERE document_id = p_document_id;

    RETURN TRUE;
END;
$$;
