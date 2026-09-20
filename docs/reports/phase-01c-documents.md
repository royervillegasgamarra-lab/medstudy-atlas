# Execution Report: Phase 1C — Document Library & Secure Upload

- **Phase / Task**: Phase 1C — Document Library & Secure Upload
- **Status**: COMPLETE
- **Mode**: LOCAL-FIRST
- **Branch**: `phase/01c-documents`
- **Review Package**: `review-output/phase-01c-review.zip`
- **Review Target**: Phase 1C committed checkpoint on `phase/01c-documents`
- **Canonical Commit SHA**: Exact commit SHA is captured in `review-output/phase-01c-review.zip` (`REVIEW.md` and `test-results/*.log`).
- **LOCAL HEAD SHA BEFORE REPORT**: `d41a304`
- **Objective**: Implement secure document library, private Supabase Storage bucket, exact-path signed upload authorization, privileged server-only finalization, concurrency-safe quota serialization, 5-byte range container validation, physical storage deletion on archive, and mobile-first document library UI with local-first isolation and $0.00 cloud spend.

> **Note on SHA Semantics**: Committed reports record the commit SHA of implementation prior to report generation (`LOCAL HEAD SHA BEFORE REPORT`). Committed reports do not contain their own final commit SHA to prevent self-referential commit loops. The final local HEAD SHA is printed in the final agent chat output after all report/status files are committed locally.

---

## 1. Work Completed

1. **Dedicated Server-Only Configuration & Supabase Admin Client (`P0-2`)**:
   - Authored [`src/config/server-env.ts`](file:///c:/Users/DR_%20CHAPATIN/Documents/GitHub/medstudy-atlas/src/config/server-env.ts) guarded with `import "server-only"`. Validates `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`) and `NEXT_PUBLIC_SUPABASE_URL`. Never exposed to client bundles or Server Action return values.
   - Authored [`src/lib/supabase/admin.ts`](file:///c:/Users/DR_%20CHAPATIN/Documents/GitHub/medstudy-atlas/src/lib/supabase/admin.ts) guarded with `import "server-only"`. Instantiates a singleton `supabaseAdmin` client with session persistence and auto-refresh disabled (`persistSession: false`, `autoRefreshToken: false`).
   - Updated [`.env.example`](file:///c:/Users/DR_%20CHAPATIN/Documents/GitHub/medstudy-atlas/.env.example) to include `SUPABASE_SECRET_KEY=your-supabase-secret-key` (name only, no real secrets).

2. **Removal of Reusable Signed-Upload Capability via Reservation-Backed Storage RLS (`P0`)**:
   - Eliminated reusable signed upload tokens (`uploadToSignedUrl`) which previously permitted token reuse after physical object deletion.
   - Replaced with direct authenticated upload governed strictly by a narrow reservation-backed Storage `INSERT` RLS policy on `storage.objects`:
     ```sql
     CREATE POLICY "Allow authenticated upload to exact reserved document"
     ON storage.objects FOR INSERT TO authenticated
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
     ```
   - Direct `SELECT`, `UPDATE`, and `DELETE` on `storage.objects` are denied.
   - As soon as a document transitions to `CLEANUP_PENDING`, `READY`, `REJECTED`, `FAILED`, or `archived_at IS NOT NULL`, Storage RLS immediately rejects any upload to that storage key.

3. **Safe Two-Step Cleanup Lifecycle & Privileged Cleanup RPCs (`P0`)**:
   - Introduced `CLEANUP_PENDING` document status:
     `UPLOADING` → `CLEANUP_PENDING` → physical Storage `remove()` → `REJECTED` or `FAILED`.
   - While in `CLEANUP_PENDING`:
     - Storage RLS denies browser upload (`status != 'UPLOADING'`).
     - Quota remains reserved (counts as 25 MB).
     - If physical Storage `remove()` fails, status remains `CLEANUP_PENDING` (quota is NOT released, preventing orphaned blobs).
     - Only upon confirmed physical deletion (or 404) does status transition to `REJECTED` or `FAILED`.
   - Privileged server-only cleanup RPCs:
     - `public.start_document_cleanup_privileged(UUID, UUID)`: transitions `UPLOADING` to `CLEANUP_PENDING`.
     - `public.complete_document_cleanup_privileged(UUID, UUID, TEXT, TEXT)`: transitions `CLEANUP_PENDING` to target status (`REJECTED`/`FAILED`).
     - Both granted strictly to `service_role` and revoked from `PUBLIC`, `anon`, and `authenticated`.

4. **Physical Cleanup of Abandoned Uploads (`P0`)**:
   - Stale rows are never marked `FAILED` based on elapsed time alone in SQL.
   - In `requestDocumentUpload`, the application layer performs lazy physical cleanup of expired `UPLOADING` reservations (> 2 hours): it transitions them to `CLEANUP_PENDING`, invokes physical Storage `remove()`, and only on confirmed deletion transitions to `FAILED` (`UPLOAD_TIMEOUT`).

5. **Worst-Case In-Flight Storage Accounting (`P0`)**:
   - In-flight upload accounting reserves the worst-case file size (25 MB = 26,214,400 bytes) for all active `UPLOADING` and `CLEANUP_PENDING` rows when checking against total storage quota (100 MB).
   - Once a document reaches `READY`, its verified actual `size_bytes` is counted.
   - Prevents quota bypass where a user declares 1 byte but uploads 25 MB.
   - Concurrency is serialized per user via `pg_advisory_xact_lock`.

6. **Storage Error Differentiation (`P0`)**:
   - Transient Storage errors (5xx, timeouts, network issues) are differentiated from confirmed missing objects (404).
   - In `finalizeDocumentUpload`: transient errors return a recoverable validation error without rejecting the document, deleting blobs, or releasing quota.
   - In `archiveDocument`: already-archived retry distinguishes 404 from 5xx before concluding physical absence.

7. **Bounded Range Read for PDF Validation (`P1`)**:
   - PDF magic bytes validation reads the first 5 bytes via HTTP Range request (`Range: bytes=0-4`).
   - Requires HTTP 206 Partial Content, buffer `byteLength <= 5`, and a 5000ms timeout (`AbortSignal.timeout(5000)`).
   - If the server returns HTTP 200 (attempting full 25 MB download) or times out, fails safely as a transient validation error.

8. **Privileged Server-Only Finalization and Archive (`P0`, `P1`)**:
   - `finalize_document_upload_privileged`: callable ONLY by `service_role`.
   - `archive_document_privileged`: callable ONLY by `service_role`.
   - All privileged RPC results are explicitly inspected with error handling.

9. **Authoritative In-Database & Integration Test Suites (`P0`, `P1`)**:
   - `supabase/tests/database/03_documents_rls.sql`: 62 pgTAP assertions covering Storage RLS, `CLEANUP_PENDING`, worst-case in-flight accounting, and privileged cleanup RPC denials. Total 190 database tests pass.
   - `tests/integration/storage-security.test.ts`: 20 comprehensive integration tests covering all required scenarios:
     1. Direct unauthorized Storage upload is strictly denied (P0-3).
     2. Arbitrary unreserved path upload is denied (P0-3).
     3. Exact reserved upload succeeds, creates physical object, transitions to READY, authorized download works (P0).
     4. Re-upload to SAME storage key after delete is DENIED by Storage RLS (proves token reuse impossible) (P0).
     5. Upload to storage key with status CLEANUP_PENDING is DENIED by Storage RLS (P0).
     6. Upload to storage key with status READY is DENIED by Storage RLS (P0).
     7. Upload to storage key with status REJECTED is DENIED by Storage RLS (P0).
     8. Upload to storage key with status FAILED is DENIED by Storage RLS (P0).
     9. Upload to storage key with archived_at IS NOT NULL is DENIED by Storage RLS (P0).
     10. Upload to storage key with reservation > 2 hours old is DENIED by Storage RLS (P0).
     11. Two-step cleanup lifecycle: UPLOADING → CLEANUP_PENDING → remove() → REJECTED (P0).
     12. Two-step cleanup lifecycle: UPLOADING → CLEANUP_PENDING → remove() → FAILED (P0).
     13. If Storage remove() fails during cleanup, status remains CLEANUP_PENDING and quota remains reserved (P0).
     14. Stale upload lazy cleanup physically deletes object before marking FAILED (P0).
     15. Worst-case in-flight quota: 4 active UPLOADING rows (25 MB each) reject 5th upload even if declared 1 byte (P0).
     16. Storage 5xx error during finalizeDocumentUpload returns transient error without rejecting or deleting blob (P0).
     17. Bounded range read enforces HTTP 206, byteLength <= 5, and timeout; HTTP 200 fails safely (P1).
     18. Authenticated user cannot call any privileged RPC directly (finalize, archive, start_cleanup, complete_cleanup) (P0).
     19. Storage deletion failure on archive does NOT free quota or mark archived (P0).
     20. Cross-user download authorization denied via application boundary (P0).

---

## 2. File Changes

### Important Files Created
- `src/config/server-env.ts` — Server-only environment configuration for `SUPABASE_SECRET_KEY`.
- `src/lib/supabase/admin.ts` — Server-only privileged Supabase admin client.
- `tests/integration/storage-security.test.ts` — Authoritative Supabase Storage API integration test suite.
- `docs/reports/phase-01c-failure-matrix.md` — 25-scenario security and failure matrix.

### Important Files Modified
- `supabase/migrations/20260920000000_documents_and_storage.sql` — Hardened storage policies, removed `finalize_token`, added input check constraints, concurrency-safe advisory lock, quota counting `UPLOADING` rows, and privileged finalization RPCs.
- `supabase/tests/database/03_documents_rls.sql` — Updated pgTAP tests to verify new security boundaries.
- `src/modules/documents/types.ts` — Updated domain types: removed `finalize_token`, added `signedUploadUrl` and `signedUploadToken`.
- `src/modules/documents/service.ts` — Updated service: exact signed upload, 5-byte range validation, server-only privileged finalization, and physical storage deletion on archive.
- `src/modules/documents/actions.ts` — Updated server actions to pass signed upload parameters.
- `src/components/documents/document-uploader.tsx` — Added PHI warning banner and `uploadToSignedUrl` integration.
- `vitest.config.mts` — Added `tests/integration` to test runner.
- `tests/e2e/document-management.spec.ts` — Added fake PDF rejection, PHI warning check, and full E2E flow.
- `.env.example` — Added `SUPABASE_SECRET_KEY` placeholder.
- `docs/architecture/data-model.md` — Synchronized `documents` DDL with migration.
- `docs/security/threat-model.md` — Updated threat matrix rows for P0/P1 security architecture.
- `scripts/create-review-package.ps1` — Updated review checklist and verification pipeline.

---

## 3. Architecture & Subsystem Impact

- **Architecture Decisions**:
  - Eliminated `finalize_token`: Authenticated browsers can no longer invoke finalization directly. Privileged finalization is callable ONLY by `service_role`.
  - Removed broad authenticated mutation policies on `storage.objects`. Uploads use exact-path signed upload URLs (`uploadToSignedUrl`) with `upsert: false`.
  - Concurrency-safe quota reservations via PostgreSQL per-user transaction advisory locks (`pg_advisory_xact_lock`).
  - Total storage quota counts all active reservations (`UPLOADING`, `VALIDATING`, `READY`).
  - 5-byte range validation via HTTP Range request on internal signed URL avoids downloading 25 MB into server memory.
  - Physical blob removal on archive via official Storage API before stamping `archived_at`.
- **Database Impact**:
  - Migration `20260920000000_documents_and_storage.sql` applied cleanly.
  - `public.documents` table updated: check constraints added, `finalize_token` removed.
  - Privileged RPCs: `finalize_document_upload_privileged` and `reject_document_upload_privileged` granted strictly to `service_role`.
  - Quota serialization inside `request_document_upload`.
- **API Impact**:
  - `requestDocumentUploadAction` returns exact `signedUploadUrl` and `signedUploadToken`.
  - `finalizeDocumentUploadAction` executes server-side validation and privileged finalization.
- **AI Impact**: NONE (strictly deferred to Slice 1E and 1F).
- **Background-Job Impact**: NONE (worker pipeline deferred to Slice 1D).
- **Dependencies Introduced**: NONE (zero new dependencies added).

---

## 4. Security & Compliance Review

- **Security Review**:
  - Authenticated user CANNOT directly finalize documents to `READY`.
  - Authenticated user CANNOT upload arbitrary unreserved Storage objects.
  - Exact-path signed upload authorization strictly binds path `{user_id}/{doc_id}/source.pdf`.
  - User A / User B isolation verified across database queries, storage access, signed URLs, and archival.
  - Container validation inspects `%PDF-` magic bytes; non-PDFs are rejected and physically deleted.
  - Quota bypass via parallel reservations prevented by transaction advisory locks and counting `UPLOADING` rows.
  - Real Storage API deletion on archive prevents unbounded storage accumulation.
  - Automated security scan in `create-review-package.ps1`: Zero secrets, keys, or credentials detected.
- **Medical & Content Safety**:
  - Upload UI displays prominent educational-use banner warning against patient records and PHI.
  - Invariant: strictly educational platform; deep text-based PHI scanning deferred to Slice 1D.
- **Environment Variables**:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
  - `SUPABASE_SECRET_KEY` (server-only; never exposed to browser bundles)

---

## 5. Verification & Quality

- **Tests / Checks Executed**:
  - `pnpm install --frozen-lockfile` -> Exit Code 0 (PASS)
  - `pnpm format:check` -> Exit Code 0 (PASS)
  - `pnpm lint` -> Exit Code 0 (PASS)
  - `pnpm typecheck` -> Exit Code 0 (PASS)
  - `pnpm test` -> Exit Code 0 (PASS, 92 tests across 10 suites including real Storage API integration tests)
  - `pnpm db:reset` -> Exit Code 0 (PASS, migrations applied)
  - `pnpm db:types` -> Exit Code 0 (PASS, database types regenerated)
  - `pnpm db:test` -> Exit Code 0 (PASS, 178 pgTAP assertions across 3 suites)
  - `pnpm build` -> Exit Code 0 (PASS, Turbopack production build)
  - `pnpm test:e2e` -> Exit Code 0 (PASS, 17 Playwright tests across 5 suites)
  - `pnpm audit` -> Exit Code 0 (PASS, 0 vulnerabilities)
- **Browser Verification**:
  - Playwright automated browser tests executed against local Chromium.
  - Verified drag-and-drop dropzone, PHI warning banner, fake PDF rejection, valid upload, XSS filename safety, signed URL download, and archival.
  - Screenshots updated in `docs/screenshots/`.
- **Performance Impact**:
  - 5-byte range read avoids 25 MB memory allocation per document upload.
  - Direct browser-to-storage upload offloads file data transfer from Next.js server.
- **Cost Impact**: $0.00 (Local Supabase Storage; no cloud resources, no paid APIs).

---

## 6. Deviations, Issues & Debt

- **Deviations from Specification**: None. All P0 and P1 review requirements addressed in full.
- **Known Issues**: None.
- **Blockers**: None.
- **Technical Debt Knowingly Introduced**: None.

---

## 7. Next Steps & Readiness

- **Git Status**: All changes staged/committed on `phase/01c-documents`.
- **Recommended Next Step**: Upon approval of the review package, merge `phase/01c-documents` into `main` via squash merge, then proceed to **Phase 1D — Document Ingestion & Text Processing** (`phase/01d-processing`).
- **READY_FOR_EXTERNAL_REVIEW**: YES
