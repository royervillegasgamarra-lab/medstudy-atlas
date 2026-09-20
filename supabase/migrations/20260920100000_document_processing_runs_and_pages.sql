-- Migration: 20260920100000_document_processing_runs_and_pages.sql
-- Description: Phase 1D: Document Processing Runs & Normalized Pages with Provenance
-- Strict least-privilege model, composite ownership invariants, FOR UPDATE SKIP LOCKED job claim,
-- and atomic privileged persistence.

-- ============================================================================
-- 1. Prerequisites: Add Composite Unique Constraint to documents
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'uq_documents_id_user_id'
          AND conrelid = 'public.documents'::regclass
    ) THEN
        ALTER TABLE public.documents
            ADD CONSTRAINT uq_documents_id_user_id UNIQUE (id, user_id);
    END IF;
END $$;

-- ============================================================================
-- 2. Table: public.document_processing_runs
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.document_processing_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL,
    user_id UUID NOT NULL,
    pipeline_version TEXT NOT NULL DEFAULT '1.0.0',
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED_RETRYABLE', 'FAILED_FINAL')),
    attempt_count INT NOT NULL DEFAULT 0,
    error_code TEXT,
    page_count INT,
    native_text_page_count INT NOT NULL DEFAULT 0,
    ocr_page_count INT NOT NULL DEFAULT 0,
    no_text_page_count INT NOT NULL DEFAULT 0,
    source_sha256 TEXT,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_processing_runs_doc_version UNIQUE (document_id, pipeline_version),
    CONSTRAINT fk_processing_runs_document_owner FOREIGN KEY (document_id, user_id)
        REFERENCES public.documents(id, user_id)
        ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_processing_runs_user ON public.document_processing_runs(user_id);
CREATE INDEX IF NOT EXISTS idx_processing_runs_status ON public.document_processing_runs(status);
CREATE INDEX IF NOT EXISTS idx_processing_runs_doc ON public.document_processing_runs(document_id);

-- Attach updated_at trigger
DROP TRIGGER IF EXISTS on_document_processing_runs_updated ON public.document_processing_runs;
CREATE TRIGGER on_document_processing_runs_updated
    BEFORE UPDATE ON public.document_processing_runs
    FOR EACH ROW
    EXECUTE FUNCTION private.handle_updated_at();

-- Enable Row Level Security
ALTER TABLE public.document_processing_runs ENABLE ROW LEVEL SECURITY;

-- SELECT policy: Users can only view their own processing runs
DROP POLICY IF EXISTS "Users can view own processing runs" ON public.document_processing_runs;
CREATE POLICY "Users can view own processing runs"
    ON public.document_processing_runs
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

-- Strict Privilege Model:
-- Revoke all direct mutations from PUBLIC, anon, and authenticated.
-- Only SELECT is granted to authenticated.
REVOKE ALL ON TABLE public.document_processing_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.document_processing_runs TO authenticated;

-- ============================================================================
-- 3. Table: public.document_pages
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.document_pages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    processing_run_id UUID NOT NULL REFERENCES public.document_processing_runs(id) ON DELETE CASCADE,
    document_id UUID NOT NULL,
    user_id UUID NOT NULL,
    page_number INT NOT NULL CHECK (page_number > 0),
    classification TEXT NOT NULL CHECK (classification IN ('TEXT_BASED', 'SCANNED', 'MIXED', 'IMAGE_ONLY', 'NO_TEXT')),
    extraction_method TEXT NOT NULL CHECK (extraction_method IN ('NATIVE', 'OCR', 'HYBRID', 'NONE')),
    text_content TEXT NOT NULL DEFAULT '',
    char_count INT NOT NULL DEFAULT 0,
    native_char_count INT NOT NULL DEFAULT 0,
    ocr_char_count INT NOT NULL DEFAULT 0,
    ocr_confidence NUMERIC(5, 2),
    width_points NUMERIC(8, 2) NOT NULL,
    height_points NUMERIC(8, 2) NOT NULL,
    rotation_degrees INT NOT NULL DEFAULT 0,
    text_sha256 TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_document_pages_run_page UNIQUE (processing_run_id, page_number),
    CONSTRAINT fk_document_pages_doc_owner FOREIGN KEY (document_id, user_id)
        REFERENCES public.documents(id, user_id)
        ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_document_pages_doc_page ON public.document_pages(document_id, page_number);
CREATE INDEX IF NOT EXISTS idx_document_pages_run ON public.document_pages(processing_run_id);
CREATE INDEX IF NOT EXISTS idx_document_pages_user ON public.document_pages(user_id);

-- Enable Row Level Security
ALTER TABLE public.document_pages ENABLE ROW LEVEL SECURITY;

-- SELECT policy: Users can only view their own document pages
DROP POLICY IF EXISTS "Users can view own document pages" ON public.document_pages;
CREATE POLICY "Users can view own document pages"
    ON public.document_pages
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

-- Strict Privilege Model:
REVOKE ALL ON TABLE public.document_pages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.document_pages TO authenticated;

-- ============================================================================
-- 4. Privileged Function: public.enqueue_document_processing_privileged()
-- Callable strictly by service_role
-- ============================================================================

CREATE OR REPLACE FUNCTION public.enqueue_document_processing_privileged(
    p_document_id UUID,
    p_user_id UUID,
    p_pipeline_version TEXT DEFAULT '1.0.0'
)
RETURNS TABLE (
    run_id UUID,
    document_id UUID,
    user_id UUID,
    pipeline_version TEXT,
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
BEGIN
    -- Verify document is READY and owned by user
    SELECT * INTO v_doc
    FROM public.documents d
    WHERE d.id = p_document_id
      AND d.user_id = p_user_id
      AND d.archived_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Document not found, not owned by user, or archived'
            USING ERRCODE = '22023';
    END IF;

    IF v_doc.status != 'READY' THEN
        RAISE EXCEPTION 'Document is not in READY status'
            USING ERRCODE = '22023';
    END IF;

    -- Upsert processing run
    INSERT INTO public.document_processing_runs (
        document_id,
        user_id,
        pipeline_version,
        status,
        attempt_count,
        error_code
    )
    VALUES (
        p_document_id,
        p_user_id,
        p_pipeline_version,
        'PENDING',
        0,
        NULL
    )
    ON CONFLICT (document_id, pipeline_version) DO UPDATE
    SET status = CASE
            WHEN public.document_processing_runs.status IN ('FAILED_RETRYABLE', 'FAILED_FINAL')
            THEN 'PENDING'
            ELSE public.document_processing_runs.status
        END,
        error_code = CASE
            WHEN public.document_processing_runs.status IN ('FAILED_RETRYABLE', 'FAILED_FINAL')
            THEN NULL
            ELSE public.document_processing_runs.error_code
        END,
        updated_at = NOW()
    RETURNING
        public.document_processing_runs.id,
        public.document_processing_runs.document_id,
        public.document_processing_runs.user_id,
        public.document_processing_runs.pipeline_version,
        public.document_processing_runs.status,
        public.document_processing_runs.attempt_count
    INTO v_run;

    RETURN QUERY
    SELECT v_run.id, v_run.document_id, v_run.user_id, v_run.pipeline_version, v_run.status, v_run.attempt_count;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_document_processing_privileged(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_document_processing_privileged(UUID, UUID, TEXT) TO service_role;

-- ============================================================================
-- 5. Privileged Function: public.claim_next_processing_run()
-- Uses FOR UPDATE SKIP LOCKED for single-worker ownership and lease recovery
-- Callable strictly by service_role
-- ============================================================================

CREATE OR REPLACE FUNCTION public.claim_next_processing_run(
    p_worker_id TEXT,
    p_lease_seconds INT DEFAULT 300
)
RETURNS TABLE (
    run_id UUID,
    document_id UUID,
    user_id UUID,
    pipeline_version TEXT,
    attempt_count INT,
    storage_bucket TEXT,
    storage_key TEXT,
    size_bytes BIGINT,
    original_filename TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
    v_run_id UUID;
BEGIN
    -- Select one candidate run with lock
    SELECT r.id INTO v_run_id
    FROM public.document_processing_runs r
    WHERE (
        r.status = 'PENDING'
        OR (r.status = 'FAILED_RETRYABLE' AND r.attempt_count < 3)
        OR (r.status = 'RUNNING' AND r.updated_at < (NOW() - (p_lease_seconds || ' seconds')::interval))
    )
    ORDER BY r.created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF v_run_id IS NULL THEN
        RETURN;
    END IF;

    -- Update run status to RUNNING
    UPDATE public.document_processing_runs pr
    SET status = 'RUNNING',
        attempt_count = pr.attempt_count + 1,
        started_at = COALESCE(pr.started_at, NOW()),
        updated_at = NOW()
    WHERE pr.id = v_run_id;

    -- Return claimed run details joined with document metadata
    RETURN QUERY
    SELECT
        r.id AS run_id,
        r.document_id,
        r.user_id,
        r.pipeline_version,
        r.attempt_count,
        d.storage_bucket,
        d.storage_key,
        d.size_bytes,
        d.original_filename
    FROM public.document_processing_runs r
    JOIN public.documents d ON d.id = r.document_id
    WHERE r.id = v_run_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_processing_run(TEXT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_processing_run(TEXT, INT) TO service_role;

-- ============================================================================
-- 6. Privileged Function: public.persist_processing_run_results_privileged()
-- Atomic persistence of all page records and transition to SUCCEEDED
-- Callable strictly by service_role
-- ============================================================================

CREATE OR REPLACE FUNCTION public.persist_processing_run_results_privileged(
    p_run_id UUID,
    p_manifest JSONB,
    p_pages JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_run RECORD;
    v_page RECORD;
    v_page_count INT;
    v_persisted_count INT;
BEGIN
    -- Lock and verify the processing run
    SELECT * INTO v_run
    FROM public.document_processing_runs
    WHERE id = p_run_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Processing run not found: %', p_run_id
            USING ERRCODE = '22023';
    END IF;

    IF v_run.status != 'RUNNING' THEN
        RAISE EXCEPTION 'Processing run is not in RUNNING status (current: %)', v_run.status
            USING ERRCODE = '22023';
    END IF;

    v_page_count := (p_manifest->>'page_count')::INT;

    -- Insert or update each page record
    FOR v_page IN SELECT * FROM jsonb_to_recordset(p_pages) AS (
        page_number INT,
        classification TEXT,
        extraction_method TEXT,
        text_content TEXT,
        char_count INT,
        native_char_count INT,
        ocr_char_count INT,
        ocr_confidence NUMERIC(5, 2),
        width_points NUMERIC(8, 2),
        height_points NUMERIC(8, 2),
        rotation_degrees INT,
        text_sha256 TEXT
    )
    LOOP
        INSERT INTO public.document_pages (
            processing_run_id,
            document_id,
            user_id,
            page_number,
            classification,
            extraction_method,
            text_content,
            char_count,
            native_char_count,
            ocr_char_count,
            ocr_confidence,
            width_points,
            height_points,
            rotation_degrees,
            text_sha256
        )
        VALUES (
            p_run_id,
            v_run.document_id,
            v_run.user_id,
            v_page.page_number,
            v_page.classification,
            v_page.extraction_method,
            COALESCE(v_page.text_content, ''),
            COALESCE(v_page.char_count, 0),
            COALESCE(v_page.native_char_count, 0),
            COALESCE(v_page.ocr_char_count, 0),
            v_page.ocr_confidence,
            v_page.width_points,
            v_page.height_points,
            COALESCE(v_page.rotation_degrees, 0),
            v_page.text_sha256
        )
        ON CONFLICT (processing_run_id, page_number) DO UPDATE
        SET classification = EXCLUDED.classification,
            extraction_method = EXCLUDED.extraction_method,
            text_content = EXCLUDED.text_content,
            char_count = EXCLUDED.char_count,
            native_char_count = EXCLUDED.native_char_count,
            ocr_char_count = EXCLUDED.ocr_char_count,
            ocr_confidence = EXCLUDED.ocr_confidence,
            width_points = EXCLUDED.width_points,
            height_points = EXCLUDED.height_points,
            rotation_degrees = EXCLUDED.rotation_degrees,
            text_sha256 = EXCLUDED.text_sha256;
    END LOOP;

    -- Verify page count matches
    SELECT COUNT(*) INTO v_persisted_count
    FROM public.document_pages
    WHERE processing_run_id = p_run_id;

    IF v_persisted_count != v_page_count THEN
        RAISE EXCEPTION 'Page count mismatch: expected %, got %', v_page_count, v_persisted_count
            USING ERRCODE = '22023';
    END IF;

    -- Update the run to SUCCEEDED
    UPDATE public.document_processing_runs
    SET status = 'SUCCEEDED',
        page_count = v_page_count,
        native_text_page_count = COALESCE((p_manifest->>'native_text_page_count')::INT, 0),
        ocr_page_count = COALESCE((p_manifest->>'ocr_page_count')::INT, 0),
        no_text_page_count = COALESCE((p_manifest->>'no_text_page_count')::INT, 0),
        source_sha256 = p_manifest->>'source_sha256',
        error_code = NULL,
        finished_at = NOW(),
        updated_at = NOW()
    WHERE id = p_run_id;

    RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.persist_processing_run_results_privileged(UUID, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_processing_run_results_privileged(UUID, JSONB, JSONB) TO service_role;

-- ============================================================================
-- 7. Privileged Function: public.fail_processing_run_privileged()
-- Callable strictly by service_role
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fail_processing_run_privileged(
    p_run_id UUID,
    p_error_code TEXT,
    p_retryable BOOLEAN DEFAULT FALSE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_run RECORD;
    v_next_status TEXT;
BEGIN
    SELECT * INTO v_run
    FROM public.document_processing_runs
    WHERE id = p_run_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Processing run not found: %', p_run_id
            USING ERRCODE = '22023';
    END IF;

    IF p_retryable AND v_run.attempt_count < 3 THEN
        v_next_status := 'FAILED_RETRYABLE';
    ELSE
        v_next_status := 'FAILED_FINAL';
    END IF;

    UPDATE public.document_processing_runs
    SET status = v_next_status,
        error_code = p_error_code,
        finished_at = NOW(),
        updated_at = NOW()
    WHERE id = p_run_id;

    RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.fail_processing_run_privileged(UUID, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_processing_run_privileged(UUID, TEXT, BOOLEAN) TO service_role;
