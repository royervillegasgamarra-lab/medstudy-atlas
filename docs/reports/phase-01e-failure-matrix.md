# MedStudy Atlas — Phase 1E Failure Matrix

- **Phase**: Vertical Slice 1E — Deterministic Chunking, Evidence Layer & Study Pack Generation
- **Mode**: LOCAL-FIRST
- **Branch**: `phase/01e-study-packs`
- **Scope**: Canonical page-bounded chunking engine, evidence layer, two-call LLM generation and verification pipeline, deterministic citation validator, strict QA quality gates, worker queue lease fencing, and error taxonomy.

---

## 1. Complete Error Taxonomy (18 Error Codes)

### Document & Chunking Error Codes (6)
| Error Code | Retryable? | Trigger / Description |
| :--- | :--- | :--- |
| `DOCUMENT_NOT_READY` | No | Document processing status is not `READY` (e.g. still `PENDING`, `UPLOADING`, or `FAILED`). |
| `DOCUMENT_ARCHIVED` | No | Document was soft-deleted (`archived_at IS NOT NULL`) while study pack generation was enqueued or running. |
| `DOCUMENT_PAGES_EMPTY` | No | Document has zero extracted pages in `document_pages` table. |
| `NO_CHUNKS_GENERATED` | No | Canonical chunking engine produced zero chunks from available document text. |
| `EMPTY_DOCUMENT_TEXT` | No | Document page text content across all pages is completely empty or whitespace. |
| `TOKEN_BUDGET_EXCEEDED` | No | Total estimated document tokens exceed the maximum input context ceiling for Study Pack generation (default: 30,000 tokens). |

### AI Provider & Generation Error Codes (6)
| Error Code | Retryable? | Trigger / Description |
| :--- | :--- | :--- |
| `AI_TIMEOUT` | **Yes** | LLM request exceeded execution timeout (default: 45s per call). |
| `AI_RATE_LIMITED` | **Yes** | Provider returned HTTP 429 (rate limited / quota exceeded). |
| `AI_PROVIDER_ERROR` | **Yes** | Downstream provider 5xx server error, transient network disconnect, or malformed HTTP response. |
| `AI_CIRCUIT_BREAKER_TRIGGERED` | No | User or tenant cumulative AI spend exceeded the hard monthly ceiling ($1.50 USD). |
| `AI_AUTHENTICATION_ERROR` | No | Invalid API key, revoked credentials, or unauthorized AI endpoint access. |
| `SCHEMA_VALIDATION_FAILED` | **Yes** | LLM returned structured JSON that failed Zod schema parsing; retryable within attempt budget ($\le 3$). |

### Evidence Layer & Quality Gate Error Codes (3)
| Error Code | Retryable? | Trigger / Description |
| :--- | :--- | :--- |
| `INSUFFICIENT_EVIDENCE` | No | Candidate pack failed QA quality gate: less than 50% of claims verified as `SUPPORTED`, or missing summary, objectives, or concepts. |
| `HALLUCINATED_CITATIONS` | No | LLM generated citations referencing non-existent chunk IDs; stripped before persistence or rejected if no valid claims remain. |
| `CITATION_VALIDATION_FAILED` | No | Citation validator rejected all candidate citations or detected structural citation corruption. |

### Worker Orchestration & Lease Error Codes (3)
| Error Code | Retryable? | Trigger / Description |
| :--- | :--- | :--- |
| `LEASE_EXPIRED` | No | Worker lease expired (`lease_expires_at <= NOW()`), revoking write authority (PostgreSQL raises SQLSTATE 55000). |
| `LEASE_REVOKED` | No | Active claim token or lease was revoked or stolen by a supervisor or subsequent worker claim. |
| `JOB_RETRY_LIMIT` | No | Job exhausted the maximum allowed retry attempts ($3$) and was permanently transitioned to `FAILED_FINAL`. |

---

## 2. Failure Scenario Matrix

| ID | Scenario | Expected Result | Test Layer | Test Name / Evidence | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **PACK-01** | Cross-user `document_chunks` read | User B cannot SELECT User A document chunks; RLS enforces `auth.uid() = user_id` | Database (pgTAP) | `supabase/tests/database/05_chunks_and_study_packs_rls.sql` (`Isolation: User B cannot SELECT User A document chunks`) | **PASS** |
| **PACK-02** | Cross-user `study_packs` read | User B cannot SELECT User A study packs; RLS enforces `auth.uid() = user_id` | Database (pgTAP) | `supabase/tests/database/05_chunks_and_study_packs_rls.sql` (`Isolation: User B cannot SELECT User A study packs`) | **PASS** |
| **PACK-03** | Cross-user `study_pack_items` read | User B cannot SELECT User A study pack items; RLS enforces `auth.uid() = user_id` | Database (pgTAP) | `supabase/tests/database/05_chunks_and_study_packs_rls.sql` (`Isolation: User B cannot SELECT User A study pack items`) | **PASS** |
| **PACK-04** | Cross-user `study_pack_item_citations` read | User B cannot SELECT User A citations; RLS enforces `auth.uid() = user_id` | Database (pgTAP) | `supabase/tests/database/05_chunks_and_study_packs_rls.sql` (`Isolation: User B cannot SELECT User A study pack item citations`) | **PASS** |
| **PACK-05** | Cross-user `ai_usages` read | User B cannot SELECT User A AI telemetry records; RLS enforces `auth.uid() = user_id` | Database (pgTAP) | `supabase/tests/database/05_chunks_and_study_packs_rls.sql` (`Isolation: User B cannot SELECT User A ai_usages`) | **PASS** |
| **PACK-06** | Authenticated direct mutation on `document_chunks` | Denied with SQLSTATE 42501 (permission denied); direct table writes revoked | Database (pgTAP) | `supabase/tests/database/05_chunks_and_study_packs_rls.sql` (`Authenticated: INSERT/UPDATE/DELETE denied on document_chunks`) | **PASS** |
| **PACK-07** | Authenticated direct mutation on `study_packs` | Denied with SQLSTATE 42501; direct table writes revoked | Database (pgTAP) | `supabase/tests/database/05_chunks_and_study_packs_rls.sql` (`Authenticated: INSERT/UPDATE/DELETE denied on study_packs`) | **PASS** |
| **PACK-08** | Authenticated direct mutation on `study_pack_items` & citations | Denied with SQLSTATE 42501; direct table writes revoked | Database (pgTAP) | `supabase/tests/database/05_chunks_and_study_packs_rls.sql` (`Authenticated: INSERT/UPDATE/DELETE denied on items and citations`) | **PASS** |
| **PACK-09** | Authenticated call to privileged Study Pack RPCs | Denied with SQLSTATE 42501; executable strictly by `service_role` | Database (pgTAP) | `supabase/tests/database/05_chunks_and_study_packs_rls.sql` (`Authenticated: EXECUTE denied on study pack RPCs`) | **PASS** |
| **PACK-10** | Composite FK enforcement on chunks & study packs | Rejects mismatched `(document_id, user_id)` (violates `fk_document_chunks_document` / `fk_study_packs_document`) | Database (pgTAP) | `supabase/tests/database/05_chunks_and_study_packs_rls.sql` (`Foreign Key Integrity: composite FK checks`) | **PASS** |
| **PACK-11** | Worker claim concurrency & SKIP LOCKED | Serialized via `FOR UPDATE SKIP LOCKED`; exactly one worker claims job, second receives null/empty | Integration (Vitest) | `tests/integration/study-packs-worker.test.ts` (`Worker Claim Concurrency & SKIP LOCKED: prevents race condition`) | **PASS** |
| **PACK-12** | Lease expiration & write authority revocation | Persist/fail RPCs reject expired leases (`lease_expires_at <= NOW()`) or null leases, raising SQLSTATE 55000 | Database & Integration | `supabase/tests/database/05_chunks_and_study_packs_rls.sql` & `tests/integration/study-packs-worker.test.ts` (`Lease Fencing & Write Revocation`) | **PASS** |
| **PACK-13** | Archive race closure during study pack run | If document is archived, run transitions to `FAILED_FINAL` (`DOCUMENT_ARCHIVED`) and stale persist is blocked | Integration (Vitest) | `tests/integration/study-packs-worker.test.ts` (`Archive Race Closure: aborts run when document is archived`) | **PASS** |
| **PACK-14** | Cached study pack read guarantee | Re-requesting or viewing an already generated study pack returns cached DB rows with zero AI calls ($0.00) | Integration (Vitest) | `tests/integration/study-packs-worker.test.ts` (`Cached Read Guarantee: cached study pack returns immediately without AI calls`) | **PASS** |
| **PACK-15** | Terminal retry semantics & attempt budget | Max 3 attempts enforced; exceeding limit transitions run permanently to `FAILED_FINAL` (`JOB_RETRY_LIMIT`) | Database & Integration | `supabase/tests/database/05_chunks_and_study_packs_rls.sql` & `tests/integration/study-packs-worker.test.ts` (`Terminal Retry Semantics`) | **PASS** |
| **PACK-16** | Deterministic page-bounded chunking | Chunks strictly respect physical PDF page boundaries (`page_start === page_end`); target 400-800 tokens, 10-15% overlap | Unit (Vitest) | `tests/unit/chunking.test.ts` (`never crosses page boundaries`, `estimates tokens accurately`, `handles empty/whitespace pages`) | **PASS** |
| **PACK-17** | Deterministic citation validation | Server derives `page_number` from chunk DB primary key; model cannot forge page numbers | Unit (Vitest) | `tests/unit/citation-validator.test.ts` (`derives page number from chunk records`, `validates quote snippets`) | **PASS** |
| **PACK-18** | Hallucinated chunk ID stripping | Citations with non-existent chunk IDs are safely stripped without crashing | Unit (Vitest) | `tests/unit/citation-validator.test.ts` (`strips citations pointing to invalid chunk IDs`) | **PASS** |
| **PACK-19** | Strict QA gate rejection on weak grounding | Rejects packs with < 50% supported claims or missing mandatory sections (`INSUFFICIENT_EVIDENCE`) | Unit (Vitest) | `tests/unit/evidence-verifier.test.ts` (`rejects packs with < 50% supported claims`, `requires all mandatory sections`) | **PASS** |
| **PACK-20** | AI Provider abstraction & pricing calculation | `pricing.ts` discounts cached tokens: `uncachedInput = Math.max(0, inputTokens - cachedTokens)`; calculates exact cost | Unit (Vitest) | `tests/unit/ai-provider.test.ts` (`calculates costs with cached token discount`, `records telemetry correctly`) | **PASS** |
| **PACK-21** | Benchmark telemetry exclusion | Benchmark feature (`context.feature === 'BENCHMARK'`) skips DB persistence to avoid user FK violations | Unit (Vitest) | `tests/unit/ai-provider.test.ts` (`skips telemetry DB insertion when feature is BENCHMARK`) | **PASS** |
| **PACK-22** | Synthetic medical lecture benchmark suite | Evaluates 5 synthetic medical lecture fixtures with 100% pass, 0 errors, and $0.00 cost | CLI / Harness | `src/benchmarks/study-pack-benchmark.ts` (`pnpm ai:benchmark:study-pack`) | **PASS** |
| **PACK-23** | React XSS injection defense | Prompt injection strings and clinical text rendered via React plain-text escaping; zero `dangerouslySetInnerHTML` | E2E & Component | `src/components/study-packs/study-pack-view.tsx` & `tests/e2e/study-packs.spec.ts` | **PASS** |
| **PACK-24** | HTML5 / React hydration valid markup | Shadcn `Badge` renders `<span>` instead of `<div>`, preventing DOM nesting violations inside `<p>` citation tags | Component & E2E | `src/components/ui/badge.tsx` & `tests/e2e/study-packs.spec.ts` | **PASS** |
| **PACK-25** | E2E Study Pack generation lifecycle UI | Full flow: upload -> process document -> trigger study pack -> worker -> view rendered sections and citations | E2E (Playwright) | `tests/e2e/study-packs.spec.ts` (`Study Pack Generation & Evidence View: generates and displays verified study pack`) | **PASS** |

---

## 3. Verification Summary
- **Database Test Suite (`supabase/tests/database/`)**: 299 pgTAP tests passing across 5 suites (54 in `05_chunks_and_study_packs_rls.sql`).
- **Unit Test Suite (`tests/unit/`)**: 182 unit tests passing across 15 suites (16 in `chunking.test.ts`, 14 in `ai-provider.test.ts`, 5 in `citation-validator.test.ts`, 5 in `evidence-verifier.test.ts`).
- **Integration Test Suite (`tests/integration/`)**: 49 tests passing across 3 suites (5 in `study-packs-worker.test.ts`, 17 in `processing-worker.test.ts`, 27 in `storage-security.test.ts`).
- **Vitest Total (`pnpm test`)**: 231 tests passing across 18 test files.
- **Benchmark Suite (`pnpm ai:benchmark:study-pack`)**: 5/5 synthetic medical lecture fixtures passed with 0 errors, 0 warnings, and $0.00 cost.
- **End-to-End Suite (`tests/e2e/`)**: 19 Playwright tests passing across 7 suites (including `study-packs.spec.ts`).
- **Zero Secrets**: Automated audit confirms no secrets, tokens, or credentials committed.
