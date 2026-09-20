# Execution Report: Phase 1D — Secure Document Processing & Page Provenance

- **Phase / Task**: Phase 1D — Secure Document Processing / Ingestion & Page Provenance
- **Status**: COMPLETE
- **Mode**: LOCAL-FIRST
- **Branch**: `phase/01d-processing`
- **Review Package**: `review-output/phase-01d-review.zip`
- **Review Target**: Phase 1D committed checkpoint on `phase/01d-processing`
- **Canonical Commit SHA**: Exact commit SHA is captured in `review-output/phase-01d-review.zip` (`REVIEW.md` and `test-results/*.log`).
- **Objective**: Implement bounded, deterministic document processing for authorized `READY` PDFs. Enforce strict subprocess security isolation (zero Supabase/AI/DB credentials passed to parser), `qpdf` structural preflight, `pypdfium2` native text extraction, selective local `tesseract` 5.x OCR (`spa+eng` only), page-level provenance tracking (`document_pages`), queue coordination via PostgreSQL `claim_next_processing_run` (`FOR UPDATE SKIP LOCKED`), and live processing status UI with retry capabilities at $0.00 cloud spend.

---

### 1. Work Completed

1. **Subprocess Security Boundary & Isolation (`src/parsers/document_parser.py`, `src/workers/documents-worker.ts`)**:
   - Application credentials are not inherited through the parser child-process environment.
   - Implemented `createSafeParserEnvironment()` which strictly filters environment variables passed to the Python child process.
   - Child process receives NO `SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `OPENAI_API_KEY`, or user auth tokens.
   - Operating system variables (`PATH`, `SystemRoot`, `TEMP`, `LANG`) are retained.
   - Input and output directories are isolated per job in `os.tmpdir()/medstudy-atlas-proc/{run_id}-{random_id}` and cleaned up via best-effort bounded cleanup on every exit path with bounded retries (100ms, 200ms, 400ms) and operational warning on residual Windows file-locking.
   - Centralized processing limits (`src/config/processing-limits.ts`) are serialized and passed explicitly to the parser subprocess via the `--config <json>` CLI argument.

2. **Structural Preflight & Integrity Enforcement (`qpdf` 12.4.1)**:
   - Evaluates encryption status via `qpdf --is-encrypted`: encrypted PDFs are immediately rejected with error code `PDF_ENCRYPTED`.
   - Evaluates structural integrity via `qpdf --check`: structurally corrupt PDFs (exit code 2) are rejected with `PDF_CORRUPT`. Warnings (exit code 3) are recorded in `structural_warning_count` without failing compliant documents.
   - Checks page count via `qpdf --show-npages`: zero-page files reject with `PDF_ZERO_PAGES`; documents exceeding `maxPagesPerDocument` (300 pages) reject with `PDF_PAGE_COUNT_EXCEEDED`.
   - Preflight is bounded by a 10-second timeout; exceeding files fail with `PREFLIGHT_TIMEOUT`.
   - Diagnostic output is capped at 64 KB via `run_bounded_cmd`; memory-exhaustion attacks kill child process and fail with `PREFLIGHT_FAILED`.

3. **Native Text Extraction & Page Provenance (`pypdfium2` 5.13.0)**:
   - Extracts native textpage stream without browser or Node-canvas.
   - Normalizes text: strips null bytes, normalizes unicode (NFC), cleans excessive whitespace while preserving paragraph breaks.
   - Page dimensions validated: single-axis $\le 5000$ pt (`PAGE_DIMENSION_EXCEEDED`), render pixel area $\le 12,000,000$ pixels (`PAGE_PIXEL_AREA_EXCEEDED`).
   - Records page dimensions (`width_points`, `height_points`), `rotation_degrees`, character counts (Unicode code points), and SHA-256 hash of extracted text for cryptographic provenance.
   - Pages with >= 50 native characters are classified as `TEXT_BASED` and bypass OCR entirely.
   - Native extraction is bounded by the 600s total job timeout (honest documentation: PDFium has no per-page timeout).

4. **Selective OCR on Scanned Content (`tesseract` 5.5.3)**:
   - Only pages with < 50 native characters undergo OCR.
   - Renders page to image in memory at controlled scale (144 DPI) with strict pixel limit validation (`PAGE_PIXEL_AREA_EXCEEDED`).
   - Spawns Tesseract strictly with arguments array (`pytesseract.image_to_data(..., lang="spa+eng", timeout=20)`).
   - Only Spanish (`spa`) and English (`eng`) language packs are invoked.
   - OCR page count is bounded by `maxOcrPagesPerDocument` (60 pages); exceeding pages reject with `PARSER_RESOURCE_LIMIT`.
   - Pytesseract timeouts (`RuntimeError("Tesseract process timeout")`) are classified cleanly as `OCR_TIMEOUT`.
   - Temporary rasterized images are deleted immediately after OCR extraction.

5. **Trusted Node Orchestrator Semantic Provenance Verification (`src/workers/documents-worker.ts`)**:
   - Node orchestrator independently computes SHA-256 of downloaded source PDF before running parser.
   - Verifies manifest `source_sha256` exactly matches Node-computed SHA-256.
   - Bounded reading before `readFile()`: inspects output directory file count (must equal `page_count + 1`), manifest file size ($\le 64$ KB), and per-page JSON size ($\le 1.5$ MB). Rejects deviations with `PARSER_OUTPUT_INVALID`.
   - Semantic verification: validates per-page text SHA-256, Unicode code points (`[...text].length`), classification invariants, aggregate page counters, and pipeline version before persisting to database.

6. **Worker Lease Fencing & Concurrency Control (`claim_token UUID`)**:
   - `document_processing_runs` tracks `claimed_by TEXT`, `claim_token UUID`, and `lease_expires_at TIMESTAMPTZ`.
   - `claim_next_processing_run(p_worker_id, p_lease_seconds)` uses `FOR UPDATE SKIP LOCKED`, generates a fresh `claim_token = gen_random_uuid()`, sets `lease_expires_at = NOW() + INTERVAL` (default 900s, range 1–3600s), and recovers expired leases (`lease_expires_at < NOW()`).
   - `persist_processing_run_results_privileged` and `fail_processing_run_privileged` require `status = 'RUNNING' AND claim_token = p_claim_token AND (lease_expires_at IS NULL OR lease_expires_at > NOW())`. Expired leases immediately revoke write authority and raise SQL exception 55000 even if no competing worker has reclaimed the row.

7. **Bounded Retries & Terminal Semantics**:
   - Max 3 attempts enforced (`attempt_count >= maxRetries`).
   - Terminal failure status `FAILED_FINAL` cannot be re-enqueued or claimed.
   - Non-retryable errors (`PDF_ENCRYPTED`, `PDF_CORRUPT`, `PDF_ZERO_PAGES`, `PDF_PAGE_COUNT_EXCEEDED`, `PREFLIGHT_FAILED`, `PAGE_DIMENSION_EXCEEDED`, `PAGE_PIXEL_AREA_EXCEEDED`, `PARSER_RESOURCE_LIMIT`, `PARSER_INTERNAL_ERROR`, `OCR_UNAVAILABLE`, `OCR_FAILED`, `PARSER_OUTPUT_INVALID`, `DOCUMENT_ARCHIVED`, `SOURCE_MISSING`, `WORKER_INTERNAL_ERROR`) transition immediately to `FAILED_FINAL`.
   - Hard child process timeouts (`-1`) are classified immediately as `PARSER_TIMEOUT` (`p_retryable: true`) before manifest inspection via `classifyParserOutcome`.
   - UI renders "Error no recuperable" badge for `FAILED_FINAL` and restricts "Reintentar" button strictly to `FAILED_RETRYABLE`.
   - "Procesar" button rendered for `READY` documents without runs (auto-enqueue failure recovery).

8. **Authoritative Storage Download Error Classification**:
   - Confirmed missing blob (`NoSuchKey` / `ObjectNotFound` / 404 with confirmed key error) fails as `SOURCE_MISSING` (`FAILED_FINAL`).
   - Bucket-level errors (`NoSuchBucket`), 5xx, or network errors fail as `STORAGE_UNAVAILABLE` (`FAILED_RETRYABLE`).

9. **Archive vs Processing Race Closure**:
   - `archive_document_privileged` cancels active runs (`FAILED_FINAL`, `DOCUMENT_ARCHIVED`), clears `claim_token`, and deletes derived `document_pages`.
   - `persist_processing_run_results_privileged` denies persist if `documents.archived_at IS NOT NULL`.

10. **Database Schema, Composite Foreign Keys & RLS (`20260920100000_document_processing_runs_and_pages.sql`)**:
    - `document_processing_runs`: `UNIQUE (id, document_id, user_id)` constraint.
    - `document_pages`: Composite foreign key `(processing_run_id, document_id, user_id) REFERENCES document_processing_runs(id, document_id, user_id) ON DELETE CASCADE`.
    - Cryptographically prevents cross-tenant or mismatched page insertions at the schema level.
    - RLS: `SELECT` permitted only to `auth.uid() = user_id`. All direct `INSERT`, `UPDATE`, `DELETE` operations are REVOKED from `authenticated` and `anon`.

---

## 2. File Changes

### Important Files Created
- `requirements-parser.txt` — Pinned Python dependencies (`pypdfium2==5.13.0`, `pillow==12.3.0`, `pytesseract==0.3.13`).
- `src/config/processing-limits.ts` — Centralized processing limits, dimension bounds (5000 pt), and resource budgets.
- `src/modules/documents/processing-types.ts` — Zod schemas, domain types, 13 parser error codes, and 7 worker/database error codes (20 total).
- `src/parsers/document_parser.py` — Python parser CLI for qpdf preflight (64 KB cap), PDFium text extraction, and Tesseract OCR with `--config` support.
- `src/workers/documents-worker.ts` — TypeScript worker orchestrator, claim fencing, write revocation, bounded reads, `classifyParserOutcome`, semantic provenance verification, and bounded temp cleanup.
- `supabase/migrations/20260920100000_document_processing_runs_and_pages.sql` — Database migration for runs, pages, composite FKs, claim tokens, lease bounds, write revocation, and privileged RPCs.
- `supabase/tests/database/04_processing_runs_rls.sql` — 54 pgTAP assertions for processing runs, pages, claim fencing, terminal retry semantics, lease bounds, and expired/null lease write revocation.
- `tests/fixtures/generate_phase_1d_fixtures.py` — Fixture generator for synthetic test PDFs.
- `tests/fixtures/mock_corrupt_parser.py` — Fixture parser for corrupt page JSON test ([PROC-29]).
- `tests/unit/parser.test.ts` — Unit test suite for parser subprocess, config validation, dimension/pixel limits, `classifyParserOutcome`, and monkeypatched OCR timeout classification (36 tests).
- `tests/unit/provenance.test.ts` — Unit test suite for trusted Node orchestrator semantic provenance verification (8 tests).
- `tests/integration/processing-worker.test.ts` — Integration test suite for worker, adversarial lease fencing, write revocation, storage error classification, archive race closure, blank page handling, crashed run maintenance, and retry idempotency (17 tests).
- `tests/e2e/document-processing.spec.ts` — Playwright E2E test for processing UI lifecycle, legitimate retry flow on failed run, and auto-enqueue recovery (2 tests).
- `docs/reports/phase-01d-failure-matrix.md` — 37-scenario security and failure matrix with verified citations and complete 20-code error taxonomy.
- `docs/reports/phase-01d-processing.md` — Standardized execution report.

### Important Files Modified
- `package.json` — Added `worker:documents` script using `tsx --conditions=react-server --env-file=.env.local`.
- `.gitignore` — Added `.venv/`, `tools/`, `temp/`, and `__pycache__/`.
- `src/modules/documents/types.ts` — Added `processing_run` to `DocumentWithSubject`.
- `src/modules/documents/service.ts` — Safe auto-enqueue error inspection, retry error handling, and centralized pipeline version.
- `src/modules/documents/actions.ts` — Added `retryDocumentProcessingAction` and `processDocumentAction`.
- `src/components/documents/document-library.tsx` — Updated status badges, terminal failure badge, and "Procesar" / "Reintentar" actions.
- `src/types/database.ts` — Regenerated database types.
- `docs/status.md` — Updated project status snapshot.
- `docs/architecture/document-pipeline.md` — Completely rewritten to match implemented architecture, distinguishing IMPLEMENTED, DEFERRED, and DEPLOYMENT GATE.
- `docs/security/threat-model.md` — Updated decompression bomb threat row with honest resource limits and deployment gate markers.
- `scripts/create-review-package.ps1` — Added `requirements-parser.txt` staging, raw smoke evidence logs, single-quoted Tesseract labels, `git ls-files` repository tree, and Phase 1D check definitions.

---

## 3. Architecture & Subsystem Impact

- **Architecture Decisions**:
  - Two-tier processing architecture: High-privilege Node.js orchestrator manages DB/Storage and spawns unprivileged Python parser child whose environment does not inherit application credentials.
  - Zero secrets passed to parser: The parser child cannot leak credentials even under adversarial PDF execution. Application credentials are not inherited through the parser child-process environment.
  - Subprocess preflight via `qpdf` separates structural validation from PDFium parsing, with diagnostic output strictly bounded to 64 KB.
  - Claim fencing via `claim_token UUID` and PostgreSQL `FOR UPDATE SKIP LOCKED` guarantees single-worker job claims, lease recovery ($900s > 600s$), and immediate write revocation on expired leases.
  - Semantic provenance verification in trusted Node layer ensures untrusted parser cannot falsify hashes, character counts, or page classifications.
  - Bounded reading of parser output prevents memory exhaustion from untrusted child processes before `readFile()`.
  - Database-enforced composite FK `(processing_run_id, document_id, user_id)` guarantees page ownership integrity.
  - Idempotent page storage: Re-running processing replaces previous page records within a transaction.
- **Cost Impact**: $0.00 (all processing executed locally on device).

---

## 4. Security & Compliance Review

- **Subprocess Isolation**: Application credentials are not inherited through the parser child-process environment. `createSafeParserEnvironment()` strips all application secrets (`SUPABASE_*`, `DATABASE_URL`, AI keys, auth tokens). Note: stripped environment provides process credential isolation, not an OS sandbox; full OS sandboxing is a deployment gate.
- **Tenant Isolation**: RLS enforces `auth.uid() = user_id` on all tables. Composite FKs enforce tenant boundaries at schema level.
- **Claim Token Fencing & Write Revocation**: Stale workers cannot mutate or overwrite active runs after lease expiration. `persist_processing_run_results_privileged` and `fail_processing_run_privileged` reject expired or null leases with SQL exception 55000.
- **Input Sanitization & Resource Budgets**: Hard limits on page count (300), single-axis dimension (5000 pt), page pixels (12M), OCR pages (60), character counts (100k/page, 3M/doc), and timeouts (preflight 10s, OCR 20s, parser process 600s, worker lease 900s).
- **Prompt Injection**: Preserved as inert string data; never evaluated as code or system instructions.
- **Temporary File Security**: Ephemeral directories isolated per job in `os.tmpdir()` and cleaned up via best-effort bounded cleanup on every exit path with bounded retries; residual Windows locking logged as operational warning.

---

## 5. Verification & Quality

- **Quality Gates Executed**:
  - `pnpm install --frozen-lockfile` -> Exit Code 0 (PASS)
  - `pnpm format:check` -> Exit Code 0 (PASS)
  - `pnpm lint` -> Exit Code 0 (PASS)
  - `pnpm typecheck` -> Exit Code 0 (PASS)
  - `pnpm test` -> Exit Code 0 (PASS, 184 tests across 13 test files: 140 unit, 44 integration)
  - `pnpm db:reset` -> Exit Code 0 (PASS, migrations applied cleanly)
  - `pnpm db:types` -> Exit Code 0 (PASS, database types regenerated)
  - `pnpm db:test` -> Exit Code 0 (PASS, 244 pgTAP tests across 4 suites: 54 in `04_processing_runs_rls.sql`)
  - `pnpm build` -> Exit Code 0 (PASS, production build)
  - `pnpm test:e2e` -> Exit Code 0 (PASS, 18 Playwright tests across 6 suites)
  - `pnpm audit` -> Exit Code 0 (PASS, 0 vulnerabilities)
- **Local Binaries & Smoke Evidence**:
  - `tesseract --version`: `v5.5.3.20260724` (leptonica-1.87.0)
  - `tesseract --list-langs`: `eng`, `spa` present
  - `qpdf --version`: `12.4.1`
  - `python --version`: `3.14.7`
- **Zero Secrets**: Automated scan confirms no secrets or credentials committed.

---

## 6. Deviations, Issues & Debt

- **Deviations from Specification**: None. All Phase 1D external review corrections fulfilled.
- **Known Issues**: None.
- **Blockers**: None.
- **Technical Debt Knowingly Introduced**: None.

---

## 7. Next Steps & Readiness

- **Git Status**: All changes committed on `phase/01d-processing`.
- **Review Package**: `review-output/phase-01d-review.zip` generated on committed HEAD.
- **Recommended Next Step**: Complete review, then merge `phase/01d-processing` into `main` and proceed to **Phase 1E — Deterministic Chunking & Study Pack Generation**.
- **READY_FOR_EXTERNAL_REVIEW**: YES
