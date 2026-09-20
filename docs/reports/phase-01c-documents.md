# Execution Report: Phase 1C — Document Library & Secure Upload

- **Phase / Task**: Phase 1C — Document Library & Secure Upload
- **Status**: COMPLETE
- **Mode**: LOCAL-FIRST
- **Branch**: `phase/01c-documents`
- **Review Package**: `review-output/phase-01c-review.zip`
- **Review Target**: Phase 1C committed checkpoint on `phase/01c-documents`
- **Canonical Commit SHA**: Exact commit SHA is captured in `review-output/phase-01c-review.zip` (`REVIEW.md` and `test-results/*.log`).
- **Objective**: Implement secure document library, private Supabase Storage bucket, reservation-backed Storage INSERT RLS policy, direct authenticated upload, privileged server-only finalization and safe cleanup lifecycle, concurrency-safe quota serialization, 5-byte range container validation, physical storage deletion on archive, and mobile-first document library UI with local-first isolation and $0.00 cloud spend.

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
   - Lazy cleanup recovery: `requestDocumentUpload` retries physical `remove()` for any existing `CLEANUP_PENDING` rows for that user, completing them to `FAILED` (`CLEANUP_RECOVERED`) or `REJECTED` once physical absence is confirmed.
   - Archive TOCTOU race closure: `archiveDocument` transitions `UPLOADING` documents to `CLEANUP_PENDING` before physical `remove()`, closing upload authority before blob deletion.

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
   - Requires HTTP 206 Partial Content, buffer `byteLength <= 5`, and a 5000ms timeout via `AbortController` and `setTimeout(() => controller.abort(), 5000)`.
   - If the server returns HTTP 200 (attempting full 25 MB download) or times out, fails safely as a transient validation error.

8. **Privileged Server-Only Finalization and Archive (`P0`, `P1`)**:
   - `finalize_document_upload_privileged`: callable ONLY by `service_role`.
   - `archive_document_privileged`: callable ONLY by `service_role`.
   - All privileged RPC results are explicitly inspected with error handling.

9. **Authoritative In-Database & Integration Test Suites (`P0`, `P1`)**:
   - `supabase/tests/database/03_documents_rls.sql`: 62 pgTAP assertions covering Storage RLS, `CLEANUP_PENDING`, worst-case in-flight accounting, and privileged cleanup RPC denials. Total 190 database tests pass.
   - `tests/integration/storage-security.test.ts`: 24 comprehensive integration tests covering all required scenarios:
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
     20. Application download authorization boundary: Alice (owner) is ALLOWED, Bob (cross-user) is DENIED (P0/P1).
     21. CLEANUP_PENDING recovery: transient remove failure leaves quota reserved, subsequent lazy retry succeeds, removes blob, transitions to FAILED, and frees quota for new upload (P0).
      22. Adversarial archive/upload TOCTOU race: upload authority is closed (status=CLEANUP_PENDING) BEFORE physical deletion (P0).
      23. Real concurrent quota reservation: pg_advisory_xact_lock serializes parallel requests, exactly one succeeds, one fails (P1).
      24. Real size-mismatch storage integration: physical blob is removed, DB marked REJECTED, quota released (P1).
      25. DB completion failure after physical delete and subsequent recovery convergence (P0).
      26. Storage 404 classification in finalization: NoSuchBucket and ambiguous 404 fail closed, NoSuchKey triggers cleanup (P0).
      27. Storage 404 classification in archive idempotency: NoSuchBucket returns recoverable error; NoSuchKey permits success (P0).

10. **Conservative Storage 404 Error Classification & Safe Convergence (`P0`)**:
    - Replaced broad 404 checks with `isConfirmedObjectNotFoundError`:
      - Returns `true` ONLY for confirmed object-level missing conditions (`NoSuchKey`, explicit "Object not found", "object_not_found", "key not found").
      - Returns `false` (fails closed) for `NoSuchBucket`, "Bucket not found", 401/403, 5xx, network errors, and generic ambiguous 404s without object-level semantics.
    - In `finalizeDocumentUpload`: `NoSuchBucket` and ambiguous 404 return recoverable storage errors without rejecting documents, deleting blobs, or releasing quota.
    - In `archiveDocument`: `NoSuchBucket` on already-archived rows returns recoverable error rather than falsely claiming confirmed physical absence.
    - In `requestDocumentUpload`: `remove()` treating confirmed `NoSuchKey` as physically absent ensures convergence even if a prior DB completion RPC failed; query errors and privileged RPC errors are strictly inspected and propagated.

---

## 2. File Changes

### Important Files Created
- `src/config/server-env.ts` — Server-only environment configuration for `SUPABASE_SECRET_KEY`.
- `src/lib/supabase/admin.ts` — Server-only privileged Supabase admin client.
- `tests/integration/storage-security.test.ts` — Authoritative Supabase Storage API integration test suite (27 tests).
- `docs/reports/phase-01c-failure-matrix.md` — 34-scenario security and failure matrix.

### Important Files Modified
- `supabase/migrations/20260920000000_documents_and_storage.sql` — Hardened storage policies, removed `finalize_token`, added `CLEANUP_PENDING` status, reservation-backed Storage INSERT RLS, input check constraints, concurrency-safe advisory lock, worst-case quota counting, and privileged finalization/cleanup/archive RPCs.
- `supabase/tests/database/03_documents_rls.sql` — Updated pgTAP tests to verify new security boundaries (62 tests).
- `src/modules/documents/types.ts` — Updated domain types: removed `finalize_token`, added `CLEANUP_PENDING` status, updated `RequestUploadResult`.
- `src/modules/documents/service.ts` — Updated service: direct authenticated upload, 5-byte range validation, server-only privileged finalization, two-step cleanup lifecycle with `CLEANUP_PENDING` recovery, archive/upload TOCTOU race closure via `start_document_cleanup_privileged`, conservative `isConfirmedObjectNotFoundError` storage classification, cleanup convergence on already-absent blobs, and strict error propagation.
- `src/modules/documents/actions.ts` — Updated server actions: pass reservation parameters for direct authenticated upload, and added `getDocumentQuotaAction` for authoritative server quota checks.
- `src/components/documents/document-library.tsx` — Authoritative server quota refresh on archive via `getDocumentQuotaAction`, and removed unreachable `case "VALIDATING":`.
- `src/components/documents/document-uploader.tsx` — Added PHI warning banner and direct authenticated upload integration.
- `vitest.config.mts` — Added `tests/integration` to test runner.
- `tests/e2e/document-management.spec.ts` — Added fake PDF rejection, PHI warning check, and full E2E flow.
- `.env.example` — Added `SUPABASE_SECRET_KEY` placeholder.
- `docs/architecture/data-model.md` — Synchronized `documents` DDL with migration.
- `docs/security/threat-model.md` — Updated threat matrix rows for P0/P1 security architecture.
- `scripts/create-review-package.ps1` — Updated review checklist, dynamic failure matrix naming, and safe literal string concatenation for Package Contents.

---

## 3. Architecture & Subsystem Impact

- **Architecture Decisions**:
  - Eliminated `finalize_token`: Authenticated browsers can no longer invoke finalization directly. Privileged finalization is callable ONLY by `service_role`.
  - Removed broad authenticated mutation policies on `storage.objects`. Uploads use direct authenticated upload governed by reservation-backed Storage INSERT RLS policy with `upsert: false`.
  - Concurrency-safe quota reservations via PostgreSQL per-user transaction advisory locks (`pg_advisory_xact_lock`).
  - Total storage quota counts all active reservations (`UPLOADING`, `CLEANUP_PENDING`, `READY`) using worst-case 25 MB for unverified rows.
  - 5-byte range validation via HTTP Range request on internal signed URL avoids downloading 25 MB into server memory.
  - Physical blob removal on archive via official Storage API before stamping `archived_at`.
  - Archive TOCTOU race closure: For `UPLOADING` documents, `archiveDocument` calls `start_document_cleanup_privileged` to transition status to `CLEANUP_PENDING` before calling `Storage.remove()`, instantly revoking Storage INSERT RLS upload permissions. Only after physical deletion succeeds is `archive_document_privileged` invoked. If deletion fails, status remains `CLEANUP_PENDING` and quota remains reserved.
  - Two-step cleanup lifecycle (`UPLOADING` -> `CLEANUP_PENDING` -> physical `remove()` -> `REJECTED`/`FAILED`) with lazy recovery in `requestDocumentUpload`.
  - Conservative Storage 404 Error Classification: `isConfirmedObjectNotFoundError` ensures `NoSuchBucket` and generic ambiguous 404s fail closed without rejecting documents or releasing quota. Only confirmed object-level missing conditions (`NoSuchKey`) are treated as absent.
  - Cleanup Convergence: During recovery, confirmed `NoSuchKey` is treated as successful physical removal, allowing cleanup to converge even if a previous DB completion RPC failed.
  - Authoritative UI quota: Quota display refreshes via server-side `getDocumentQuotaAction()` rather than local client math.
- **Database Impact**:
  - Migration `20260920000000_documents_and_storage.sql` applied cleanly.
  - `public.documents` table updated: check constraints added, `finalize_token` removed, `CLEANUP_PENDING` status added.
  - Privileged RPCs: `finalize_document_upload_privileged`, `archive_document_privileged`, `start_document_cleanup_privileged`, and `complete_document_cleanup_privileged` granted strictly to `service_role`.
  - Quota serialization inside `request_document_upload`.
- **API Impact**:
  - `requestDocumentUploadAction` returns `documentId`, `storageBucket`, and `storageKey` for direct authenticated upload.
  - `finalizeDocumentUploadAction` executes server-side validation and privileged finalization.
  - `getDocumentQuotaAction` provides authoritative quota usage.
- **AI Impact**: NONE (strictly deferred to Slice 1E and 1F).
- **Background-Job Impact**: NONE (worker pipeline deferred to Slice 1D).
- **Dependencies Introduced**: NONE (zero new dependencies added).

---

## 4. Security & Compliance Review

- **Security Review**:
  - Authenticated user CANNOT directly finalize documents to `READY`.
  - Authenticated user CANNOT upload arbitrary unreserved Storage objects.
  - Reservation-backed Storage INSERT RLS strictly binds path `{user_id}/{doc_id}/source.pdf`.
  - User A / User B isolation verified across database queries, storage access, signed URLs, and archival.
  - Container validation inspects `%PDF-` magic bytes; non-PDFs are rejected and physically deleted.
  - Quota bypass via parallel reservations prevented by transaction advisory locks and worst-case accounting of `UPLOADING` and `CLEANUP_PENDING` rows.
  - Archive/upload TOCTOU race closed: status set to `CLEANUP_PENDING` prior to physical deletion, shutting down upload capability during blob removal.
  - Storage 404 classification fails closed: `NoSuchBucket` and ambiguous 404 errors do NOT delete blobs, reject documents, or free quota.
  - Real Storage API deletion on archive prevents unbounded storage accumulation.
  - Application download authorization boundary strictly checked: owner receives signed URL and fetches valid PDF bytes (HTTP 200); cross-user is denied.
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
  - `pnpm test` -> Exit Code 0 (PASS, 123 tests across 10 suites including 27 real Storage API integration tests)
  - `pnpm db:reset` -> Exit Code 0 (PASS, migrations applied)
  - `pnpm db:types` -> Exit Code 0 (PASS, database types regenerated)
  - `pnpm db:test` -> Exit Code 0 (PASS, 190 pgTAP assertions across 3 suites including 62 in 03_documents_rls.sql)
  - `pnpm build` -> Exit Code 0 (PASS, Turbopack production build)
  - `pnpm test:e2e` -> Exit Code 0 (PASS, 17 Playwright tests across 5 suites)
  - `pnpm audit` -> Exit Code 0 (PASS, 0 vulnerabilities)
- **Application & Browser Verification**:
  - Integration test 20 verifies the application authorization boundary: owner Alice calls `getAuthorizedDocumentUrl()`, receives signed URL, and fetches document bytes over HTTP with status 200; cross-user Bob is denied.
  - Playwright automated browser tests executed against local Chromium.
  - Verified drag-and-drop dropzone, PHI warning banner, fake PDF rejection, valid upload, XSS filename safety, and archival.
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
