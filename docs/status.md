# MedStudy Atlas — Project Status

## Snapshot
- **Current Phase**: Vertical Slice 1E — Deterministic Chunking, Evidence Layer & Study Pack Generation
- **Development Mode**: LOCAL-FIRST
- **Repository**: Local Git repository
- **Remote**: Optional / not required
- **Current Branch**: `phase/01e-study-packs`
- **Current External Review**: Ready for Review (Phase 1E)
- **Next Checkpoint**: Vertical Slice 1F — Fact-Grounded AI Tutor & Context Windows

## Subsystem State
| Subsystem | State | Notes |
| :--- | :--- | :--- |
| **Engineering Baseline** | `IMPLEMENTED` | Next.js 16 (App Router), React 19, TypeScript strict, Tailwind v4, shadcn/ui. |
| **Application** | `RUNNING LOCALLY` | Renders locally at `http://localhost:3000`; production build tested and verified. |
| **Database** | `OPERATIONAL (LOCAL)` | Local Supabase PostgreSQL 17; `user_profiles`, `subjects`, `exam_targets`, `documents`, `document_processing_runs`, `document_pages`, `document_chunks`, `study_packs`, `study_pack_items`, `study_pack_item_citations`, and `ai_usages` schemas; composite FKs with PostgreSQL 17 ON DELETE SET NULL; hardened security triggers; explicit column grants; RLS policies; 326 pgTAP tests pass across 5 files. $0.00 cost. |
| **Authentication** | `OPERATIONAL (LOCAL)` | Supabase Auth SSR via `@supabase/ssr`, Next.js 16 `proxy.ts`, signup, login, logout, protected `/app`, `/app/documents`, `/app/documents/[id]/study-pack` & `/onboarding`, profile editing, two-user isolation verified via Playwright. $0.00 cost. |
| **Onboarding** | `OPERATIONAL (LOCAL)` | 3-step progressive wizard with database resumability, academic context, subjects, optional exam targets, server-side completion validation. |
| **Curriculum** | `OPERATIONAL (LOCAL)` | User-owned subjects with active unique index, exam targets with composite ownership integrity, course entity deferred. |
| **AI & Evidence Layer** | `OPERATIONAL (LOCAL / MOCK)` | Thin `AIProvider` interface (defining `generateStructured`) with runtime killswitch covering injected providers, unconditional production mock denial, fail-closed endpoint validation (HTTPS required in production, explicit `baseURL` for non-OpenAI), `MockAIProvider` ($0.00 spend), OpenAI-compatible provider with structured JSON outputs and transport resilience classifier. Two-call pipeline (CALL 1: candidate generation; CALL 2: evidence-support verification). Deterministic citation validator enforcing server-derived page numbers. Automated evidence verification QA gate requiring at least 1 summary, 1 objective, 1 concept, and ≥50% supported claims. Zero vector/pgvector/embeddings. Developer benchmark harness (`pnpm ai:benchmark:study-pack`) evaluating 5 synthetic fixtures in deterministic Mode A Mock Smoke ($0.00 spend; live opt-in requires `--live` or `AI_BENCHMARK_LIVE=true`). |
| **Document Pipeline** | `OPERATIONAL (LOCAL)` | Canonical chunking engine with strict page boundary invariance (never crossing pages in v1), 1800 char target (max 2800, 200 overlap), and code-point offset precision. Dedicated Study Pack worker (`src/workers/study-packs-worker.ts`) with `claim_next_study_pack` (`FOR UPDATE SKIP LOCKED`), claim token fencing, lease expiration write revocation, operational retryability (attempt budget refunded on `AI_DISABLED`/`AI_NOT_CONFIGURED`), concurrent enqueue convergence, and archive race closure (cancelling runs and packs, revoking writes with SQLSTATE 55000). 268 Vitest tests pass (213 unit, 55 integration). $0.00 cost. |
| **Study Pack UI** | `OPERATIONAL (LOCAL)` | Scientific presentation interface rendering Resumen, Objetivos de Aprendizaje, Conceptos Clave, Puntos Clave de Repaso, and Glosario de Términos Clave with display-only citation badges (`Pág. X`), coverage disclosure panel ("Páginas con evidencia textual: X de Y"), and Document Library lifecycle badges. Zero raw HTML (React plain text escaping). Verified via Playwright E2E. |
| **Billing** | `UNINITIALIZED` | Provider-neutral domain designed; Mercado Pago/Stripe integration deferred to Phase 1K; $0 cost. |
| **Deployment** | `LOCAL ONLY` | Local execution verified; zero remote hosting or paid cloud services. |

## Risk & Governance Posture
- **Security Blockers**: None. Zero secrets, credentials, or PHI committed. Strict RLS enforced at database level with two-user isolation verified by pgTAP and Playwright. Zero prompt injection leakage through evidence text.
- **Licensing Blockers**: None. Strictly proprietary notice maintained; all direct dependencies verified under permissive OSS licenses (MIT, Apache-2.0, ISC).
- **Operational Blockers**: None. Development is Local-First; all quality checks (`pnpm verify`, `pnpm test:e2e`, `pnpm db:test`, `pnpm ai:benchmark:study-pack`) pass locally.
- **Paid Services Created**: NO ($0.00 cost incurred).
- **Known Critical Issues**: None.
- **Deferred Decisions**: Course entity hierarchy deferred until real curriculum requirements justify it (Subject serves as primary container). Vector embeddings, pgvector, and semantic search deferred to Phase 1F. Provider/implementation choices (live AI provider, storage provider, payment gateway) remain tracked with status `DEFERRED`. Cost abuse mitigation: user-level generation quotas, circuit breakers, and rate limiters established as mandatory deployment gate prior to live external AI provider activation.
