-- Migration: 20260920000000_documents_and_storage.sql
-- Description: Create documents bucket in Supabase storage, public.documents table,
-- composite foreign key for subject ownership integrity, strict least-privilege model,
-- concurrency-safe quota serialization, and privileged server-only finalization RPCs.

-- ============================================================================
-- 1. Supabase Storage: Private 'documents' Bucket & Storage RLS
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'documents',
    'documents',
    false, -- Strictly PRIVATE: no public URLs
    26214400, -- 25 MB in bytes
    ARRAY['application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = 26214400,
    allowed_mime_types = ARRAY['application/pdf']::text[];

-- Note: storage.objects has RLS enabled by default in Supabase.
DROP POLICY IF EXISTS "Users can upload own documents to storage" ON storage.objects;
DROP POLICY IF EXISTS "Users can view own documents in storage" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own documents in storage" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated upload to exact reserved document" ON storage.objects;

-- ============================================================================
-- 2. Table: public.documents
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    subject_id UUID,
    original_filename TEXT NOT NULL,
    storage_provider TEXT NOT NULL DEFAULT 'supabase',
    storage_bucket TEXT NOT NULL DEFAULT 'documents',
    storage_key TEXT NOT NULL,
    mime_type TEXT NOT NULL DEFAULT 'application/pdf',
    size_bytes BIGINT NOT NULL,
    status TEXT NOT NULL DEFAULT 'UPLOADING' CHECK (status IN ('UPLOADING', 'CLEANUP_PENDING', 'READY', 'REJECTED', 'FAILED')),
    validation_error_code TEXT,
    sha256_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at TIMESTAMPTZ,
    CONSTRAINT uq_documents_storage_key UNIQUE (storage_key),
    -- Composite foreign key enforcing that documents.subject_id must be owned by documents.user_id
    CONSTRAINT fk_documents_subject_owner FOREIGN KEY (subject_id, user_id)
        REFERENCES public.subjects(id, user_id)
        ON DELETE SET NULL (subject_id),
    -- P1-2: Authoritative database input constraints
    CONSTRAINT chk_documents_filename_length CHECK (length(trim(original_filename)) > 0 AND length(trim(original_filename)) <= 255),
    CONSTRAINT chk_documents_size_positive CHECK (size_bytes > 0 AND size_bytes <= 26214400),
    CONSTRAINT chk_documents_mime_type CHECK (mime_type = 'application/pdf')
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_documents_user_active 
    ON public.documents (user_id) 
    WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_documents_subject_id 
    ON public.documents (subject_id);

-- Attach updated_at trigger
DROP TRIGGER IF EXISTS on_documents_updated ON public.documents;
CREATE TRIGGER on_documents_updated
    BEFORE UPDATE ON public.documents
    FOR EACH ROW
    EXECUTE FUNCTION private.handle_updated_at();

-- Enable Row Level Security
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

-- SELECT policy: Users can only view their own documents
DROP POLICY IF EXISTS "Users can view own documents" ON public.documents;
CREATE POLICY "Users can view own documents"
    ON public.documents
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

-- Explicit Privilege Model:
-- Revoke all direct permissions from PUBLIC, anon, and authenticated.
-- Only SELECT is granted to authenticated (guarded by RLS).
-- Direct INSERT, UPDATE, DELETE are strictly REVOKED.
-- All mutations occur via hardened SECURITY DEFINER functions below.
REVOKE ALL ON TABLE public.documents FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.documents TO authenticated;

-- ============================================================================
-- 2b. Storage RLS: Reservation-backed Storage INSERT Policy
-- Authenticated users can ONLY upload to the exact canonical storage_key
-- for which an active, unexpired UPLOADING reservation exists in public.documents.
-- Direct SELECT, UPDATE, and DELETE on storage.objects are strictly revoked/denied.
-- ============================================================================

CREATE POLICY "Allow authenticated upload to exact reserved document"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'documents'
    AND EXISTS (
        SELECT 1 FROM public.documents d
        WHERE d.user_id = auth.uid()
          AND d.storage_bucket = bucket_id
          AND d.storage_key = storage.objects.name
          AND d.status = 'UPLOADING'
          AND d.archived_at IS NULL
          AND d.created_at > (NOW() - INTERVAL '2 hours')
    )
);

-- ============================================================================
-- 3. Secure RPC: public.request_document_upload()
-- ============================================================================

CREATE OR REPLACE FUNCTION public.request_document_upload(
    p_original_filename TEXT,
    p_size_bytes BIGINT,
    p_mime_type TEXT DEFAULT 'application/pdf',
    p_subject_id UUID DEFAULT NULL
)
RETURNS TABLE (
    document_id UUID,
    storage_bucket TEXT,
    storage_key TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_doc_id UUID;
    v_storage_key TEXT;
    v_active_count INT;
    v_total_bytes BIGINT;
    v_clean_filename TEXT;
    -- Centralized quota constraints
    c_max_file_size CONSTANT BIGINT := 26214400; -- 25 MB
    c_max_active_docs CONSTANT INT := 10;
    c_max_total_bytes CONSTANT BIGINT := 104857600; -- 100 MB
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
    END IF;

    -- P1-2: Validate file size
    IF p_size_bytes IS NULL OR p_size_bytes <= 0 THEN
        RAISE EXCEPTION 'Invalid file size' USING ERRCODE = '22023';
    END IF;

    IF p_size_bytes > c_max_file_size THEN
        RAISE EXCEPTION 'File size exceeds maximum allowed limit (25 MB)' USING ERRCODE = '22023';
    END IF;

    -- P1-2: Validate MIME type
    IF p_mime_type IS NULL OR p_mime_type != 'application/pdf' THEN
        RAISE EXCEPTION 'Only PDF files are supported' USING ERRCODE = '22023';
    END IF;

    -- P1-2: Validate filename
    v_clean_filename := TRIM(COALESCE(p_original_filename, ''));
    IF LENGTH(v_clean_filename) = 0 THEN
        RAISE EXCEPTION 'Original filename cannot be empty' USING ERRCODE = '22023';
    END IF;

    IF LENGTH(v_clean_filename) > 255 THEN
        RAISE EXCEPTION 'Original filename exceeds maximum length (255 characters)' USING ERRCODE = '22023';
    END IF;

    -- Validate subject ownership if subject_id provided
    IF p_subject_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.subjects
            WHERE id = p_subject_id
              AND user_id = v_user_id
              AND archived_at IS NULL
        ) THEN
            RAISE EXCEPTION 'Subject does not exist or does not belong to user' USING ERRCODE = '23503';
        END IF;
    END IF;

    -- P0-5: Concurrency-safe quota serialization per user inside the transaction
    PERFORM pg_advisory_xact_lock(hashtext('doc_quota:' || v_user_id::text));

    -- P0: In-flight upload accounting reserves worst-case file size (25 MB)
    -- for active UPLOADING and CLEANUP_PENDING rows to prevent quota bypass.
    -- Stale rows are NOT marked FAILED here; physical cleanup occurs before release.

    -- P0-4 & P1: Check active document count quota (counts READY, UPLOADING, CLEANUP_PENDING)
    SELECT COUNT(*) INTO v_active_count
    FROM public.documents
    WHERE user_id = v_user_id
      AND archived_at IS NULL
      AND status IN ('READY', 'UPLOADING', 'CLEANUP_PENDING');

    IF v_active_count >= c_max_active_docs THEN
        RAISE EXCEPTION 'Active document quota exceeded (maximum % documents)', c_max_active_docs USING ERRCODE = '23514';
    END IF;

    -- P0: Check total storage quota reserving 25 MB worst-case for unverified in-flight uploads
    SELECT COALESCE(SUM(
        CASE
            WHEN status = 'READY' THEN size_bytes
            ELSE c_max_file_size
        END
    ), 0) INTO v_total_bytes
    FROM public.documents
    WHERE user_id = v_user_id
      AND archived_at IS NULL
      AND status IN ('READY', 'UPLOADING', 'CLEANUP_PENDING');

    IF (v_total_bytes + c_max_file_size) > c_max_total_bytes THEN
        RAISE EXCEPTION 'Total storage quota exceeded (maximum 100 MB)' USING ERRCODE = '23514';
    END IF;

    -- Generate system-owned ID and canonical storage key
    v_doc_id := gen_random_uuid();
    v_storage_key := v_user_id::text || '/' || v_doc_id::text || '/source.pdf';

    -- Insert document record with UPLOADING status and declared/reserved size
    INSERT INTO public.documents (
        id,
        user_id,
        subject_id,
        original_filename,
        storage_provider,
        storage_bucket,
        storage_key,
        mime_type,
        size_bytes,
        status
    ) VALUES (
        v_doc_id,
        v_user_id,
        p_subject_id,
        v_clean_filename,
        'supabase',
        'documents',
        v_storage_key,
        'application/pdf',
        p_size_bytes,
        'UPLOADING'
    );

    RETURN QUERY SELECT v_doc_id, 'documents'::TEXT, v_storage_key;
END;
$$;

REVOKE ALL ON FUNCTION public.request_document_upload(TEXT, BIGINT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_document_upload(TEXT, BIGINT, TEXT, UUID) TO authenticated;

-- ============================================================================
-- 4. Privileged Server-Only RPC: public.finalize_document_upload_privileged()
-- P0-1 & P0-7: Authenticated browsers CANNOT call this function directly.
-- Callable ONLY by service_role from trusted server code.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.finalize_document_upload_privileged(
    p_document_id UUID,
    p_user_id UUID,
    p_actual_size BIGINT,
    p_sha256 TEXT DEFAULT NULL
)
RETURNS public.documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_doc public.documents;
BEGIN
    -- Fetch document matching id, user_id, and active status
    SELECT * INTO v_doc
    FROM public.documents
    WHERE id = p_document_id
      AND user_id = p_user_id
      AND archived_at IS NULL;

    IF v_doc.id IS NULL THEN
        RAISE EXCEPTION 'Document not found or not active' USING ERRCODE = '22023';
    END IF;

    -- Idempotency: If already READY, return cleanly
    IF v_doc.status = 'READY' THEN
        RETURN v_doc;
    END IF;

    -- Must be in UPLOADING state
    IF v_doc.status != 'UPLOADING' THEN
        RAISE EXCEPTION 'Document is not in an uploadable state: %', v_doc.status USING ERRCODE = '22023';
    END IF;

    -- P1: Enforce upload lease window (cannot finalize expired reservation)
    IF v_doc.created_at <= (NOW() - INTERVAL '2 hours') THEN
        RAISE EXCEPTION 'Upload lease has expired' USING ERRCODE = '22023';
    END IF;

    -- P0-4: Actual storage size MUST equal the reserved/declared size
    IF v_doc.size_bytes != p_actual_size THEN
        RAISE EXCEPTION 'Actual file size (%) does not match reserved size (%)', p_actual_size, v_doc.size_bytes USING ERRCODE = '23514';
    END IF;

    -- Update document record to READY
    UPDATE public.documents
    SET status = 'READY',
        size_bytes = p_actual_size,
        sha256_hash = COALESCE(p_sha256, v_doc.sha256_hash),
        validation_error_code = NULL
    WHERE id = p_document_id
    RETURNING * INTO v_doc;

    RETURN v_doc;
END;
$$;

-- Revoke from all public/authenticated roles; grant ONLY to service_role
REVOKE ALL ON FUNCTION public.finalize_document_upload_privileged(UUID, UUID, BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_document_upload_privileged(UUID, UUID, BIGINT, TEXT) TO service_role;

-- ============================================================================
-- 5. Privileged Server-Only Cleanup RPCs:
--    public.start_document_cleanup_privileged()
--    public.complete_document_cleanup_privileged()
-- P0: Two-step cleanup lifecycle ensures Storage RLS denies upload while
-- cleanup is in-flight and quota is NOT released if Storage remove() fails.
-- Callable ONLY by service_role.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.start_document_cleanup_privileged(
    p_document_id UUID,
    p_user_id UUID
)
RETURNS public.documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_doc public.documents;
BEGIN
    SELECT * INTO v_doc
    FROM public.documents
    WHERE id = p_document_id
      AND user_id = p_user_id
      AND archived_at IS NULL;

    IF v_doc.id IS NULL THEN
        RAISE EXCEPTION 'Document not found or not owned by user' USING ERRCODE = '22023';
    END IF;

    -- Idempotent if already in CLEANUP_PENDING
    IF v_doc.status = 'CLEANUP_PENDING' THEN
        RETURN v_doc;
    END IF;

    IF v_doc.status != 'UPLOADING' THEN
        RAISE EXCEPTION 'Document is not in UPLOADING state (current status: %)', v_doc.status USING ERRCODE = '22023';
    END IF;

    UPDATE public.documents
    SET status = 'CLEANUP_PENDING'
    WHERE id = p_document_id
    RETURNING * INTO v_doc;

    RETURN v_doc;
END;
$$;

REVOKE ALL ON FUNCTION public.start_document_cleanup_privileged(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_document_cleanup_privileged(UUID, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_document_cleanup_privileged(
    p_document_id UUID,
    p_user_id UUID,
    p_status TEXT,
    p_error_code TEXT
)
RETURNS public.documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_doc public.documents;
BEGIN
    IF p_status NOT IN ('REJECTED', 'FAILED') THEN
        RAISE EXCEPTION 'Invalid target status: %', p_status USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_doc
    FROM public.documents
    WHERE id = p_document_id
      AND user_id = p_user_id;

    IF v_doc.id IS NULL THEN
        RAISE EXCEPTION 'Document not found or not owned by user' USING ERRCODE = '22023';
    END IF;

    -- Idempotent if already in target status
    IF v_doc.status = p_status THEN
        RETURN v_doc;
    END IF;

    IF v_doc.status != 'CLEANUP_PENDING' THEN
        RAISE EXCEPTION 'Document must be in CLEANUP_PENDING state (current status: %)', v_doc.status USING ERRCODE = '22023';
    END IF;

    UPDATE public.documents
    SET status = p_status,
        validation_error_code = p_error_code
    WHERE id = p_document_id
    RETURNING * INTO v_doc;

    RETURN v_doc;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_document_cleanup_privileged(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_document_cleanup_privileged(UUID, UUID, TEXT, TEXT) TO service_role;

-- ============================================================================
-- 6. Privileged Server-Only RPC: public.archive_document_privileged()
-- P0: Authenticated users CANNOT execute this RPC directly.
-- Callable ONLY by service_role after trusted server code has verified
-- user authentication, ownership, and confirmed physical Storage deletion.
-- ============================================================================

DROP FUNCTION IF EXISTS public.archive_document(UUID);

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
    v_rows_updated INT;
BEGIN
    UPDATE public.documents
    SET archived_at = COALESCE(archived_at, NOW())
    WHERE id = p_document_id
      AND user_id = p_user_id;

    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

    IF v_rows_updated = 0 THEN
        RAISE EXCEPTION 'Document not found or not owned by caller' USING ERRCODE = '22023';
    END IF;

    RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_document_privileged(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archive_document_privileged(UUID, UUID) TO service_role;
