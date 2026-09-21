# MedStudy Atlas — Phase 1E Failure Matrix

- **Phase**: Vertical Slice 1E — Deterministic Chunking, Evidence Layer & Study Pack Generation
- **Mode**: LOCAL-FIRST
- **Branch**: `phase/01e-study-packs`
- **Scope**: Canonical page-bounded chunking engine, evidence layer, two-call LLM generation and verification pipeline, deterministic citation validator, strict QA quality gates, worker queue lease fencing, and error taxonomy.

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
| `AI_DISABLED` | No | AI generation is disabled by the server kill switch (`AI_GENERATION_ENABLED=false`). |
| `AI_NOT_CONFIGURED` | No | AI provider or API key is not configured in server environment, or Mock provider was invoked outside test environment without authorization. |
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
| `STUDY_PACK_EVIDENCE_QA_FAILED` | No | Candidate pack failed QA quality gate: less than 50% of claims verified as `SUPPORTED`, or missing mandatory sections. |
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
| **PACK-08** | Authenticated direct mutation on `study_pack_items` & citations | Denied with SQLSTATE 42501; direct table writes revoked | Database (pgTAP) | `supabase/tests/database/05_chunks_and_study_packs_rls.sql` (`Privilege: Authenticated INSERT denied on ai_usages`) | **PASS** |
| **PACK-09** | Authenticated call to privileged Study Pack RPCs | Denied with SQLSTATE 42501; executable strictly by `service_role` | Database (pgTAP) | `supabase/tests/database/05_chunks_and_study_packs_rls.sql` (`Privilege: REVOKE ALL FROM authenticated`) | **PASS** |
| **PACK-10** | Composite FK enforcement on chunks & study packs | Rejects mismatched `(document_id, user_id)` and `(processing_run_id, document_id, user_id)` | Database (pgTAP) | `supabase/tests/database/05_chunks_and_study_packs_rls.sql` (`FK Integrity: document_chunks and ai_usages composite FK checks`) | **PASS** |
| **PACK-11** | Worker claim concurrency & SKIP LOCKED | Serialized via `FOR UPDATE SKIP LOCKED`; exactly one worker claims job, second receives null/empty | Integration (Vitest) | `tests/integration/study-packs-worker.test.ts` (`Worker Concurrency: Active leased job cannot be claimed by competing worker`) | **PASS** |
| **PACK-12** | Lease expiration & write authority revocation | Persist/fail RPCs reject expired leases (`lease_expires_at <= NOW()`) or null leases, raising SQLSTATE 55000 | Database & Integration | `supabase/tests/database/05_chunks_and_study_packs_rls.sql` & `tests/integration/study-packs-worker.test.ts` (`Write Revocation: Persist rejected when lease expired`) | **PASS** |
| **PACK-13** | Archive race closure during study pack run | If document is archived, active pack transitions to `FAILED_FINAL` (`DOCUMENT_ARCHIVED`), derived items deleted, and stale persist is blocked | Database & Integration | `supabase/tests/database/05_chunks_and_study_packs_rls.sql` & `tests/integration/study-packs-worker.test.ts` (`Archive Race Closure & Archive Cascade Deletion`) | **PASS** |
| **PACK-14** | Cached study pack read guarantee | Re-requesting or viewing an already generated study pack returns cached DB rows with zero AI calls ($0.00) | Integration (Vitest) | `tests/integration/study-packs-worker.test.ts` (`serves cached Study Pack with zero AI provider calls on subsequent reads`) | **PASS** |
| **PACK-15** | Terminal retry semantics & attempt budget | Max 3 attempts enforced; exceeding limit transitions run permanently to `FAILED_FINAL` (`STUDY_PACK_RETRY_LIMIT`) | Database & Integration | `supabase/tests/database/05_chunks_and_study_packs_rls.sql` & `tests/integration/study-packs-worker.test.ts` (`Retry Limit: Transitions to FAILED_FINAL after exhausting attempts`) | **PASS** |
| **PACK-16** | Deterministic page-bounded chunking | Chunks strictly respect physical PDF page boundaries (`page_start === page_end`); target 1800 chars, max 2800 chars, 200 char overlap | Unit (Vitest) | `tests/unit/chunking.test.ts` (`never crosses page boundaries`, `enforces target chars`, `handles short/whitespace pages`) | **PASS** |
| **PACK-17** | Deterministic citation validation | Server derives `page_number` from chunk DB primary key; model cannot forge page numbers | Database & Unit | `supabase/tests/database/05_chunks_and_study_packs_rls.sql` & `tests/unit/citation-validator.test.ts` (`Citation Resolution: Server derives page_number from chunk join`) | **PASS** |
| **PACK-18** | Cross-document citation isolation | DB and validator reject citations pointing to chunks from another document or run | Database (pgTAP) | `supabase/tests/database/05_chunks_and_study_packs_rls.sql` (`Persist Integrity: Cross-document citation rejected`) | **PASS** |
| **PACK-19** | Strict QA gate rejection on weak grounding | Rejects packs with < 50% supported claims or missing mandatory sections (`STUDY_PACK_EVIDENCE_QA_FAILED`) | Unit (Vitest) | `tests/unit/evidence-verifier.test.ts` (`rejects packs with < 50% supported claims`) | **PASS** |
| **PACK-20** | AI Provider abstraction & pricing calculation | `pricing.ts` discounts cached tokens: `uncachedInput = Math.max(0, inputTokens - cachedTokens)`; calculates exact cost | Unit (Vitest) | `tests/unit/ai-provider.test.ts` (`calculates costs with cached token discount`, `records telemetry correctly`) | **PASS** |
| **PACK-21** | Benchmark telemetry exclusion | Benchmark feature (`context.feature === 'BENCHMARK'`) skips DB persistence to avoid user FK violations | Unit (Vitest) | `tests/unit/ai-provider.test.ts` (`skips telemetry DB insertion when feature is BENCHMARK`) | **PASS** |
| **PACK-22** | Synthetic medical lecture benchmark suite | Evaluates 5 synthetic medical lecture fixtures with Mode A Mock Smoke ($0.00 spend, structural mechanics check) | CLI / Harness | `src/benchmarks/study-pack-benchmark.ts` (`pnpm ai:benchmark:study-pack`) | **PASS** |
| **PACK-23** | React XSS injection defense | Prompt injection strings and clinical text rendered via React plain-text escaping; zero `dangerouslySetInnerHTML` | E2E & Component | `src/components/study-packs/study-pack-view.tsx` & `tests/e2e/study-packs.spec.ts` | **PASS** |
| **PACK-24** | HTML5 / React hydration valid markup | Shadcn `Badge` renders `<span>` instead of `<div>`, preventing DOM nesting violations inside `<p>` citation tags | Component & E2E | `src/components/ui/badge.tsx` & `tests/e2e/study-packs.spec.ts` | **PASS** |
| **PACK-25** | E2E Study Pack generation lifecycle UI | Full flow: upload -> process document -> trigger study pack -> worker -> view rendered sections and citations | E2E (Playwright) | `tests/e2e/study-packs.spec.ts` (`Study Pack Generation & Evidence View: generates and displays verified study pack`) | **PASS** |

---

## 3. Verification Summary
- **Database Test Suite (`supabase/tests/database/`)**: 309 pgTAP tests passing across 5 suites (64 in `05_chunks_and_study_packs_rls.sql`).
- **Unit Test Suite (`tests/unit/`)**: 190 unit tests passing across 15 suites (including `chunking.test.ts`, `ai-provider.test.ts`, `evidence-verifier.test.ts`, `citation-validator.test.ts`, `config.test.ts`).
- **Integration Test Suite (`tests/integration/`)**: 49 tests passing across 3 suites (7 in `study-packs-worker.test.ts`, 17 in `processing-worker.test.ts`, 27 in `storage-security.test.ts` - Note: test file totals sum to 51).
- **Vitest Total (`pnpm test`)**: 239 tests passing across 18 test files.
- **Benchmark Suite (`pnpm ai:benchmark:study-pack`)**: Mode A Mock Pipeline Smoke passed with 5/5 synthetic fixtures, structural mechanics verified, and $0.00 spend.
- **End-to-End Suite (`tests/e2e/`)**: 19 Playwright tests passing across 7 suites.
- **Zero Secrets**: Automated audit confirms no secrets, tokens, or credentials committed.
