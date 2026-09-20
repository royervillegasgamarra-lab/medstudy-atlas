-- Migration: 20260920000000_documents_and_storage.sql
-- Description: Create documents bucket in Supabase storage with RLS, public.documents table,
-- composite foreign key for subject ownership integrity, strict least-privilege model,
-- and secure RPCs for request, finalization, and archival.

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

-- Note: storage.objects already has RLS enabled by default in Supabase.

-- Storage Policy: Users can only upload objects into their own user_id prefix
DROP POLICY IF EXISTS "Users can upload own documents to storage" ON storage.objects;
CREATE POLICY "Users can upload own documents to storage"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'documents' AND
    (name LIKE (auth.uid()::text || '/%'))
);

-- Storage Policy: Users can only read objects from their own user_id prefix
DROP POLICY IF EXISTS "Users can view own documents in storage" ON storage.objects;
CREATE POLICY "Users can view own documents in storage"
ON storage.objects
FOR SELECT
TO authenticated
USING (
    bucket_id = 'documents' AND
    (name LIKE (auth.uid()::text || '/%'))
);

-- Storage Policy: Users can only delete objects from their own user_id prefix
DROP POLICY IF EXISTS "Users can delete own documents in storage" ON storage.objects;
CREATE POLICY "Users can delete own documents in storage"
ON storage.objects
FOR DELETE
TO authenticated
USING (
    bucket_id = 'documents' AND
    (name LIKE (auth.uid()::text || '/%'))
);

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
    status TEXT NOT NULL DEFAULT 'UPLOADING' CHECK (status IN ('UPLOADING', 'VALIDATING', 'READY', 'REJECTED', 'FAILED')),
    validation_error_code TEXT,
    sha256_hash TEXT,
    finalize_token TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at TIMESTAMPTZ,
    CONSTRAINT uq_documents_storage_key UNIQUE (storage_key),
    -- Composite foreign key enforcing that documents.subject_id must be owned by documents.user_id
    CONSTRAINT fk_documents_subject_owner FOREIGN KEY (subject_id, user_id)
        REFERENCES public.subjects(id, user_id)
        ON DELETE SET NULL (subject_id)
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
-- All mutations occur via the hardened SECURITY DEFINER functions below.
REVOKE ALL ON TABLE public.documents FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.documents TO authenticated;

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
    storage_key TEXT,
    finalize_token TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_doc_id UUID;
    v_storage_key TEXT;
    v_finalize_token TEXT;
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

    -- Validate file size
    IF p_size_bytes IS NULL OR p_size_bytes <= 0 THEN
        RAISE EXCEPTION 'Invalid file size' USING ERRCODE = '22023';
    END IF;

    IF p_size_bytes > c_max_file_size THEN
        RAISE EXCEPTION 'File size exceeds maximum allowed limit (25 MB)' USING ERRCODE = '22023';
    END IF;

    -- Validate MIME type
    IF p_mime_type IS NULL OR p_mime_type != 'application/pdf' THEN
        RAISE EXCEPTION 'Only PDF files are supported' USING ERRCODE = '22023';
    END IF;

    -- Validate filename
    v_clean_filename := TRIM(COALESCE(p_original_filename, ''));
    IF LENGTH(v_clean_filename) = 0 THEN
        RAISE EXCEPTION 'Original filename cannot be empty' USING ERRCODE = '22023';
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

    -- Check active document count quota
    SELECT COUNT(*) INTO v_active_count
    FROM public.documents
    WHERE user_id = v_user_id
      AND archived_at IS NULL
      AND status IN ('UPLOADING', 'VALIDATING', 'READY');

    IF v_active_count >= c_max_active_docs THEN
        RAISE EXCEPTION 'Active document quota exceeded (maximum % documents)', c_max_active_docs USING ERRCODE = '23514';
    END IF;

    -- Check total storage quota
    SELECT COALESCE(SUM(size_bytes), 0) INTO v_total_bytes
    FROM public.documents
    WHERE user_id = v_user_id
      AND archived_at IS NULL
      AND status IN ('VALIDATING', 'READY');

    IF (v_total_bytes + p_size_bytes) > c_max_total_bytes THEN
        RAISE EXCEPTION 'Total storage quota exceeded (maximum 100 MB)' USING ERRCODE = '23514';
    END IF;

    -- Generate system-owned ID, canonical storage key, and secret finalize token
    v_doc_id := gen_random_uuid();
    v_storage_key := v_user_id::text || '/' || v_doc_id::text || '/source.pdf';
    v_finalize_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

    -- Insert document record with UPLOADING status
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
        status,
        finalize_token
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
        'UPLOADING',
        v_finalize_token
    );

    RETURN QUERY SELECT v_doc_id, 'documents'::TEXT, v_storage_key, v_finalize_token;
END;
$$;

REVOKE ALL ON FUNCTION public.request_document_upload(TEXT, BIGINT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_document_upload(TEXT, BIGINT, TEXT, UUID) TO authenticated;

-- ============================================================================
-- 4. Secure RPC: public.finalize_document_upload()
-- ============================================================================

CREATE OR REPLACE FUNCTION public.finalize_document_upload(
    p_document_id UUID,
    p_finalize_token TEXT,
    p_status TEXT,
    p_size_bytes BIGINT,
    p_sha256 TEXT DEFAULT NULL,
    p_validation_error_code TEXT DEFAULT NULL
)
RETURNS public.documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_doc public.documents;
    v_object_exists BOOLEAN;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
    END IF;

    -- Validate target status
    IF p_status NOT IN ('READY', 'REJECTED', 'FAILED') THEN
        RAISE EXCEPTION 'Invalid target status: %', p_status USING ERRCODE = '22023';
    END IF;

    -- Fetch document
    SELECT * INTO v_doc
    FROM public.documents
    WHERE id = p_document_id
      AND user_id = v_user_id;

    IF v_doc.id IS NULL THEN
        RAISE EXCEPTION 'Document not found' USING ERRCODE = '22023';
    END IF;

    -- Idempotency: If already READY and repeated call with READY, return cleanly
    IF v_doc.status = 'READY' AND p_status = 'READY' THEN
        RETURN v_doc;
    END IF;

    -- Verify finalize token
    IF v_doc.finalize_token != p_finalize_token THEN
        RAISE EXCEPTION 'Invalid finalization token' USING ERRCODE = '42501';
    END IF;

    -- If transitioning to READY, verify object exists in storage.objects
    IF p_status = 'READY' THEN
        SELECT EXISTS (
            SELECT 1 FROM storage.objects
            WHERE bucket_id = v_doc.storage_bucket
              AND name = v_doc.storage_key
        ) INTO v_object_exists;

        IF NOT v_object_exists THEN
            RAISE EXCEPTION 'Storage object does not exist for this document' USING ERRCODE = '23514';
        END IF;

        -- Verify size is valid
        IF p_size_bytes IS NULL OR p_size_bytes <= 0 THEN
            RAISE EXCEPTION 'Invalid verified size' USING ERRCODE = '22023';
        END IF;
    END IF;

    -- Update document record
    UPDATE public.documents
    SET status = p_status,
        size_bytes = COALESCE(p_size_bytes, v_doc.size_bytes),
        sha256_hash = COALESCE(p_sha256, v_doc.sha256_hash),
        validation_error_code = p_validation_error_code
    WHERE id = p_document_id
    RETURNING * INTO v_doc;

    RETURN v_doc;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_document_upload(UUID, TEXT, TEXT, BIGINT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_document_upload(UUID, TEXT, TEXT, BIGINT, TEXT, TEXT) TO authenticated;

-- ============================================================================
-- 5. Secure RPC: public.archive_document()
-- ============================================================================

CREATE OR REPLACE FUNCTION public.archive_document(
    p_document_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_rows_updated INT;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
    END IF;

    UPDATE public.documents
    SET archived_at = COALESCE(archived_at, NOW())
    WHERE id = p_document_id
      AND user_id = v_user_id;

    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

    IF v_rows_updated = 0 THEN
        RAISE EXCEPTION 'Document not found or not owned by caller' USING ERRCODE = '22023';
    END IF;

    RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_document(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_document(UUID) TO authenticated;
