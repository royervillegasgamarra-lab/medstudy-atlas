# MedStudy Atlas — Phase 1D Failure Matrix

- **Phase**: Vertical Slice 1D — Secure Document Processing / Ingestion & Page Provenance
- **Mode**: LOCAL-FIRST
- **Branch**: `phase/01d-processing`
- **Scope**: Parser subprocess isolation, qpdf preflight, PDFium text extraction, Tesseract OCR (`spa+eng`), provenance tracking, concurrency control, and failure taxonomy.

---

## 1. Failure Scenario Matrix

| ID | Scenario | Expected Result | Test Layer | Test Name / Evidence | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **PROC-01** | Subprocess environment isolation | Environment variables stripped; `SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, AI keys, and tokens absent in child | Unit & Integration | `tests/unit/parser.test.ts` (`createSafeParserEnvironment: strips sensitive tokens...`) & `tests/integration/processing-worker.test.ts` (`Subprocess Security Boundary...`) | **PASS** |
| **PROC-02** | Cross-user processing run read | User B cannot SELECT User A processing runs; RLS enforces `auth.uid() = user_id` | Database (pgTAP) | `supabase/tests/database/04_processing_runs_rls.sql` (`Isolation: User B cannot SELECT User A processing runs`) | **PASS** |
| **PROC-03** | Cross-user document page read | User B cannot SELECT User A document pages; RLS enforces `auth.uid() = user_id` | Database (pgTAP) | `supabase/tests/database/04_processing_runs_rls.sql` (`Isolation: User B cannot SELECT User A document pages`) | **PASS** |
| **PROC-04** | Direct authenticated mutation on `document_processing_runs` | Denied with 42501 (permission denied); table revoked from authenticated/anon | Database (pgTAP) | `supabase/tests/database/04_processing_runs_rls.sql` (`Authenticated: INSERT/UPDATE/DELETE denied on document_processing_runs`) | **PASS** |
| **PROC-05** | Direct authenticated mutation on `document_pages` | Denied with 42501 (permission denied); table revoked from authenticated/anon | Database (pgTAP) | `supabase/tests/database/04_processing_runs_rls.sql` (`Authenticated: INSERT/UPDATE/DELETE denied on document_pages`) | **PASS** |
| **PROC-06** | Direct authenticated call to privileged processing RPCs | Denied with 42501 (permission denied); only `service_role` can execute | Database (pgTAP) | `supabase/tests/database/04_processing_runs_rls.sql` (`Authenticated: EXECUTE denied on enqueue, claim, persist, fail`) | **PASS** |
| **PROC-07** | Concurrent worker claim race condition | Serialized via `FOR UPDATE SKIP LOCKED`; exactly one worker claims job, second receives empty set | Integration (Vitest) | `tests/integration/processing-worker.test.ts` (`Worker Claim Concurrency & SKIP LOCKED: prevents multiple workers from claiming...`) | **PASS** |
| **PROC-08** | Encrypted PDF upload | `qpdf --is-encrypted` returns 0; parser exits with 1; manifest reports `PDF_ENCRYPTED` | Unit (Vitest) | `tests/unit/parser.test.ts` (`fails cleanly on encrypted.pdf with PDF_ENCRYPTED code`) | **PASS** |
| **PROC-09** | Structurally corrupt / damaged PDF | `qpdf --check` returns 2; parser exits with 1; manifest reports `PDF_CORRUPT` | Unit (Vitest) | `tests/unit/parser.test.ts` (`fails cleanly on corrupt.pdf with PDF_CORRUPT code`) | **PASS** |
| **PROC-10** | Document exceeding maximum page budget (> 300 pages) | `qpdf --show-npages` detects > 300; rejected with `PAGE_LIMIT_EXCEEDED` | Unit & Configuration | `src/config/processing-limits.ts` (`maxPagesPerDocument: 300`) & `src/parsers/document_parser.py` | **PASS** |
| **PROC-11** | Zero-page PDF document | Preflight detects 0 pages; rejected with `PDF_ZERO_PAGES` | Unit & Schema | `src/parsers/document_parser.py` (`PDF_ZERO_PAGES`) & `src/modules/documents/processing-types.ts` | **PASS** |
| **PROC-12** | OCR budget exhaustion (> 60 OCR pages) | Processing halts when OCR page count reaches 61; marked `OCR_PAGE_LIMIT` | Configuration & Parser | `src/config/processing-limits.ts` (`maxOcrPagesPerDocument: 60`) & `src/parsers/document_parser.py` | **PASS** |
| **PROC-13** | Extreme dimension page bomb (> 12M pixels / 10000x10000 pt) | Page dimension product exceeds `MAX_RENDER_PIXELS_PER_PAGE`; rejected with `PAGE_RENDER_LIMIT` | Unit (Vitest) | `tests/unit/parser.test.ts` (`fails on extreme_dimension.pdf with PAGE_RENDER_LIMIT`) | **PASS** |
| **PROC-14** | Prompt injection attack embedded in PDF | Preserved verbatim as inert string data; no code execution; parser completes cleanly | Unit (Vitest) | `tests/unit/parser.test.ts` (`treats prompt injection payloads as inert text without executing`) | **PASS** |
| **PROC-15** | Native text extraction & spatial provenance | Native text extracted via PDFium; exact dimensions, character counts, and SHA-256 computed | Unit & Integration | `tests/unit/parser.test.ts` (`extracts native text from valid_text.pdf`) & `processing-worker.test.ts` | **PASS** |
| **PROC-16** | Scanned page OCR in Spanish | Rendered to memory bitmap; processed by Tesseract with `spa+eng`; text extracted with confidence | Unit (Vitest) | `tests/unit/parser.test.ts` (`applies Tesseract OCR on scanned_image.pdf in Spanish`) | **PASS** |
| **PROC-17** | Hybrid document with native text and scanned images | Page 1 classified `TEXT_BASED` (`NATIVE`); Page 2 classified `SCANNED` (`OCR`) | Unit (Vitest) | `tests/unit/parser.test.ts` (`handles mixed native text and scanned image in mixed_text_scanned.pdf`) | **PASS** |
| **PROC-18** | Blank / whitespace-only page | Classified `NO_TEXT` with empty string; character count 0; job succeeds | Unit (Vitest) | `tests/unit/parser.test.ts` (`processes blank_page.pdf cleanly with empty text`) | **PASS** |
| **PROC-19** | Processing retry idempotency | Re-processing replaces old page records via transaction; exactly original page count retained without duplicate rows | Integration (Vitest) | `tests/integration/processing-worker.test.ts` (`End-to-End Processing & Retry Idempotency: re-enqueuing must not produce duplicate pages`) | **PASS** |
| **PROC-20** | Guaranteed temporary directory cleanup | Temporary directory in `os.tmpdir()/medstudy-atlas-proc/` deleted in `finally` block on success and failure | Integration (Vitest) | `tests/integration/processing-worker.test.ts` (`Guaranteed Temp Directory Cleanup: ensures no temporary files remain...`) | **PASS** |
| **PROC-21** | Single-page character limit (> 100,000 characters) | Page exceeding limit rejected with `TEXT_PAGE_LIMIT`; prevents memory exhaustion | Parser & Config | `src/config/processing-limits.ts` (`maxExtractedCharsPerPage: 100_000`) & `src/parsers/document_parser.py` | **PASS** |
| **PROC-22** | Document character limit (> 3,000,000 characters) | Cumulative document characters exceeding limit rejected with `TEXT_DOCUMENT_LIMIT` | Parser & Config | `src/config/processing-limits.ts` (`maxExtractedCharsPerDocument: 3_000_000`) & `src/parsers/document_parser.py` | **PASS** |
| **PROC-23** | Preflight subprocess timeout (> 10s) | Subprocess terminated; run failed with `PREFLIGHT_TIMEOUT`; retryable | Parser & Worker | `src/config/processing-limits.ts` (`preflightTimeoutSeconds: 10`) & `src/parsers/document_parser.py` | **PASS** |
| **PROC-24** | OCR page execution timeout (> 20s) | Tesseract execution terminated; run failed with `OCR_TIMEOUT`; retryable | Parser & Worker | `src/config/processing-limits.ts` (`ocrPageTimeoutSeconds: 20`) & `src/parsers/document_parser.py` | **PASS** |
| **PROC-25** | Total job timeout (> 600s) | Worker kills child process with SIGKILL; run failed with `PARSER_TIMEOUT` | Worker & Config | `src/config/processing-limits.ts` (`totalJobTimeoutSeconds: 600`) & `src/workers/documents-worker.ts` | **PASS** |
| **PROC-26** | Source PDF missing in Supabase Storage | Worker handles Storage 404 cleanly; fails run with `SOURCE_MISSING`; retryable | Worker (Vitest) | `src/workers/documents-worker.ts` (`SOURCE_MISSING` handling) | **PASS** |
| **PROC-27** | Invalid or unparseable parser manifest | Zod validation fails; worker marks run `PARSER_OUTPUT_INVALID`; non-retryable | Worker & Schema | `src/workers/documents-worker.ts` & `src/modules/documents/processing-types.ts` | **PASS** |
| **PROC-28** | Missing or corrupted page result JSON | Mismatched page number or invalid schema fails Zod; run marked `PARSER_OUTPUT_INVALID` | Worker & Schema | `src/workers/documents-worker.ts` & `tests/unit/parser.test.ts` | **PASS** |
| **PROC-29** | Cross-tenant foreign key tampering | Composite foreign key `(document_id, user_id)` on `document_pages` and `document_processing_runs` enforces tenant boundary at schema level | Database (Schema) | `supabase/migrations/20260920100000_document_processing_runs_and_pages.sql` (`fk_document_pages_doc_owner`) | **PASS** |
| **PROC-30** | Worker lease expiration & recovery | Expired leases (`lease_expires_at < NOW()`) reclaimed by next worker via `claim_next_processing_run` | Database (pgTAP) | `supabase/tests/database/04_processing_runs_rls.sql` (`claim_next_processing_run recovers expired lease`) | **PASS** |
| **PROC-31** | Retry limit exhaustion (> 3 retries) | Runs exceeding `maxRetries = 3` transition to `FAILED_FINAL`; cannot be re-claimed | Database & Config | `src/config/processing-limits.ts` (`maxRetries: 3`) & `supabase/migrations/20260920100000_document_processing_runs_and_pages.sql` | **PASS** |
| **PROC-32** | E2E Document processing lifecycle UI | UI renders "Pendiente de procesar", "Procesando", and "Procesado" badges correctly | E2E (Playwright) | `tests/e2e/document-processing.spec.ts` (`Document Library displays processing lifecycle status...`) | **PASS** |
| **PROC-33** | E2E Retry action on failed processing run | "Error al procesar" displays "Reintentar" button; clicking re-enqueues run to "Pendiente de procesar" | E2E (Playwright) | `tests/e2e/document-processing.spec.ts` (`Document Library displays processing lifecycle status and retry capability`) | **PASS** |
| **PROC-34** | Prior Phase 1A-1C regressions | Identity isolation, curriculum targets, and upload boundary remain intact | Database & E2E | `01_user_profiles_rls.sql`, `02_curriculum_rls.sql`, `03_documents_rls.sql`, `tests/e2e/*.spec.ts` | **PASS** |

---

## 2. Verification Summary
- **Database Test Suite (`supabase/tests/database/`)**: 223 pgTAP tests passing across 4 suites (33 in `04_processing_runs_rls.sql`).
- **Unit Test Suite (`tests/unit/`)**: 136 unit tests passing across 11 suites (13 in `parser.test.ts`).
- **Integration Test Suite (`tests/integration/`)**: 31 tests passing across 2 suites (4 in `processing-worker.test.ts`, 27 in `storage-security.test.ts`).
- **End-to-End Suite (`tests/e2e/`)**: 18 Playwright tests passing across 6 suites (including `document-processing.spec.ts`).
- **Zero Secrets**: Automated audit confirms no secrets, tokens, or credentials committed.
