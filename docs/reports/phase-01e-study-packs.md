# Execution Report: Phase 1E — Deterministic Chunking, Evidence Layer & Study Pack Generation

- **Phase / Task**: Phase 1E — Deterministic Chunking, Evidence Layer & Study Pack Generation
- **Status**: COMPLETE
- **Mode**: LOCAL-FIRST
- **Branch**: `phase/01e-study-packs`
- **LOCAL HEAD SHA BEFORE REPORT**: `235b65ca10db054a7ffc50fa0dea4126f136b392`
- **Review Package**: `review-output/phase-01e-review.zip`
- **Review Target**: Phase 1E committed checkpoint on `phase/01e-study-packs`
- **Canonical Commit SHA**: Exact commit SHA is captured in `review-output/phase-01e-review.zip` (`REVIEW.md` and `test-results/*.log`).
- **Objective**: Implement deterministic page-bounded document chunking, an evidence-grounded Study Pack generation pipeline, a thin AI provider abstraction with zero-cost local testing, a deterministic citation validator enforcing server-derived page provenance, strict QA quality gates, lease-fenced worker orchestration, and scientific presentation UI with display-only page citation badges (`Pag. X`) and coverage disclosure at $0.00 cloud spend.

> **Note on SHA Semantics**: Committed reports record the commit SHA of implementation prior to report generation (`LOCAL HEAD SHA BEFORE REPORT`). Committed reports do not contain their own final commit SHA to prevent self-referential commit loops. The final local HEAD SHA is printed in the final agent chat output after all report/status files are committed locally.

---

## 1. Work Completed

1. **Canonical Page-Bounded Chunking Engine (`src/modules/study-packs/chunking.ts`)**:
   - Chunks strictly respect physical PDF page boundaries (single `document_page_id`, `page_number`, `start_char`, `end_char`). Chunks **never** span multiple pages, eliminating cross-page provenance ambiguity.
   - Text is partitioned into 1800 character targets (max 2800 characters) with 200 character sliding overlap, respecting paragraph and sentence breaks.
   - Deterministic indexing (`chunk_index` 0..N per document) and character/token estimation.
   - Database UUID refetching: `createOrGetDocumentChunks` persists chunks via `create_document_chunks_privileged` and immediately refetches their database primary keys (`id UUID`), ensuring downstream citation records have valid target UUID foreign keys.
   - Zero-vector architecture: chunking requires no embeddings and no `pgvector` dependencies in Phase 1E.

2. **Database Schema, Composite Foreign Keys & RLS (`supabase/migrations/20260920200000_chunks_and_study_packs.sql`)**:
   - `public.document_chunks`: Stores page-bounded chunks with composite foreign key `(document_id, user_id) REFERENCES documents(id, user_id) ON DELETE CASCADE` and unique constraint `(document_id, chunk_index)`.
   - `public.study_packs`: Tracks Study Pack lifecycle (`PENDING`, `GENERATING`, `READY`, `FAILED_RETRYABLE`, `FAILED_FINAL`), lease fencing (`claim_token UUID`, `claimed_by TEXT`, `lease_expires_at TIMESTAMPTZ`), authoritative page counts (`source_page_count`, `evidence_page_count`), and composite ownership `(id, document_id, user_id)`. QA evaluation is enforced before persistence (QA failure transitions pack to `FAILED_FINAL` with `error_code = 'STUDY_PACK_EVIDENCE_QA_FAILED'`). Distinct page count `evidence_page_count` is strictly database-authoritative via `COALESCE(v_calculated_evidence_pages, 0)` in `persist_study_pack_results_privileged`, ignoring any caller override.
   - `public.study_pack_items`: Stores structured study content by item type (`SUMMARY`, `LEARNING_OBJECTIVE`, `KEY_CONCEPT`, `HIGH_YIELD_POINT`, `KEY_TERM`) with JSONB payload and composite foreign key `(study_pack_id, user_id) REFERENCES public.study_packs(id, user_id) ON DELETE CASCADE`. Unsupported items are filtered out before persistence.
   - `public.study_pack_item_citations`: Links study items to chunks with composite FKs `fk_study_pack_item_citations_item FOREIGN KEY (study_pack_item_id, study_pack_id, user_id) REFERENCES public.study_pack_items(id, study_pack_id, user_id) ON DELETE CASCADE` and `fk_study_pack_item_citations_chunk FOREIGN KEY (document_chunk_id, user_id) REFERENCES public.document_chunks(id, user_id) ON DELETE CASCADE`.
   - `public.ai_usages`: Logs fine-grained AI consumption telemetry (`input_tokens`, `output_tokens`, `cached_tokens`, `estimated_cost_usd` to 6 decimal places, `latency_ms`, `status`) with PostgreSQL 17 column-specific composite FKs: `ON DELETE SET NULL (document_id)` and `ON DELETE SET NULL (study_pack_id)`, preserving user telemetry records and `user_id` when documents or packs are deleted.
   - Strict Row Level Security: Direct mutations (`INSERT`, `UPDATE`, `DELETE`) on all Phase 1E tables are REVOKED from `authenticated` and `anon`. Read access (`SELECT`) is strictly bounded by `auth.uid() = user_id`.
   - Privileged RPCs (callable only by `service_role`): `create_document_chunks_privileged`, `enqueue_study_pack_privileged` (with `pg_advisory_xact_lock` and `ON CONFLICT DO NOTHING` convergence), `claim_next_study_pack`, `persist_study_pack_results_privileged`, `fail_study_pack_privileged` (refunding attempts on operational failures `AI_DISABLED` and `AI_NOT_CONFIGURED`), `record_ai_usage_privileged`. Updated `archive_document_privileged` to cascade clean study packs.
   - 82 pgTAP assertions in `supabase/tests/database/05_chunks_and_study_packs_rls.sql` (327 total passing DB tests across 5 test suites).

3. **Thin `AIProvider` Abstraction, Bound Retries & Cost Engine (`src/modules/ai/`)**:
   - Thin internal TypeScript abstraction (`AIProvider`) defining a single domain method: `generateStructured<T>(request: AIStructuredRequest<T>, context?: AIRequestContext): Promise<AIStructuredResult<T>>`.
   - `MockAIProvider` (`src/modules/ai/mock-provider.ts`): MockAIProvider is a deterministic structural/test provider with simulated token telemetry and $0.00 spend. It makes no factual grounding or medical accuracy claim unless a specific scripted test constructs grounded output. Powers 100% of automated unit tests, integration tests, E2E tests, and benchmark runs.
   - `OpenAICompatibleProvider` (`src/modules/ai/openai-compatible-provider.ts`): Production-ready adapter supporting OpenAI and OpenAI-compatible gateways (LiteLLM, Ollama, vLLM) with JSON Schema structured outputs.
   - Provider Factory (`src/modules/ai/provider-factory.ts`):
     - Unconditional production mock denial: `MockAIProvider` is strictly and unconditionally prohibited in production under any configuration or bypass flag (`NODE_ENV === "production"`).
     - Fail-closed endpoint validation: requires non-empty model, non-empty API key, explicit `baseURL` for all non-OpenAI providers, and enforces HTTPS in production (permitting HTTP only for localhost in development).
     - Preflight assertion `assertAIGenerationAvailable()`: zero-network check prevents queueing or row creation when AI is disabled.
   - Bound Provider Retries: Explicitly configured `maxProviderRetries: 0` in `STUDY_PACK_WORKER_LIMITS` for both CALL 1 and CALL 2, preventing AI SDK internal retries. Each worker attempt makes at most 2 external provider calls (max 6 across 3 worker attempts).
   - Pricing Engine (`src/modules/ai/pricing.ts`): Models input, output, and cached token pricing snapshots. Accurately calculates cached token discounts: `uncachedInput = Math.max(0, inputTokens - cachedTokens)`. Pinned pricing for `gpt-4o`, `gpt-4o-mini`, and embedding models.
   - Telemetry Recorder (`src/modules/ai/telemetry.ts`): Safely records AI usage; automatically skips database writes when `context.feature === 'BENCHMARK'` or when `userId` is absent, preventing foreign key violations during synthetic benchmark runs.

4. **Study Pack Generation Service, Deduplicated Evidence Verifier & Safe Error Mapping (`src/modules/study-packs/`)**:
   - Two-call LLM generation architecture:
     - **Call 1 (Candidate Generation)**: LLM receives untrusted document chunks serialized as structured JSON data blocks and outputs candidate sections (Summary, Objectives, Concepts, High-Yield Points, Key Terms) with candidate chunk IDs. Enforces `maxTokens` (4096), `maxRetries: 0`, and timeout via `AbortSignal`.
     - **Call 2 (Evidence-Support Verification)**: Evaluates candidate claims against cited chunk text, classifying each claim as `SUPPORTED` or `UNSUPPORTED`.
   - Evidence Deduplication & Verifier Input Bound:
     - Candidate items in Call 2 reference only `citedChunkIds`.
     - An `evidence` array provides the unique union of cited chunks serialized once, eliminating $O(\text{items} \times \text{chunks})$ repetition.
     - Strict preflight input bound: `maxVerifierInputChars = 180_000` (`STUDY_PACK_BUDGET_LIMITS.maxVerifierInputChars`). If serialized prompt exceeds this bound, the verifier immediately throws `STUDY_PACK_INPUT_LIMIT` before invoking the provider ($0.00 spend).
   - Citation Validator (`src/modules/study-packs/citation-validator.ts`):
     - The AI model is **never** trusted to provide page numbers. The model outputs only candidate `chunk_id` values; the server maps valid IDs to their authoritative database `page_number` from `document_chunks`.
     - Cross-document citations and hallucinated chunk IDs (chunks not belonging to the document, run, user, or chunking version) are strictly rejected.
   - Evidence Verifier & Strict QA Quality Gate (`src/modules/study-packs/evidence-verifier.ts`):
     - Unsupported claims are stripped from the pack.
     - A generated pack is approved only if:
       - $\ge 1$ General Summary paragraph
       - $\ge 1$ Learning Objective
       - $\ge 1$ Key Concept
       - $\ge 50\%$ of candidate claims verified as `SUPPORTED`.
     - If these thresholds are not met, the pack transitions to `FAILED_FINAL` (`STUDY_PACK_EVIDENCE_QA_FAILED`), reducing unsupported-content risk and ensuring only items passing automated evidence-support verification are persisted.
   - Safe Server Actions & Error Sanitization (`src/modules/study-packs/actions.ts`, `errors.ts`):
     - Complete 19-code error taxonomy mapped through `toPublicStudyPackError()`.
     - Zero internal leakage: database error messages, connection strings, URLs, and stack traces are never exposed to the client; sanitized Spanish error messages returned.
     - `requestStudyPackGenerationAction` and `getStudyPackAction` return typed `ActionResult` with `code` and safe `error`.

5. **Dedicated Background Worker Orchestrator (`src/workers/study-packs-worker.ts`)**:
   - Queue coordination via PostgreSQL `claim_next_study_pack` (`FOR UPDATE SKIP LOCKED`) with fencing token `claim_token UUID` and lease expiration `lease_expires_at` (default: 300s).
   - Lease fencing: `persist_study_pack_results_privileged` and `fail_study_pack_privileged` require an active non-null lease (`lease_expires_at > NOW()`). Expired or missing leases immediately revoke write authority (PostgreSQL raises SQLSTATE 55000).
   - Archive race closure: checks if the source document was archived during execution and terminally aborts with `DOCUMENT_ARCHIVED` (`FAILED_FINAL`), deleting derived study items and citations.
   - Bounded retries: enforces max 3 attempts before transitioning to `FAILED_FINAL` (`STUDY_PACK_RETRY_LIMIT`).
   - Non-retryable Worker Internal Errors: Unknown non-`AIProviderError` exceptions map to `WORKER_INTERNAL_ERROR` with `retryable: false`, failing fast to prevent infinite retry loops.
   - Version contract verification: worker verifies job versions match `CHUNKING_VERSION`, `STUDY_PACK_GENERATION_VERSION`, and `STUDY_PACK_PROMPT_VERSION` or fails terminally with `STUDY_PACK_VERSION_UNSUPPORTED`.

6. **Scientific Presentation UI Layer (`src/components/study-packs/study-pack-view.tsx`, `src/app/app/documents/[id]/study-pack/page.tsx`)**:
   - Scientific presentation interface organizing content into 5 structured sections: Resumen (Summary), Objetivos de Aprendizaje, Conceptos Clave, Puntos Clave de Repaso (High-Yield), and Glosario de Términos Clave. Puntos clave are described as concepts highlighted in the material as key points for review.
   - Display-only citation badges (`Pag. X`): displays verified page numbers derived by server from canonical chunk relations with source backing disclosure.
   - Educational Clinical Disclaimer Banner: displays prominent advisory ("Material generado como asistencia de estudio. Siempre verifique con las fuentes primarias y criterios clínicos.").
   - Coverage & Provenance Disclosure Panel: displays total verified items, supported claim percentage, and page coverage as "Páginas con evidencia textual: X de Y", where X is `evidencePageCount` and Y is authoritative `sourcePageCount`.
   - React plain-text escaping: all text content is rendered via native React string interpolation with zero `dangerouslySetInnerHTML`, ensuring untrusted medical text cannot execute XSS payloads.
   - Document Library Integration (`src/components/documents/document-library.tsx`): displays live Study Pack lifecycle status badges ("Sin Study Pack", "Generando Study Pack...", "Study Pack Listo", "Error Study Pack") and manual CTA navigation buttons.
   - HTML5 / React Hydration Fix: modified `src/components/ui/badge.tsx` to render `<span>` instead of `<div>`, eliminating React hydration mismatch errors when citation badges are nested inside `<p>` paragraphs.

7. **Opt-In Synthetic Medical Lecture Benchmark Harness (`src/benchmarks/study-pack-benchmark.ts`)**:
   - Evaluates study pack generation pipelines against 5 realistic medical lecture fixtures in `tests/fixtures/benchmark/`:
     - `bench-anat-01.json`: Cranial nerves and brainstem neuroanatomy.
     - `bench-phys-02.json`: Cardiac cycle, pressures, and Wiggers diagram concepts.
     - `bench-pharm-03.json`: Beta-lactams, macrolides, and resistance mechanisms.
     - `bench-path-04.json`: Obstructive vs. restrictive lung diseases.
     - `bench-biling-05.json`: Mixed Spanish-English clinical slide terminology.
   - Clear separation of (A) Mode A Mock Pipeline Smoke ($0.00 spend, structural mechanics check, zero external calls) vs. (B) Mode B Live Model Benchmark.
   - Default execution is strictly and deterministically Mode A Mock Smoke ($0.00 spend). Live execution requires explicit `--live` or `AI_BENCHMARK_LIVE=true`.
   - Live benchmark calculates automated evidence-support ratio from verifier metrics; mock mode reports N/A (structural invariants only) to avoid misleading gold-standard claims.
   - Verifies structural pipeline mechanics across all 5 fixtures with 0 errors, 0 warnings, and $0.00 automated spend (`pnpm ai:benchmark:study-pack`).

8. **Automated Test Suite (100% Pass)**:
   - 284 Vitest tests passing across 19 test files (228 unit, 56 integration via `pnpm test`).
   - 327 pgTAP database tests passing across 5 test files (`pnpm db:test`, 82 assertions in `05_chunks_and_study_packs_rls.sql`).
   - 19 Playwright E2E tests passing across 7 suites (`pnpm test:e2e`), including `tests/e2e/study-packs.spec.ts` validating full upload -> document processing -> manual study pack trigger -> worker execution -> verified study pack UI render -> library badge verification, with screenshot captured at `docs/screenshots/phase-01e-study-pack-view.png`.

---

## 2. File Changes

### Important Files Created
- `src/config/study-pack-limits.ts` — Centralized resource limits for study pack generation (tokens, timeouts, thresholds, max provider retries = 0, max verifier input chars = 180,000).
- `src/modules/ai/types.ts` — Thin `AIProvider` interface, completion options, and telemetry types.
- `src/modules/ai/pricing.ts` — Model pricing snapshot and cost calculation with cached token discounting.
- `src/modules/ai/telemetry.ts` — AI telemetry database recorder with benchmark exclusion.
- `src/modules/ai/mock-provider.ts` — Deterministic test AI provider ($0.00 spend) for unit/integration/e2e tests.
- `src/modules/ai/openai-compatible-provider.ts` — Production-ready OpenAI-compatible LLM client with JSON Schema structured outputs.
- `src/modules/ai/provider-factory.ts` — Safe provider factory selecting `MockAIProvider` in test environments.
- `src/modules/ai/index.ts` — Public export barrel for AI module.
- `src/modules/study-packs/types.ts` — Domain types, Zod schemas, section types, and 19 error codes.
- `src/modules/study-packs/errors.ts` — Safe public error mapper `toPublicStudyPackError(err)` for all 19 error codes with localized Spanish user messages, preventing leakage of internal DB messages, connection URLs, or stack traces.
- `src/modules/study-packs/chunking.ts` — Canonical page-bounded chunking engine with DB UUID refetching.
- `src/modules/study-packs/citation-validator.ts` — Citation validator enforcing server-derived page provenance.
- `src/modules/study-packs/evidence-verifier.ts` — Two-call verification pipeline with candidate-evidence deduplication, input length bounding (`maxVerifierInputChars = 180_000`), and strict QA quality gate.
- `src/modules/study-packs/service.ts` — Domain service for chunk creation, enqueueing, and retrieval.
- `src/modules/study-packs/actions.ts` — Authenticated Server Actions for manual generation CTA and retrieval with sanitized error mapping.
- `src/modules/study-packs/index.ts` — Public export barrel for study packs module.
- `src/workers/study-packs-worker.ts` — Background worker orchestrator with lease fencing and retry management.
- `src/components/study-packs/study-pack-view.tsx` — Scientific presentation UI with display citation badges (`Pag. X`) and coverage disclosure.
- `src/app/app/documents/[id]/study-pack/page.tsx` — Protected Server Component page for Study Pack viewing.
- `src/benchmarks/study-pack-benchmark.ts` — Developer benchmark CLI harness (`pnpm ai:benchmark:study-pack`).
- `supabase/migrations/20260920200000_chunks_and_study_packs.sql` — Database migration for chunks, study packs, items, citations, and AI usages.
- `supabase/tests/database/05_chunks_and_study_packs_rls.sql` — 82 pgTAP assertions for chunk and study pack security (including database-authoritative evidence_page_count verification).
- `tests/fixtures/benchmark/*.json` — 5 synthetic medical lecture fixtures.
- `tests/unit/chunking.test.ts` — Unit test suite for canonical chunking engine (16 tests).
- `tests/unit/ai-provider.test.ts` — Unit test suite for AI provider, pricing, retries, and telemetry (19 tests).
- `tests/unit/citation-validator.test.ts` — Unit test suite for citation validation (5 tests).
- `tests/unit/evidence-verifier.test.ts` — Unit test suite for evidence verification, deduplication, and QA gate (7 tests).
- `tests/unit/study-packs-actions.test.ts` — Unit test suite for Server Action error sanitization across all 19 error codes (9 tests).
- `tests/integration/study-packs-worker.test.ts` — Integration test suite for worker claim fencing, write revocation, archive race closure, cached reads, and database-authoritative evidence_page_count (12 tests).
- `tests/e2e/study-packs.spec.ts` — Playwright E2E test suite for full study pack generation and UI rendering (1 test).
- `docs/reports/phase-01e-failure-matrix.md` — Complete failure matrix covering 19 error codes and 38 failure scenarios.
- `docs/screenshots/phase-01e-study-pack-view.png` — E2E screenshot evidence of rendered Study Pack view.

### Important Files Modified
- `src/components/documents/document-library.tsx` — Integrated Study Pack status badges and manual generation CTA button.
- `src/components/ui/badge.tsx` — Changed root element from `<div>` to `<span>` to prevent HTML5 paragraph nesting violations.
- `src/config/server-env.ts` — Added `AI_PROVIDER`, `AI_API_KEY`, `AI_BASE_URL`, and `AI_MODEL` environment definitions with safe fallbacks.
- `src/modules/documents/service.ts` — Updated document retrieval to include Study Pack status and item counts.
- `src/modules/documents/types.ts` — Added Study Pack metadata fields to document library types.
- `src/types/database.ts` — Regenerated Supabase database types including all Phase 1E tables and RPCs.
- `package.json` — Added scripts: `worker:study-packs` (supports `--once` flag) and `ai:benchmark:study-pack` (defaults to deterministic $0 Mock Smoke; live benchmark requires `--live` or `AI_BENCHMARK_LIVE=true`).
- `docs/status.md` — Updated project snapshot, subsystem matrix, and risk posture for Phase 1E.
- `docs/security/threat-model.md` — Updated threat mitigations for prompt injection, AI cost abuse, and XSS.
- `docs/architecture/document-pipeline.md` — Documented canonical chunking engine and study pack worker pipeline.
- `docs/architecture/rag.md` — Documented Phase 1E evidence layer, citation validator, and evidence verifier.
- `docs/architecture/ai-architecture.md` — Documented thin AIProvider abstraction, telemetry, pricing, and benchmark harness.
- `docs/architecture/data-model.md` — Updated DDL schemas for chunks, study packs, items, citations, and AI usages.
- `docs/product/mvp-definition.md` — Updated MVP roadmap marking Slice 1E COMPLETE.

---

## 3. Architecture & Subsystem Impact

- **Architecture Decisions**:
  - Implemented thin `AIProvider` abstraction decoupled from heavy agentic frameworks (LangChain, LlamaIndex).
  - Adopted deterministic-first policy: non-generative tasks (token math, pricing, citation validation, page mapping, lease management) remain 100% deterministic code.
  - Page-bounded canonical chunking: chunks strictly respect physical PDF page boundaries (single `document_page_id`, `page_number`, `start_char`, `end_char`).
  - Zero-vector architecture for Phase 1E: embeddings and `pgvector` hybrid search deferred to Phase 1F (Tutor RAG).
- **Database Impact**:
  - Migration `20260920200000_chunks_and_study_packs.sql` applied cleanly.
  - 5 new tables: `document_chunks`, `study_packs`, `study_pack_items`, `study_pack_item_citations`, `ai_usages`.
  - Composite foreign keys guarantee tenant isolation: all child records reference `(document_id, user_id)` or `(study_pack_id, document_id, user_id)`.
  - Direct mutations REVOKED from authenticated/anon; privileged RPCs control all queue mutations.
- **API Impact**:
  - Server actions `enqueueStudyPackAction` and `getStudyPackAction` added.
  - RPCs: `create_document_chunks_privileged`, `enqueue_study_pack_privileged`, `claim_next_study_pack`, `persist_study_pack_results_privileged`, `fail_study_pack_privileged`, `record_ai_usage_privileged`.
- **AI Impact**:
  - Two-call bounded LLM pipeline (candidate generation + evidence verification).
  - `MockAIProvider` enables 100% offline verification at $0.00 spend.
  - Telemetry recording tracks token usage and costs to 6 decimal places.
- **Background-Job Impact**:
  - Dedicated background worker `study-packs-worker.ts` with PostgreSQL `FOR UPDATE SKIP LOCKED` claim queue.
  - Lease fencing with SQLSTATE 55000 write revocation on expired or stolen leases.
- **Dependencies Introduced**:
  - Direct runtime dependencies added: `ai` (`7.0.107`, Apache-2.0) for structured generation and `@ai-sdk/openai-compatible` (`3.0.53`, Apache-2.0) for OpenAI-compatible transport. Both verified under permissive OSS licenses in `docs/engineering/dependencies.md`. (`pnpm audit` clean).

---

## 4. Security & Compliance Review

- **Security Review**:
  - Tenant Isolation: RLS enforced on all tables (`auth.uid() = user_id`); composite FKs reject cross-tenant references.
  - Direct Mutation Defense: All direct INSERT/UPDATE/DELETE revoked from client roles; mutations restricted to `service_role` RPCs.
  - Lease Fencing: Stale worker persists rejected with SQLSTATE 55000 if lease expires.
  - Archive Race Closure: Archiving document terminally cancels active study pack runs and clears claims.
  - XSS Defense: Untrusted medical document content rendered with React plain-text escaping; zero `dangerouslySetInnerHTML`.
  - Prompt Injection Defense: Untrusted document chunks serialized as structured JSON data blocks; prompt instructs model to treat evidence strictly as inert data.
- **Medical & Content Safety**:
  - Strict QA Quality Gate: Requires $\ge 1$ summary, $\ge 1$ objective, $\ge 1$ concept, and $\ge 50\%$ supported claims; ungrounded packs rejected as `STUDY_PACK_EVIDENCE_QA_FAILED`, reducing unsupported-content risk.
  - Server-Derived Provenance: AI model outputs only chunk IDs; server maps chunk IDs to database page numbers, preventing hallucinated page citations.
  - Educational Disclaimer: UI explicitly presents content for medical study preparation, not real-patient clinical decision-making.
  - PHI Audit: Zero patient data, credentials, or private keys committed.
- **Cost Abuse Deployment Gate**:
  - In Phase 1E (local development & testing), `AI_GENERATION_ENABLED=false` remains the fail-safe default, and mock provider usage is unconditionally prohibited in production environments.
  - Per-user generation quotas, daily attempt limits, provider-level cost circuit breakers, and rate limiters are strictly documented and enforced as mandatory deployment prerequisites before connecting live paid external AI endpoints.
- **Environment Variables**:
  - `AI_GENERATION_ENABLED` (default: `"false"`, strictly parsed boolean)
  - `AI_PROVIDER` (default: `""`, mock gated strictly to non-production and test)
  - `AI_MODEL` (default: `""`)
  - `AI_API_KEY` (optional, required only for live providers)
  - `AI_BASE_URL` (optional, required for all non-OpenAI live providers)
  - No secret values committed.

---

## 5. Verification & Quality

- **Tests / Checks Executed**:
  - `pnpm format:check` -> PASS (All matched files use Prettier code style)
  - `pnpm lint` -> PASS (0 warnings, 0 errors)
  - `pnpm typecheck` -> PASS (0 TypeScript errors)
  - `pnpm test` -> PASS (284 tests passing across 19 test files: 228 unit, 56 integration)
  - `pnpm db:reset` -> PASS (5 migrations applied cleanly)
  - `pnpm db:types` -> PASS (Types generated into `src/types/database.ts`)
  - `pnpm db:test` -> PASS (327 pgTAP tests passing across 5 test files, 82 assertions in `05_chunks_and_study_packs_rls.sql`)
  - `pnpm build` -> PASS (Production build successful with Next.js Turbopack)
  - `pnpm ai:benchmark:study-pack` -> PASS (Mode A Mock Smoke: 5/5 synthetic fixtures passed, 0 errors, automated evidence-support ratio reported as N/A, $0.00 cost)
  - `pnpm test:e2e` -> PASS (19 Playwright tests passing across 7 suites)
- **Browser Verification**:
  - Full E2E browser test executed via Playwright (`tests/e2e/study-packs.spec.ts`).
  - Document uploaded, processed, manual Study Pack triggered, worker executed, and verified Study Pack UI rendered cleanly.
  - Display citation badges verified, coverage panel verified, and library status badge confirmed.
  - Screenshot captured at `docs/screenshots/phase-01e-study-pack-view.png`.
- **Performance Impact**:
  - Chunking engine execution: $\le 5$ms for typical lecture slides.
  - Study Pack generation: bounded to two structured LLM calls.
  - Read performance: 100% cached reads from PostgreSQL; zero AI calls on page refresh.
- **Cost Impact**:
  - $0.00 external cloud spend. 100% of automated tests executed using local `MockAIProvider`.

---

## 6. Deviations, Issues & Debt

- **Deviations from Specification**: None. All requirements from Phase 1E specification implemented.
- **Known Issues**: None blocking.
- **Blockers**: None.
- **Technical Debt Knowingly Introduced**:
  - Embeddings & Vector Search: Deferred to Phase 1F (Tutor RAG). Chunks are indexed with lexical full-text search (`document_chunks.content`); vector embeddings will be generated in Phase 1F.
  - AI Tutor & Flashcards/FSRS: Explicitly deferred to subsequent vertical slices (1F and 1H) per MVP scope roadmap.

---

## 7. Next Steps & Readiness

- **Git Status**: Changes staged/tracked on `phase/01e-study-packs`. Working tree will be cleanly committed prior to packaging.
- **Recommended Next Step**:
  1. Complete local review package generation via `scripts/create-review-package.ps1`.
  2. Await external human review of `review-output/phase-01e-review.zip`.
  3. Upon approval, merge `phase/01e-study-packs` into `main` via squash merge.
  4. Proceed to **Phase 1F — Context-Grounded AI Tutor & Hybrid Vector Retrieval** (`phase/01f-tutor-rag`).
- **READY_FOR_EXTERNAL_REVIEW**: **YES**
