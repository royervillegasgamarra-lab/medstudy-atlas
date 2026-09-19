# MedStudy Atlas — Project Status

## Snapshot
- **Current Phase**: Vertical Slice 1A — Identity, Auth & RLS Baseline
- **Development Mode**: LOCAL-FIRST
- **Repository**: Local Git repository
- **Remote**: Optional / not required
- **Current Branch**: `phase/01a-identity`
- **Current External Review**: Pending Phase 1A local review package review
- **Next Checkpoint**: Vertical Slice 1B — Onboarding / Curriculum / Exam Target

## Subsystem State
| Subsystem | State | Notes |
| :--- | :--- | :--- |
| **Engineering Baseline** | `IMPLEMENTED` | Next.js 16 (App Router), React 19, TypeScript strict, Tailwind v4, shadcn/ui. |
| **Application** | `RUNNING LOCALLY` | Renders locally at `http://localhost:3000`; production build tested and verified. |
| **Database** | `OPERATIONAL (LOCAL)` | Local Supabase PostgreSQL 17; `user_profiles` canonical schema (`profiles` view removed), hardened auto-provisioning trigger `private.handle_new_user()` on `auth.users`, hardened `private.handle_updated_at()` trigger, explicit column-level UPDATE grants, RLS policies, 47 pgTAP tests passing. $0.00 cost. |
| **Authentication** | `OPERATIONAL (LOCAL)` | Supabase Auth SSR via `@supabase/ssr`, Next.js 16 `proxy.ts`, signup, login, logout, protected `/app`, profile editing, two-user isolation verified via Playwright. $0.00 cost. |
| **AI** | `UNINITIALIZED` | Thin `AIProvider` interface & hard cost controls designed (ADR 006); deferred to Slice 1D; $0 cost. |
| **Document Pipeline** | `UNINITIALIZED` | Pipeline designed with `pdf-inspector` and selective OCR (ADR 003); scheduled for Slice 1D; $0 cost. |
| **Billing** | `UNINITIALIZED` | Provider-neutral domain designed; Mercado Pago/Stripe integration deferred to Phase 1K; $0 cost. |
| **Deployment** | `LOCAL ONLY` | Local execution verified; zero remote hosting or paid cloud services. |

## Risk & Governance Posture
- **Security Blockers**: None. Zero secrets, credentials, or PHI committed. Strict RLS enforced at database level with two-user isolation verified by pgTAP and Playwright.
- **Licensing Blockers**: None. Strictly proprietary notice maintained; all direct dependencies verified under permissive OSS licenses (MIT, Apache-2.0, ISC).
- **Operational Blockers**: None. Development is Local-First; all quality checks (`pnpm verify`, `pnpm test:e2e`, `pnpm db:test`) pass locally.
- **Paid Services Created**: NO ($0.00 cost incurred).
- **Known Critical Issues**: None.
- **Deferred Decisions**: Provider/implementation choices (AI provider, embedding model, storage provider, edge host, payment gateway, worker host, email provider) remain tracked with status `DEFERRED` and explicit slice deadlines.
