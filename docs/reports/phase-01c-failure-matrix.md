# MedStudy Atlas — Phase 1C Failure Matrix

- **Phase**: Vertical Slice 1C — Document Library & Secure Upload
- **Mode**: LOCAL-FIRST
- **Branch**: `phase/01c-documents`
- **Scope**: Security boundaries, storage isolation, quota enforcement, and failure scenarios.

---

## 1. Failure Scenario Matrix

| ID | Scenario | Expected Result | Test Layer | Test Name / Evidence | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **SEC-01** | Anonymous upload request | Denied with 42501 (Not authenticated) | Database (pgTAP) | `supabase/tests/database/03_documents_rls.sql` (`Anon: EXECUTE denied on request_document_upload`) | **PASS** |
| **SEC-02** | Anonymous direct document table mutation | Denied with 42501 (permission denied) | Database (pgTAP) | `supabase/tests/database/03_documents_rls.sql` (`Anon: SELECT/INSERT/UPDATE/DELETE denied on public.documents`) | **PASS** |
| **SEC-03** | Arbitrary direct Storage upload without reservation | Denied by storage RLS with 403 / AccessDenied | Integration (Vitest) | `tests/integration/storage-security.test.ts` (`1. Direct unauthorized Storage upload is strictly denied`) | **PASS** |
| **SEC-04** | Arbitrary unreserved nested path upload | Denied by storage RLS | Integration (Vitest) | `tests/integration/storage-security.test.ts` (`2. Arbitrary unreserved path upload is denied`) | **PASS** |
| **SEC-05** | Direct Storage DELETE by authenticated user | Denied; physical object retained | Integration (Vitest) | `tests/integration/storage-security.test.ts` (`3. Direct Storage DELETE is strictly denied`) | **PASS** |
| **SEC-06** | Cross-user metadata read (Bob reads Alice's document) | Empty result; RLS enforces `auth.uid() = user_id` | Database (pgTAP) & Integration | `03_documents_rls.sql` (`Isolation: User B cannot SELECT User A documents`) & `storage-security.test.ts` | **PASS** |
| **SEC-07** | Cross-user signed download URL | Bob cannot generate Alice's download signed URL; action rejects | Integration (Vitest) & Service | `tests/integration/storage-security.test.ts` & `src/modules/documents/service.ts` | **PASS** |
| **SEC-08** | Cross-user delete / archive (Bob archives Alice's document) | Denied with 22023; row unaffected | Database (pgTAP) | `03_documents_rls.sql` (`Isolation: User B cannot archive User A document`) | **PASS** |
| **SEC-09** | Cross-user subject association (Alice links Bob's subject) | Denied with 23503 (foreign key / subject ownership) | Database (pgTAP) | `03_documents_rls.sql` (`request_document_upload: Rejects linking another user subject`) | **PASS** |
| **SEC-10** | Fake PDF (.txt renamed to .pdf) | Container validation fails magic bytes (`%PDF-`); object removed; marked REJECTED | Integration & E2E | `storage-security.test.ts` (`4. Invalid PDF is rejected...`) & `document-management.spec.ts` | **PASS** |
| **SEC-11** | Spoofed MIME type (executable/HTML with PDF extension) | Magic byte inspection fails; rejected with INVALID_PDF_SIGNATURE; object removed | Integration & Unit | `storage-security.test.ts` & `tests/unit/documents.test.ts` | **PASS** |
| **SEC-12** | Oversized file (> 25 MB) | Rejected at request with 22023; schema validation fails | Database & Unit | `03_documents_rls.sql` (`Rejects size > 25 MB`) & `tests/unit/documents.test.ts` | **PASS** |
| **SEC-13** | Reserved-vs-actual size mismatch | Finalization rejects with 23514; object removed from storage; never READY | Database & Integration | `03_documents_rls.sql` (`Rejects actual size mismatch`) & `storage-security.test.ts` (`5. Declared size mismatch is rejected`) | **PASS** |
| **SEC-14** | Total quota bypass attempt (100 MB limit) | Counts UPLOADING, VALIDATING, READY rows; rejects request exceeding 100 MB | Database (pgTAP) | `03_documents_rls.sql` (`Quota: Rejects upload request that would exceed 100MB including UPLOADING rows`) | **PASS** |
| **SEC-15** | Active document count quota (max 10) | Rejects 11th active document with 23514 | Database (pgTAP) | `03_documents_rls.sql` (Active count constraint assertion) | **PASS** |
| **SEC-16** | Concurrent quota reservation | Serialized per user inside transaction via `pg_advisory_xact_lock` | Database (pgTAP) & Migration | `supabase/migrations/20260920000000_documents_and_storage.sql` | **PASS** |
| **SEC-17** | Hostile filename (XSS payload `<img src=x onerror=alert('xss')>.pdf`) | Sanitized for metadata; rendered as literal text without execution | E2E (Playwright) & Unit | `tests/e2e/document-management.spec.ts` (`User-Content XSS Defense`) & `tests/unit/documents.test.ts` | **PASS** |
| **SEC-18** | Traversal-like filename (`../../../etc/passwd.pdf`) | `sanitizeFilename` strips directory traversal; system assigns canonical key | Unit (Vitest) | `tests/unit/documents.test.ts` (`strips unix/windows path traversal sequences`) | **PASS** |
| **SEC-19** | Abandoned upload (reservation made, no file uploaded) | Finalization detects missing storage object; marks REJECTED (OBJECT_NOT_FOUND) | Service & Integration | `src/modules/documents/service.ts` (`finalizeDocumentUpload`) | **PASS** |
| **SEC-20** | Storage upload failure | Client displays user-friendly error; document remains in UPLOADING/REJECTED; no corrupt state | E2E & Service | `src/components/documents/document-uploader.tsx` & `src/modules/documents/service.ts` | **PASS** |
| **SEC-21** | Repeated finalization (idempotency) | Returns existing READY document cleanly without re-processing | Database (pgTAP) & Integration | `03_documents_rls.sql` (`Privileged finalize: Idempotent repeat call returns READY`) | **PASS** |
| **SEC-22** | Removal / archive retry (idempotency) | Returns TRUE; `archived_at` preserved; subsequent calls succeed cleanly | Database (pgTAP) | `03_documents_rls.sql` (`Archive: Idempotent repeat call succeeds`) | **PASS** |
| **SEC-23** | Missing Storage object on archive | Handled safely; database record marked archived; recovery proceeds cleanly | Service & Database | `src/modules/documents/service.ts` (`archiveDocument`) | **PASS** |
| **SEC-24** | Prior Phase 1A identity & auth regressions | User profile isolation, proxy claims, token handling pass | Database & E2E | `01_user_profiles_rls.sql` & `tests/e2e/auth-isolation.spec.ts` | **PASS** |
| **SEC-25** | Prior Phase 1B curriculum & onboarding regressions | Subject active unique index, composite FK, onboarding RPC pass | Database & E2E | `02_curriculum_rls.sql` & `tests/e2e/curriculum-management.spec.ts` | **PASS** |

---

## 2. Verification Summary
- **Database Test Suite (`supabase/tests/database/`)**: 178 pgTAP tests passing.
- **Unit & Integration Test Suite (`tests/unit/`, `tests/integration/`)**: All tests passing.
- **End-to-End Suite (`tests/e2e/`)**: All browser and XSS regression tests passing.
- **Zero Secrets**: Automated audit confirms no secrets, tokens, or credentials committed.
