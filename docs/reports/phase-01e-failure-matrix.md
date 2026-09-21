# MedStudy Atlas — Phase 1E Failure Matrix

- **Phase**: Vertical Slice 1E — Deterministic Chunking, Evidence Layer & Study Pack Generation
- **Mode**: LOCAL-FIRST
- **Branch**: `phase/01e-study-packs`
- **Scope**: Canonical page-bounded chunking engine, evidence layer, two-call LLM generation and verification pipeline, deterministic citation validator, strict QA quality gates, worker queue lease fencing, idempotency convergence, fail-closed provider gating, and error taxonomy.

---

## 1. Complete Error Taxonomy (19 Canonical Error Codes)

The canonical source of truth for error codes is `STUDY_PACK_ERROR_CODES` in `src/modules/study-packs/types.ts`.

### Document & Chunking Error Codes (5)
| Error Code | Retryable? | Trigger / Description |
| :--- | :--- | :--- |
| `SOURCE_NOT_READY` | No | Source document status is not `READY` (e.g., still `PENDING`, `UPLOADING`, or `FAILED`). |
| `PROCESSING_NOT_SUCCEEDED` | No | Document processing run status is not `SUCCEEDED`. |
| `CHUNKS_NOT_READY` | No | No canonical chunks found for the document's processing run in `document_chunks`. |
| `CHUNK_PROVENANCE_INVALID` | No | Chunk offset bounds, character count, substring content, or SHA-256 hash failed provenance verification against the source document page. |
| `DOCUMENT_ARCHIVED` | No | Document was archived (`archived_at IS NOT NULL`) while study pack generation was enqueued or running. |

### AI Provider & Runtime Error Codes (6)
| Error Code | Retryable? | Trigger / Description |
| :--- | :--- | :--- |
| `AI_DISABLED` | **Yes (Operational / Recoverable)** | AI generation is disabled by the server kill switch (`AI_GENERATION_ENABLED=false`). In worker, transitions to `FAILED_RETRYABLE` without consuming attempt budget (refunded), enabling re-enqueue once re-enabled. |
| `AI_NOT_CONFIGURED` | **Yes (Operational / Recoverable)** | AI provider or API key is not configured in server environment, or Mock provider was invoked outside test/dev environment without authorization. Transitions to `FAILED_RETRYABLE` without consuming attempt budget. |
| `AI_RATE_LIMITED` | **Yes** | AI provider returned HTTP 429 (rate limited / quota exceeded). |
| `AI_TIMEOUT` | **Yes** | AI provider request exceeded execution timeout (60s default via AbortSignal). |
| `AI_PROVIDER_UNAVAILABLE` | **Yes** | Downstream provider 5xx server error, transient network disconnect, or malformed HTTP response. |
| `AI_PROVIDER_AUTH_ERROR` | No | Invalid API key, revoked credentials, or unauthorized AI endpoint access. |

### Evidence Layer & Quality Gate Error Codes (5)
| Error Code | Retryable? | Trigger / Description |
| :--- | :--- | :--- |
| `STUDY_PACK_INPUT_LIMIT` | No | Total evidence characters exceed budget limit (`maxEvidenceChars`: 100,000) or chunks exceed limit (`maxEvidenceChunks`: 80). |
| `STUDY_PACK_SCHEMA_INVALID` | **Yes** | Structured JSON response failed Zod schema validation (e.g., candidate or verification payload bounds violated). |
| `STUDY_PACK_CITATION_INVALID` | **Yes** | Citation validation failed (e.g., citation references an unknown chunk ID or cross-document chunk). |
| `STUDY_PACK_EVIDENCE_QA_FAILED` | No | Candidate pack failed automated evidence verification: less than 50% of claims verified as `SUPPORTED`, or missing mandatory sections. |
| `STUDY_PACK_VERSION_UNSUPPORTED` | No | Job contract version mismatch: chunking, generation, or prompt version does not match active worker constants. |

### Worker Orchestration & Lease Error Codes (3)
| Error Code | Retryable? | Trigger / Description |
| :--- | :--- | :--- |
| `STUDY_PACK_LEASE_EXPIRED` | **Yes** | Worker lease expired before persistence was committed; write authority revoked via claim token and lease fencing (SQLSTATE 55000). |
| `STUDY_PACK_RETRY_LIMIT` | No | Job exhausted the maximum allowed retry attempts (3) and was permanently transitioned to `FAILED_FINAL`. |
| `WORKER_INTERNAL_ERROR` | No | Unhandled internal worker error or unrecoverable processing exception. |

---

## 2. Failure Scenario Matrix

| ID | Scenario | Expected Result | Test Layer | Test Name / Evidence | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **PACK-01** | Cross-user `document_chunks` read | User B cannot SELECT User A document chunks; RLS enforces `auth.uid() = user_id` | Database (pgTAP) | `supabase/tests/database/05_chunks_and_study_packs_rls.sql` (`Isolation: Bob cannot view Alice chunks`) | **PASS** |
| **PACK-02** | Cross-user `study_packs` read | User B cannot SELECT User A study packs; RLS enforces `auth.uid() = user_id` | Database (pgTAP) | `supabase/tests/database/05_chunks_and_study_packs_rls.sql` (`Isolation: Bob cannot view Alice study packs`) | **PASS** |
| **PACK-03** | Cross-user `study_pack_items` read | User B cannot SELECT User A study pack items; RLS enforces `auth.uid() = user_id` | Database (pgTAP) | `supabase/tests/database/05_chunks_and_study_packs_rls.sql` (`Isolation: Bob cannot view Alice study pack items`) | **PASS** |
| **PACK-04** | Cross-user `study_pack_item_citations` read | User B cannot SELECT User A citations; RLS enforces `auth.uid() = user_id` | Database (pgTAP) | `supabase/tests/database/05_chunks_and_study_packs_rls.sql` (`Isolation: Bob cannot view Alice citations`) | **PASS** |
| **PACK-05** | Cross-user `ai_usages` read | User B cannot SELECT User A AI telemetry records; RLS enforces `auth.uid() = user_id` | Database (pgTAP) | `supabase/tests/database/05_chunks_and_study_packs_rls.sql` (`Isolation: Bob cannot view Alice ai_usages`) | **PASS** |
| **PACK-06** | Authenticated direct mutation on `document_chunks` | Denied with SQLSTATE 42501 (permission denied); direct table writes revoked | Database (pgTAP) | `supabase/tests/database/05_chunks_and_study_packs_rls.sql` (`Privilege: Authenticated INSERT/UPDATE/DELETE denied on document_chunks`) | **PASS** |
| **PACK-07** | Authenticated direct mutation on `study_packs` | Denied with SQLSTATE 42501; direct table writes revoked | Database (pgTAP) | `supabase/tests/database/05_chunks_and_study_packs_rls.sql` (`Privilege: Authenticated INSERT/UPDATE/DELETE denied on study_packs`) | **PASS** |
| **PACK-08** | Authenticated direct mutation on `study_pack_items` & citations | Denied with SQLSTATE 42501; direct table writes revoked | Database (pgTAP) | `supabase/tests/database/05_chunks_and_study_packs_rls.sql` (`Privilege: Authenticated INSERT/UPDATE/DELETE denied on study_pack_items and study_pack_item_citations`) | **PASS** |
| **PACK-09** | Authenticated call to privileged Study Pack RPCs | Denied with SQLSTATE 42501; executable strictly by `service_role` | Database (pgTAP) | `supabase/tests/database/05_chunks_and_study_packs_rls.sql` (`Privilege: Authenticated EXECUTE denied on 6 Phase 1E privileged RPCs`) | **PASS** |
| **PACK-10** | Composite FK enforcement on chunks & study packs | Rejects mismatched `(document_id, user_id)` and `(processing_run_id, document_id, user_id)` | Database (pgTAP) | `supabase/tests/database/05_chunks_and_study_packs_rls.sql` (`FK Integrity: document_chunks and ai_usages composite FK checks`) | **PASS** |
| **PACK-11** | Worker claim concurrency & SKIP LOCKED | Serialized via `FOR UPDATE SKIP LOCKED`; exactly one worker claims job, second receives null/empty | Integration (Vitest) | `tests/integration/study-packs-worker.test.ts` (`Worker Concurrency: Active leased job cannot be claimed by competing worker`) | **PASS** |
| **PACK-12** | Lease expiration & write authority revocation | Persist/fail RPCs reject expired leases (`lease_expires_at <= NOW()`) or null leases, raising SQLSTATE 55000 | Database & Integration | `supabase/tests/database/05_chunks_and_study_packs_rls.sql` & `tests/integration/study-packs-worker.test.ts` (`Write Revocation: Persist rejected when lease expired`) | **PASS** |
| **PACK-13** | Archive race closure during study pack run | If document is archived, active pack transitions to `FAILED_FINAL` (`DOCUMENT_ARCHIVED`), derived items deleted, and stale persist is blocked | Database & Integration | `supabase/tests/database/05_chunks_and_study_packs_rls.sql` & `tests/integration/study-packs-worker.test.ts` (`Archive Race Closure & Archive Cascade Deletion`) | **PASS** |
| **PACK-14** | Cached study pack read guarantee | Re-requesting or viewing an already generated study pack returns cached DB rows with zero AI calls ($0.00) | Integration (Vitest) | `tests/integration/study-packs-worker.test.ts` (`serves cached Study Pack with zero AI provider calls on subsequent reads`) | **PASS** |
| **PACK-15** | Terminal retry semantics & attempt budget | Max 3 attempts enforced; exceeding limit transitions run permanently to `FAILED_FINAL` (`STUDY_PACK_RETRY_LIMIT`) | Database & Integration | `supabase/tests/database/05_chunks_and_study_packs_rls.sql` & `tests/integration/study-packs-worker.test.ts` (`Retry Limit: Transitions to FAILED_FINAL after exhausting attempts`) | **PASS** |
| **PACK-16** | Deterministic page-bounded chunking | Chunks strictly respect physical PDF page boundaries (single `document_page_id`, `page_number`, `start_char`, `end_char`); target 1800 chars, max 2800 chars, 200 char overlap | Unit (Vitest) | `tests/unit/chunking.test.ts` (`never crosses page boundaries`, `enforces target chars`, `handles short/whitespace pages`) | **PASS** |
| **PACK-17** | Deterministic citation validation | Server derives `page_number` from chunk DB primary key; model cannot forge page numbers | Database & Unit | `supabase/tests/database/05_chunks_and_study_packs_rls.sql` & `tests/unit/citation-validator.test.ts` (`Citation Resolution: Server derives page_number from chunk join`) | **PASS** |
| **PACK-18** | Cross-document citation isolation | DB and validator reject citations pointing to chunks from another document or run | Database (pgTAP) | `supabase/tests/database/05_chunks_and_study_packs_rls.sql` (`Persist Integrity: Cross-document citation rejected`) | **PASS** |
| **PACK-19** | Strict QA gate rejection on weak grounding | Rejects packs with < 50% supported claims or missing mandatory sections (`STUDY_PACK_EVIDENCE_QA_FAILED`) | Unit (Vitest) | `tests/unit/evidence-verifier.test.ts` (`rejects packs with < 50% supported claims`) | **PASS** |
| **PACK-20** | AI Provider abstraction & pricing calculation | `pricing.ts` discounts cached tokens: `uncachedInput = Math.max(0, inputTokens - cachedTokens)`; calculates exact cost | Unit (Vitest) | `tests/unit/ai-provider.test.ts` (`calculates costs with cached token discount`, `records telemetry correctly`) | **PASS** |
| **PACK-21** | Benchmark telemetry exclusion | Benchmark feature (`context.feature === 'BENCHMARK'`) skips DB persistence to avoid user FK violations | Unit (Vitest) | `tests/unit/ai-provider.test.ts` (`skips telemetry DB insertion when feature is BENCHMARK`) | **PASS** |
| **PACK-22** | Synthetic medical lecture benchmark suite | Evaluates 5 synthetic medical lecture fixtures with Mode A Mock Smoke ($0.00 spend, structural mechanics check) | CLI / Harness | `src/benchmarks/study-pack-benchmark.ts` (`pnpm ai:benchmark:study-pack`) | **PASS** |
| **PACK-23** | React XSS injection defense | Prompt injection strings and clinical text rendered via React plain-text escaping; zero `dangerouslySetInnerHTML` | E2E & Component | `src/components/study-packs/study-pack-view.tsx` & `tests/e2e/study-packs.spec.ts` | **PASS** |
| **PACK-24** | HTML5 / React hydration valid markup | Shadcn `Badge` renders `<span>` instead of `<div>`, preventing DOM nesting violations inside `<p>` citation tags | Component & E2E | `src/components/ui/badge.tsx` & `tests/e2e/study-packs.spec.ts` | **PASS** |
| **PACK-25** | E2E Study Pack generation lifecycle UI | Full flow: upload -> process document -> trigger study pack -> worker -> view rendered sections and citations | E2E (Playwright) | `tests/e2e/study-packs.spec.ts` (`Study Pack Generation & Evidence View: generates and displays verified study pack`) | **PASS** |
| **PACK-26** | Concurrent generation enqueue convergence | Concurrent generation requests on the same document serialize via `pg_advisory_xact_lock` and converge on the same DB row via `ON CONFLICT DO NOTHING` | Integration (Vitest) | `tests/integration/study-packs-worker.test.ts` (`converges concurrent generation requests on the same document to the same study pack row`) | **PASS** |
| **PACK-27** | Zero-row preflight rejection when AI disabled | `assertAIGenerationAvailable()` runs before enqueue; trips fast without writing database rows or consuming attempt budget; succeeds cleanly when re-enabled | Integration (Vitest) | `tests/integration/study-packs-worker.test.ts` (`rejects generation preflight when AI is disabled without creating database rows, then succeeds when re-enabled`) | **PASS** |
| **PACK-28** | Operational failure safety (race condition) | If AI is disabled after enqueue, worker transitions job to `FAILED_RETRYABLE` and refunds the attempt (`attempt_count = 0`), remaining recoverable | Integration (Vitest) | `tests/integration/study-packs-worker.test.ts` (`transitions to FAILED_RETRYABLE without consuming attempt budget if AI is disabled after enqueue`) | **PASS** |
| **PACK-29** | Authoritative Source vs Evidence Page Coverage | `source_page_count` is authoritatively derived from processing run; `evidence_page_count` reflects distinct chunk pages; correctly reflects documents with `NO_TEXT` pages | Integration & Database | `tests/integration/study-packs-worker.test.ts` (`correctly records source_page_count and evidence_page_count when some pages have no text`) | **PASS** |
| **PACK-30** | Unconditional Mock Provider Denial in Production | In `NODE_ENV === "production"`, `MockAIProvider` is unconditionally rejected regardless of bypass flags or forced provider | Unit (Vitest) | `tests/unit/ai-provider.test.ts` (`production mock denial: unconditionally rejects MockAIProvider when NODE_ENV === 'production'`) | **PASS** |
| **PACK-31** | Fail-Closed AI Endpoint Validation | Non-empty model, non-empty API key, explicit `baseURL` required for all non-OpenAI providers, HTTPS strictly enforced in production | Unit (Vitest) | `tests/unit/ai-provider.test.ts` (`AI Provider Endpoint Fail-Closed Validation`) | **PASS** |
| **PACK-32** | Cost Abuse Deployment Gate | Quotas, per-user generation budgets, circuit breakers, and rate limiters documented as mandatory deployment prerequisites before public external AI enablement | Architecture / Policy | `docs/reports/phase-01e-study-packs.md` & `docs/security/threat-model.md` | **PASS** |
| **PACK-33** | Bound AI SDK Internal Provider Retries | `maxProviderRetries = 0` configured for CALL 1 and CALL 2; external provider calls strictly limited to at most 2 per worker attempt (max 6 across 3 worker attempts) | Unit (Vitest) | `tests/unit/ai-provider.test.ts` (`bounds AI SDK internal retries: passes maxRetries = 0 to CALL 1 and CALL 2`) | **PASS** |
| **PACK-34** | Verifier Evidence Deduplication | CALL 2 payload separates candidate items (referencing only `citedChunkIds`) and `evidence` (unique union of cited chunks serialized once), eliminating $O(\text{items} \times \text{chunks})$ prompt repetition | Unit (Vitest) | `tests/unit/evidence-verifier.test.ts` (`deduplicates evidence in Call 2 payload across multiple candidate citations`) | **PASS** |
| **PACK-35** | Complete Verifier Input Length Bound | Preflight check enforces `maxVerifierInputChars = 180_000`; payloads exceeding bound immediately throw `STUDY_PACK_INPUT_LIMIT` before invoking provider ($0.00 spend) | Unit (Vitest) | `tests/unit/evidence-verifier.test.ts` (`rejects verifier payload exceeding maxVerifierInputChars with STUDY_PACK_INPUT_LIMIT and 0 AI calls`) | **PASS** |
| **PACK-36** | Non-Retryable Worker Internal Error Contract | Unknown non-`AIProviderError` exceptions thrown during generation map to `WORKER_INTERNAL_ERROR` with `retryable: false` | Unit (Vitest) | `tests/unit/ai-provider.test.ts` (`maps unknown non-AIProviderError to WORKER_INTERNAL_ERROR with retryable = false`) | **PASS** |
| **PACK-37** | Safe Server Action Error Sanitization | Server Actions map all 19 error codes via `toPublicStudyPackError()`; raw database errors, connection strings, URLs, and stack traces are sanitized to safe Spanish messages with zero internal leakage | Unit (Vitest) | `tests/unit/study-packs-actions.test.ts` (`sanitizes all 19 error codes and hides database connection/query details`) | **PASS** |
| **PACK-38** | Database-Authoritative Evidence Page Count | `evidence_page_count = COALESCE(v_calculated_evidence_pages, 0)` strictly enforced in DB RPC; caller-supplied override parameters (e.g. 999) are ignored in favor of the distinct chunk page count | Integration & Database (pgTAP) | `supabase/tests/database/05_chunks_and_study_packs_rls.sql` & `tests/integration/study-packs-worker.test.ts` (`enforces database-authoritative evidence_page_count`) | **PASS** |

---

## 3. Verification Summary
- **Database Test Suite (`supabase/tests/database/`)**: 327 pgTAP tests passing across 5 suites (82 in `05_chunks_and_study_packs_rls.sql`).
- **Unit Test Suite (`tests/unit/`)**: 228 unit tests passing across 16 suites (including `chunking.test.ts`, `ai-provider.test.ts`, `evidence-verifier.test.ts`, `citation-validator.test.ts`, `study-packs-actions.test.ts`, `config.test.ts`).
- **Integration Test Suite (`tests/integration/`)**: 56 tests passing across 3 suites (12 in `study-packs-worker.test.ts`, 17 in `processing-worker.test.ts`, 27 in `storage-security.test.ts`).
- **Vitest Total (`pnpm test`)**: 284 tests passing across 19 test files.
- **Benchmark Suite (`pnpm ai:benchmark:study-pack`)**: Mode A Mock Pipeline Smoke passed with 5/5 synthetic fixtures, structural mechanics verified, automated evidence-support ratio reported as N/A in mock mode, and $0.00 spend.
- **End-to-End Suite (`tests/e2e/`)**: 19 Playwright tests passing across 7 suites.
- **Zero Secrets**: Automated audit confirms no secrets, tokens, or credentials committed.
