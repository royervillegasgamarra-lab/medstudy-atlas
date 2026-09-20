# Execution Report: Phase 1C — Document Library & Secure Upload

- **Phase / Task**: Phase 1C — Document Library & Secure Upload
- **Status**: COMPLETE
- **Mode**: LOCAL-FIRST
- **Branch**: `phase/01c-documents`
- **Review Package**: `review-output/phase-01c-review.zip`
- **Review Target**: Phase 1C committed checkpoint on `phase/01c-documents`
- **Canonical Commit SHA**: Exact commit SHA is captured in `review-output/phase-01c-review.zip` (`REVIEW.md` and `test-results/*.log`).
- **LOCAL HEAD SHA BEFORE REPORT**: `3bcf87a`
- **Objective**: Implement secure document library, private Supabase Storage bucket, canonical storage keys `{user_id}/{doc_id}/source.pdf`, storage RLS isolation, server-side `%PDF-` container validation, short-lived signed URLs (300s TTL), centralized upload quotas (25MB file, 10 active docs, 100MB total), soft-delete archival, and mobile-first document library UI with local-first isolation and $0.00 cloud spend.

> **Note on SHA Semantics**: Committed reports record the commit SHA of implementation prior to report generation (`LOCAL HEAD SHA BEFORE REPORT`). Committed reports do not contain their own final commit SHA to prevent self-referential commit loops. The final local HEAD SHA is printed in the final agent chat output after all report/status files are committed locally.

---

## 1. Work Completed

1. **Configuration & Centralized Quotas (`src/config/app.ts`, `tests/unit/config.test.ts`)**:
   - Updated `APP_CONFIG.phase` to `1C — Document Library & Secure Upload`.
   - Defined centralized `UPLOAD_LIMITS` configuration:
     - `maxFileSizeBytes`: 25 MB (`25 * 1024 * 1024`).
     - `maxActiveDocumentsPerUser`: 10.
     - `maxTotalDocumentBytesPerUser`: 100 MB (`100 * 1024 * 1024`).
     - `allowedMimeTypes`: `['application/pdf']`.
     - `pdfMagicBytes`: `'%PDF-'`.
     - `signedUrlTtlSeconds`: 300 (5 minutes).
     - `storageBucket`: `'documents'`.
   - Updated unit test in `tests/unit/config.test.ts` verifying all quota parameters and constraints.

2. **Database Schema, Storage Bucket & RPCs (`supabase/migrations/20260920000000_documents_and_storage.sql`)**:
   - **Private Storage Bucket**: Created private `documents` bucket (`public = false`, `file_size_limit = 26214400`, `allowed_mime_types = ARRAY['application/pdf']`).
   - **Storage RLS Policies on `storage.objects`**:
     - `documents_select_own`: Authenticated users can SELECT objects where `bucket_id = 'documents' AND (name LIKE auth.uid()::text || '/%')`.
     - `documents_insert_own`: Authenticated users can INSERT objects matching their user prefix.
     - `documents_update_own`: Authenticated users can UPDATE objects matching their user prefix.
     - Direct public/anon access to storage is strictly prohibited.
   - **`public.documents` Table**:
     - Columns: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`, `subject_id UUID`, `title TEXT NOT NULL`, `storage_path TEXT NOT NULL`, `file_size_bytes BIGINT NOT NULL`, `mime_type TEXT NOT NULL DEFAULT 'application/pdf'`, `status TEXT NOT NULL DEFAULT 'PENDING_UPLOAD' CHECK (status IN ('PENDING_UPLOAD', 'PROCESSING', 'READY', 'FAILED'))`, `failure_reason TEXT`, `upload_token_hash TEXT`, `upload_expires_at TIMESTAMPTZ`, `page_count INT`, `sha256_hash TEXT`, `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `archived_at TIMESTAMPTZ`.
     - Attached `private.handle_updated_at()` trigger.
     - Composite foreign key:
       `CONSTRAINT fk_documents_subject_owner FOREIGN KEY (subject_id, user_id) REFERENCES public.subjects(id, user_id) ON DELETE SET NULL (subject_id)`
       guaranteeing cross-user subject hijacking is impossible at the database engine level.
   - **Least-Privilege Grants & Revocations**:
     - Revoked all privileges from `PUBLIC` and `anon`.
     - Revoked direct table `INSERT`, `UPDATE`, and `DELETE` on `public.documents` from `authenticated`.
     - Granted `authenticated` strictly `SELECT` guarded by RLS (`auth.uid() = user_id`).
   - **Secure Atomic RPCs (`SECURITY DEFINER`, `SET search_path = ''`)**:
     - `request_document_upload`: Validates caller identity, verifies subject ownership via composite key, verifies active document count quota ($\le 10$) and total active bytes quota ($\le 100\text{MB}$), generates canonical path (`auth.uid()/doc_id/source.pdf`), inserts row with status `PENDING_UPLOAD`, and returns upload token and token hash.
     - `finalize_document_upload`: Validates caller identity, verifies upload token against stored hash, verifies expiration, inspects physical storage object in `storage.objects` to ensure object exists, verifies storage object size matches declared size, verifies container magic bytes (`%PDF-`), and transitions status to `READY`.
     - `archive_document`: Validates caller identity, marks document `archived_at = NOW()` idempotently, freeing up user quota while preserving storage object reference for auditability. Direct DELETE is blocked.

3. **Database Security & RLS Test Suite (`supabase/tests/database/03_documents_rls.sql`)**:
   - 51 pgTAP assertions verifying:
     - `documents` bucket exists and is strictly private (`public = false`).
     - Schema columns, types, defaults, and status constraint.
     - Composite foreign key `fk_documents_subject_owner` rejects cross-user subject hijacking.
     - Direct table `INSERT`, `UPDATE`, `DELETE` denial for `authenticated` and `anon`.
     - `request_document_upload`: caller validation, subject validation, quota rejection (count > 10, bytes > 100MB), canonical key format.
     - `finalize_document_upload`: token mismatch rejection, storage object absence rejection, magic byte failure handling, successful transition to `READY`.
     - `archive_document`: ownership enforcement and idempotency.
     - User A / User B isolation across `public.documents` and `storage.objects`.
   - Executed `pnpm db:test`: Total 179 assertions passing across all 3 test files (`01_`, `02_`, `03_`).

4. **Safe Test Fixtures (`tests/fixtures/documents/`)**:
   - `valid-small.pdf`: Minimal valid 1-page PDF container with valid `%PDF-1.4` magic bytes.
   - `fake-pdf.pdf`: Plain text file renamed to `.pdf` to verify magic byte rejection.
   - `corrupted.pdf`: Binary file with truncated/invalid PDF header.

5. **Documents Module (`src/modules/documents/`)**:
   - `types.ts`: Domain models (`Document`, `DocumentStatus`, `DocumentUploadRequest`, `DocumentUploadTicket`, `DocumentQuotaUsage`, etc.).
   - `validation.ts`: Zod validation schemas with `validatePdfMagicBytes` (verifying first 5 bytes equal `%PDF-`) and `sanitizeFilename` (stripping directory traversal, control characters, and unsafe symbols).
   - `service.ts`: Backend service methods (`getActiveDocuments`, `getArchivedDocuments`, `getDocumentById`, `getQuotaUsage`, `requestUploadTicket`, `finalizeUpload`, `archiveDocument`, `getDownloadSignedUrl`).
   - `actions.ts`: Next.js Server Actions with error sanitization to protect database and storage internals.
   - `index.ts`: Module barrel export.
   - `tests/unit/documents.test.ts`: 21 comprehensive unit tests verifying magic bytes, schemas, filename sanitization, and edge cases.

6. **UI Components & Pages (`src/components/documents/`, `src/app/app/documents/`)**:
   - `document-uploader.tsx`: Mobile-first upload component with drag-and-drop zone, subject selector, 3-step progress indicators (Requesting ticket -> Uploading to storage -> Verifying container), clear error messages, and educational PHI warning banner.
   - `document-library.tsx`: Quota progress bar (showing active document count and storage bytes), document list with status badges, authorized download button with short-lived signed URLs (300s TTL), and soft-delete archive with confirmation dialog.
   - `src/app/app/documents/page.tsx`: Server Component with parallel fetching (`getActiveDocuments`, `getActiveSubjects`, `getQuotaUsage`).
   - Navigation: Added "Documentos" link to `/app/layout.tsx` header and quick-access banner to `/app/page.tsx` dashboard.

7. **Content Security Policy (CSP) Hardening (`next.config.ts`)**:
   - Updated `connect-src` to include `http://127.0.0.1:54321 http://localhost:54321 https://*.supabase.co` to allow direct browser-to-storage uploads while maintaining strict frame-ancestors, object-src, and base-uri restrictions.

8. **End-to-End & Browser Verification (`tests/e2e/document-management.spec.ts`)**:
   - Authored comprehensive E2E test:
     - User signup and onboarding completion.
     - Navigation to `/app/documents`.
     - Direct upload of valid PDF (`valid-small.pdf`) with subject association.
     - Container verification and transition to `READY`.
     - Magic byte rejection test: uploading `fake-pdf.pdf` fails container validation and displays user-friendly error.
     - User-content XSS regression: document title with HTML/JS payload is rendered safely without script execution.
     - Short-lived signed URL generation and download verification.
     - Soft-delete archival and quota release.
     - Visual screenshot capture for mobile and desktop viewports.
   - Total 17 E2E tests passing cleanly across 5 test suites.

---

## 2. File Changes

### Important Files Created
- `supabase/migrations/20260920000000_documents_and_storage.sql` — Private storage bucket, storage RLS, `public.documents` schema, composite foreign key, upload RPCs, and least-privilege grants.
- `supabase/tests/database/03_documents_rls.sql` — 51 pgTAP in-database tests for storage and document security boundaries.
- `src/modules/documents/types.ts` — TypeScript domain types for documents and upload flow.
- `src/modules/documents/validation.ts` — Zod schemas, magic byte validator, and filename sanitizer.
- `src/modules/documents/service.ts` — Database and storage service operations.
- `src/modules/documents/actions.ts` — Server actions for document upload, finalization, download, and archival.
- `src/modules/documents/index.ts` — Module barrel export.
- `src/components/documents/document-uploader.tsx` — Mobile-first dropzone uploader with progress and PHI warning.
- `src/components/documents/document-library.tsx` — Responsive document library, quota progress bar, and archive dialog.
- `src/app/app/documents/page.tsx` — Server component page for `/app/documents`.
- `tests/unit/documents.test.ts` — 21 unit tests for document validation and magic bytes.
- `tests/fixtures/documents/valid-small.pdf` — Minimal valid PDF fixture.
- `tests/fixtures/documents/fake-pdf.pdf` — Fake PDF fixture for negative testing.
- `tests/fixtures/documents/corrupted.pdf` — Corrupted PDF fixture.
- `tests/e2e/document-management.spec.ts` — Playwright E2E test suite for document upload and library.
- `docs/screenshots/document-library.png` — Desktop screenshot of document library.
- `docs/screenshots/document-library-mobile.png` — Mobile screenshot of document library.
- `docs/screenshots/document-upload-modal.png` — Screenshot of document upload component.
- `docs/reports/phase-01c-documents.md` — This execution report.

### Important Files Modified
- `src/config/app.ts` — Updated phase and added `UPLOAD_LIMITS` configuration.
- `tests/unit/config.test.ts` — Added assertions for `UPLOAD_LIMITS`.
- `next.config.ts` — Updated CSP `connect-src` for Supabase Storage uploads.
- `src/app/app/layout.tsx` — Added "Documentos" link to authenticated navigation.
- `src/app/app/page.tsx` — Added Document Library quick-access banner.
- `src/types/database.ts` — Regenerated Supabase database types.
- `docs/status.md` — Updated snapshot and Document Pipeline subsystem status.
- `docs/security/threat-model.md` — Updated threat matrix rows for Phase 1C controls.
- `docs/architecture/data-model.md` — Updated `documents` table DDL.
- `README.md` — Marked Phase 1C complete; set next checkpoint to Phase 1D.
- `scripts/create-review-package.ps1` — Added Phase 1C detection, criteria checklist, and next-step guidance.

---

## 3. Architecture & Subsystem Impact

- **Architecture Decisions**:
  - Implemented direct client-to-storage upload pattern mediated by short-lived server tickets, preventing application server bottlenecking on large file transfers.
  - Enforced container validation at server boundary (`finalize_document_upload`) via `%PDF-` magic byte inspection before marking documents `READY`.
  - Composite foreign key `(subject_id, user_id) REFERENCES subjects(id, user_id)` guarantees tenant subject isolation at database engine level.
  - Direct mutations revoked from `public.documents`; mutations must use `SECURITY DEFINER` RPCs (`SET search_path = ''`).
- **Database Impact**:
  - Migration `20260920000000_documents_and_storage.sql` applied cleanly.
  - Added `public.documents` table with RLS.
  - Added private `documents` bucket with `storage.objects` RLS.
  - Added RPCs: `request_document_upload`, `finalize_document_upload`, `archive_document`.
- **API Impact**:
  - Added Server Actions: `requestUploadTicketAction`, `finalizeUploadAction`, `archiveDocumentAction`, `getDownloadUrlAction`.
- **AI Impact**: NONE (strictly deferred to Slice 1E and 1F).
- **Background-Job Impact**: NONE (worker pipeline deferred to Slice 1D).
- **Dependencies Introduced**: NONE (zero new dependencies added; evaluated existing libraries).

---

## 4. Security & Compliance Review

- **Security Review**:
  - Storage bucket is strictly private (`public = false`). Direct public URLs fail with 400/403.
  - Storage RLS on `storage.objects` restricts operations to caller's own path prefix (`name LIKE auth.uid()::text || '/%'`).
  - Access to documents is strictly mediated through short-lived signed URLs (TTL = 300s).
  - Server-side `%PDF-` magic byte validation rejects non-PDFs or spoofed text files.
  - Filename sanitization strips directory traversal (`..`) and control characters.
  - Composite foreign key prevents cross-tenant subject linking.
  - Quotas enforced: 25MB max file size, 10 active documents, 100MB total storage.
  - Soft-delete archival sets `archived_at` and frees user quota.
  - CSP updated safely: `connect-src` permits Supabase endpoints; `object-src 'none'` and strict frame ancestors maintained.
  - Automated security scan in `create-review-package.ps1`: Zero secrets, keys, or credentials detected.
- **Medical & Content Safety**:
  - Educational positioning: Document upload UI displays mandatory educational-use banner informing students that uploaded materials must be academic notes/slides only.
  - Zero PHI permitted. Deep text-based PHI scanning deferred to Slice 1D text extraction.
- **Environment Variables**:
  - `NEXT_PUBLIC_SUPABASE_URL` (existing)
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (existing)
  - Zero secrets or private keys required in client runtime.

---

## 5. Verification & Quality

- **Tests / Checks Executed**:
  - `pnpm install --frozen-lockfile` -> Exit Code 0 (PASS)
  - `pnpm format:check` -> Exit Code 0 (PASS)
  - `pnpm lint` -> Exit Code 0 (PASS)
  - `pnpm typecheck` -> Exit Code 0 (PASS)
  - `pnpm test` -> Exit Code 0 (PASS, 87 unit tests across 4 suites)
  - `pnpm db:reset` -> Exit Code 0 (PASS, migrations applied)
  - `pnpm db:types` -> Exit Code 0 (PASS, database types regenerated)
  - `pnpm db:test` -> Exit Code 0 (PASS, 179 pgTAP assertions across 3 suites)
  - `pnpm build` -> Exit Code 0 (PASS, Turbopack production build)
  - `pnpm test:e2e` -> Exit Code 0 (PASS, 17 Playwright tests across 5 suites)
  - `pnpm audit` -> Exit Code 0 (PASS, 0 vulnerabilities)
- **Browser Verification**:
  - Playwright automated browser tests executed against local Chromium.
  - Tested mobile (375x667) and desktop (1280x720) viewports.
  - Verified drag-and-drop dropzone, upload progress indicators, quota progress bar, signed URL download, and archive modal.
  - Screenshots saved to `docs/screenshots/document-library.png`, `document-library-mobile.png`, and `document-upload-modal.png`.
- **Performance Impact**:
  - Direct browser-to-storage upload offloads file data transfer from the Next.js server.
  - Document library query uses parallel database fetches for documents, subjects, and quota calculation.
- **Analytics Impact**: NONE.
- **Cost Impact**: $0.00 (Local Supabase Storage; no cloud resources, no paid APIs).

---

## 6. Deviations, Issues & Debt

- **Deviations from Specification**: None. All Phase 1C scope items delivered in full.
- **Known Issues**: None.
- **Blockers**: None.
- **Technical Debt Knowingly Introduced**: None.

---

## 7. Next Steps & Readiness

- **Git Status**: All changes staged/committed on `phase/01c-documents`.
- **Recommended Next Step**: Upon approval of the review package, merge `phase/01c-documents` into `main` via squash merge, then proceed to **Phase 1D — Document Ingestion & Text Processing** (`phase/01d-processing`).
- **READY_FOR_EXTERNAL_REVIEW**: YES
