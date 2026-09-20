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
| **SEC-06** | Cross-user metadata read (Bob reads Alice's document) | Empty result; RLS enforces `auth.uid() = user_id` | Database (pgTAP) & Integration | `03_documents_rls.sql` (`Isolation: User B cannot SELECT User A documents`) & `storage-security.test.ts` (Test 3) | **PASS** |
| **SEC-07** | Cross-user signed download URL | Bob cannot obtain Alice's download signed URL; action / query rejects | Integration (Vitest) & Database (pgTAP) | `tests/integration/storage-security.test.ts` (`8. Cross-user download authorization denied via application boundary (P0-3)`) & `03_documents_rls.sql` | **PASS** |
| **SEC-08** | Cross-user delete / archive (Bob archives Alice's document) | Denied with 22023; row unaffected | Database (pgTAP) | `03_documents_rls.sql` (`Isolation: Cannot archive document belonging to another user`) | **PASS** |
| **SEC-09** | Cross-user subject association (Alice links Bob's subject) | Denied with 23503 (foreign key / subject ownership) | Database (pgTAP) | `03_documents_rls.sql` (`request_document_upload: Rejects linking another user subject`) | **PASS** |
| **SEC-10** | Fake PDF (.txt renamed to .pdf) | Container validation fails magic bytes (`%PDF-`); object removed; marked REJECTED | Integration & E2E | `storage-security.test.ts` (`4. Invalid PDF is rejected...`) & `document-management.spec.ts` | **PASS** |
| **SEC-11** | Spoofed MIME type (executable/HTML with PDF extension) | Magic byte inspection fails; rejected with INVALID_PDF_SIGNATURE; object removed | Integration & Unit | `storage-security.test.ts` (Test 4) & `tests/unit/documents.test.ts` | **PASS** |
| **SEC-12** | Oversized file (> 25 MB) | Rejected at request with 22023; schema validation fails | Database & Unit | `03_documents_rls.sql` (`Rejects size > 25 MB`) & `tests/unit/documents.test.ts` | **PASS** |
| **SEC-13** | Reserved-vs-actual size mismatch | Real uploaded object size verified; finalization rejects; physical blob deleted; marked REJECTED | Integration (Vitest) & Database (pgTAP) | `tests/integration/storage-security.test.ts` (`5. Declared size mismatch with a REAL uploaded object...`) & `03_documents_rls.sql` | **PASS** |
| **SEC-14** | Total quota bypass attempt (100 MB limit) | Counts UPLOADING (unexpired) & READY rows; rejects request exceeding 100 MB with 23514 | Database (pgTAP) | `03_documents_rls.sql` (`Quota: Rejects upload request that would exceed 100MB including UPLOADING rows`) | **PASS** |
| **SEC-15** | Active document count quota (max 10) | Rejects 11th active document with 23514 | Database (pgTAP) | `03_documents_rls.sql` (Active count constraint assertion) | **PASS** |
| **SEC-16** | Concurrent quota reservation | Serialized per user inside transaction via `pg_advisory_xact_lock`; exactly one succeeds, overflow fails with 23514 | Integration (Vitest) & Migration | `tests/integration/storage-security.test.ts` (`12. Concurrent quota reservations are serialized via advisory lock (P0-5)`) | **PASS** |
| **SEC-17** | Hostile filename (XSS payload `<img src=x onerror=alert('xss')>.pdf`) | Sanitized for metadata; rendered as literal text without execution | E2E (Playwright) & Unit | `tests/e2e/document-management.spec.ts` (`User-Content XSS Defense`) & `tests/unit/documents.test.ts` | **PASS** |
| **SEC-18** | Traversal-like filename (`../../../etc/passwd.pdf`) | `sanitizeFilename` strips directory traversal; system assigns canonical key | Unit (Vitest) | `tests/unit/documents.test.ts` (`strips unix/windows path traversal sequences`) | **PASS** |
| **SEC-19** | Abandoned upload (reservation made, no file uploaded) | Upload lease expires after 2 hours; lazy recovery in `request_document_upload` transitions to FAILED (`UPLOAD_TIMEOUT`); slots/quota freed | Integration (Vitest) & Database (pgTAP) | `tests/integration/storage-security.test.ts` (`10. Abandoned upload reservation recovery via lazy cleanup (P1)`) & `03_documents_rls.sql` | **PASS** |
| **SEC-20** | Storage deletion failure on archive or reject | Deletion failure halts transition; document remains in active/reserved state; quota is NOT freed; recoverable error returned | Integration (Vitest) & Service | `tests/integration/storage-security.test.ts` (`7. Storage deletion failure on archive does NOT free quota or mark archived (P0)`) & `src/modules/documents/service.ts` | **PASS** |
| **SEC-21** | Repeated finalization (idempotency) | Returns existing READY document cleanly without re-processing | Database (pgTAP) & Integration | `03_documents_rls.sql` (`Privileged finalize: Idempotent repeat call returns READY`) | **PASS** |
| **SEC-22** | Removal / archive retry (application idempotency) | Calling archive on already-archived document with absent blob returns success cleanly; no redundant deletion | Integration (Vitest) & Database (pgTAP) | `tests/integration/storage-security.test.ts` (`11. Application-level archive retry is idempotent (P1)`) & `03_documents_rls.sql` | **PASS** |
| **SEC-23** | Signed upload token reuse after delete | Token can re-upload if path is empty; mitigated by tombstone placement (`409 KeyAlreadyExists`) and 2-hour upload lease expiration | Integration (Vitest) | `tests/integration/storage-security.test.ts` (`9. Signed upload token reuse-after-delete experiment & lease mitigation (P1)`) | **PASS** |
| **SEC-24** | Prior Phase 1A identity & auth regressions | User profile isolation, proxy claims, token handling pass | Database & E2E | `01_user_profiles_rls.sql` & `tests/e2e/auth-isolation.spec.ts` | **PASS** |
| **SEC-25** | Prior Phase 1B curriculum & onboarding regressions | Subject active unique index, composite FK, onboarding RPC pass | Database & E2E | `02_curriculum_rls.sql` & `tests/e2e/curriculum-management.spec.ts` | **PASS** |
| **SEC-26** | Direct authenticated invocation of privileged archive | Denied with 42501 (permission denied); only service_role can execute | Database (pgTAP) & Integration | `03_documents_rls.sql` (`Authenticated: EXECUTE denied on archive_document_privileged`) & `storage-security.test.ts` (Test 6) | **PASS** |

---

## 2. Verification Summary
- **Database Test Suite (`supabase/tests/database/`)**: 180 pgTAP tests passing.
- **Unit & Integration Test Suite (`tests/unit/`, `tests/integration/`)**: 99 tests passing across 10 suites.
- **End-to-End Suite (`tests/e2e/`)**: 17 Playwright tests passing.
- **Zero Secrets**: Automated audit confirms no secrets, tokens, or credentials committed.
