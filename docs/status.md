# MedStudy Atlas — Project Status

## Snapshot
- **Current Phase**: Vertical Slice 1B — Onboarding / Curriculum / Exam Target
- **Development Mode**: LOCAL-FIRST
- **Repository**: Local Git repository
- **Remote**: Optional / not required
- **Current Branch**: `phase/01b-onboarding`
- **Current External Review**: Ready for Review (Phase 1B)
- **Next Checkpoint**: Vertical Slice 1C — Document Library & Secure Upload

## Subsystem State
| Subsystem | State | Notes |
| :--- | :--- | :--- |
| **Engineering Baseline** | `IMPLEMENTED` | Next.js 16 (App Router), React 19, TypeScript strict, Tailwind v4, shadcn/ui. |
| **Application** | `RUNNING LOCALLY` | Renders locally at `http://localhost:3000`; production build tested and verified. |
| **Database** | `OPERATIONAL (LOCAL)` | Local Supabase PostgreSQL 17; `user_profiles`, `subjects`, and `exam_targets` schemas; hardened security triggers; explicit column-level UPDATE grants; RLS policies; database security suite passes. $0.00 cost. |
| **Authentication** | `OPERATIONAL (LOCAL)` | Supabase Auth SSR via `@supabase/ssr`, Next.js 16 `proxy.ts`, signup, login, logout, protected `/app` & `/onboarding`, profile editing, two-user isolation verified via Playwright. $0.00 cost. |
| **Onboarding** | `OPERATIONAL (LOCAL)` | 3-step progressive wizard with database resumability, academic context, subjects, optional exam targets, server-side completion validation. |
| **Curriculum** | `OPERATIONAL (LOCAL)` | User-owned subjects with active unique index, exam targets with composite ownership integrity, course entity deferred. |
| **AI** | `UNINITIALIZED` | Thin `AIProvider` interface & hard cost controls designed (ADR 006); Study Pack generation scheduled for Slice 1E and AI Tutor for Slice 1F; $0 cost. |
| **Document Pipeline** | `UNINITIALIZED` | Storage bucket in Slice 1C; ingestion with `pdf-inspector`, selective OCR (ADR 003), and chunking scheduled for Slice 1D; $0 cost. |
| **Billing** | `UNINITIALIZED` | Provider-neutral domain designed; Mercado Pago/Stripe integration deferred to Phase 1K; $0 cost. |
| **Deployment** | `LOCAL ONLY` | Local execution verified; zero remote hosting or paid cloud services. |

## Risk & Governance Posture
- **Security Blockers**: None. Zero secrets, credentials, or PHI committed. Strict RLS enforced at database level with two-user isolation verified by pgTAP and Playwright.
- **Licensing Blockers**: None. Strictly proprietary notice maintained; all direct dependencies verified under permissive OSS licenses (MIT, Apache-2.0, ISC).
- **Operational Blockers**: None. Development is Local-First; all quality checks (`pnpm verify`, `pnpm test:e2e`, `pnpm db:test`) pass locally.
- **Paid Services Created**: NO ($0.00 cost incurred).
- **Known Critical Issues**: None.
- **Deferred Decisions**: Course entity hierarchy deferred until real curriculum requirements justify it (Subject serves as primary container). Provider/implementation choices (AI provider, embedding model, storage provider, edge host, payment gateway, worker host, email provider) remain tracked with status `DEFERRED` and explicit slice deadlines.
