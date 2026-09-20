# MedStudy Atlas — Project Status

## Snapshot
- **Current Phase**: Vertical Slice 1D — Secure Document Processing / Ingestion & Page Provenance
- **Development Mode**: LOCAL-FIRST
- **Repository**: Local Git repository
- **Remote**: Optional / not required
- **Current Branch**: `phase/01d-processing`
- **Current External Review**: Ready for Review (Phase 1D)
- **Next Checkpoint**: Vertical Slice 1E — Deterministic Chunking & Study Pack Generation

## Subsystem State
| Subsystem | State | Notes |
| :--- | :--- | :--- |
| **Engineering Baseline** | `IMPLEMENTED` | Next.js 16 (App Router), React 19, TypeScript strict, Tailwind v4, shadcn/ui. |
| **Application** | `RUNNING LOCALLY` | Renders locally at `http://localhost:3000`; production build tested and verified. |
| **Database** | `OPERATIONAL (LOCAL)` | Local Supabase PostgreSQL 17; `user_profiles`, `subjects`, `exam_targets`, `documents`, `document_processing_runs`, and `document_pages` schemas; composite FKs `(document_id, user_id)`; hardened security triggers; explicit column grants; RLS policies; 223 pgTAP tests pass. $0.00 cost. |
| **Authentication** | `OPERATIONAL (LOCAL)` | Supabase Auth SSR via `@supabase/ssr`, Next.js 16 `proxy.ts`, signup, login, logout, protected `/app`, `/app/documents` & `/onboarding`, profile editing, two-user isolation verified via Playwright. $0.00 cost. |
| **Onboarding** | `OPERATIONAL (LOCAL)` | 3-step progressive wizard with database resumability, academic context, subjects, optional exam targets, server-side completion validation. |
| **Curriculum** | `OPERATIONAL (LOCAL)` | User-owned subjects with active unique index, exam targets with composite ownership integrity, course entity deferred. |
| **AI** | `UNINITIALIZED` | Thin `AIProvider` interface & hard cost controls designed (ADR 006); Study Pack generation scheduled for Slice 1E and AI Tutor for Slice 1F; $0 cost. |
| **Document Pipeline** | `OPERATIONAL (LOCAL)` | Two-tier architecture: Node.js worker orchestrator (`src/workers/documents-worker.ts`) with `claim_next_processing_run` (`FOR UPDATE SKIP LOCKED`) and isolated Python parser child (`src/parsers/document_parser.py`) with stripped environment (zero Supabase/AI/DB credentials). Preflight with `qpdf` 12.4.1, native text via `pypdfium2` 5.13.0, selective OCR via local Tesseract 5.5.3 (`spa+eng` only). Page provenance tracking in `document_pages`. UI with live processing badges and retry button. $0.00 cost. |
| **Billing** | `UNINITIALIZED` | Provider-neutral domain designed; Mercado Pago/Stripe integration deferred to Phase 1K; $0 cost. |
| **Deployment** | `LOCAL ONLY` | Local execution verified; zero remote hosting or paid cloud services. |

## Risk & Governance Posture
- **Security Blockers**: None. Zero secrets, credentials, or PHI committed. Strict RLS enforced at database level with two-user isolation verified by pgTAP and Playwright.
- **Licensing Blockers**: None. Strictly proprietary notice maintained; all direct dependencies verified under permissive OSS licenses (MIT, Apache-2.0, ISC).
- **Operational Blockers**: None. Development is Local-First; all quality checks (`pnpm verify`, `pnpm test:e2e`, `pnpm db:test`) pass locally.
- **Paid Services Created**: NO ($0.00 cost incurred).
- **Known Critical Issues**: None.
- **Deferred Decisions**: Course entity hierarchy deferred until real curriculum requirements justify it (Subject serves as primary container). Provider/implementation choices (AI provider, embedding model, storage provider, edge host, payment gateway, worker host, email provider) remain tracked with status `DEFERRED` and explicit slice deadlines.
