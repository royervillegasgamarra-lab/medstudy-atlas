# MedStudy Atlas — Project Status

## Snapshot
- **Current Phase**: Phase 0C — Engineering Baseline
- **Development Mode**: LOCAL-FIRST
- **Repository**: Local Git repository
- **Remote**: Optional / not required
- **Current Branch**: `phase/00c-engineering`
- **Current External Review**: Pending Phase 0C local review package review
- **Next Checkpoint**: Vertical Slice 1A — Identity, Auth & RLS Baseline

## Subsystem State
| Subsystem | State | Notes |
| :--- | :--- | :--- |
| **Engineering Baseline** | `IMPLEMENTED` | Next.js 16 (App Router), React 19, TypeScript strict, Tailwind v4, shadcn/ui. |
| **Application** | `RUNNING LOCALLY` | Renders locally at `http://localhost:3000`; production build tested and verified. |
| **Database** | `UNINITIALIZED` | PostgreSQL (Supabase) schema designed (ADR 002); $0 cost incurred. |
| **Authentication** | `UNINITIALIZED` | Supabase Auth integration designed (ADR 001); no accounts created; $0 cost. |
| **AI** | `UNINITIALIZED` | Thin `AIProvider` interface & hard cost controls designed (ADR 006); $0 cost. |
| **Document Pipeline** | `UNINITIALIZED` | Pipeline designed with `pdf-inspector` and selective OCR (ADR 003); $0 cost. |
| **Billing** | `UNINITIALIZED` | Provider-neutral domain designed; Mercado Pago/Stripe integration deferred to Phase 1K; $0 cost. |
| **Deployment** | `LOCAL ONLY` | Local execution verified; zero remote hosting or paid cloud services. |

## Risk & Governance Posture
- **Security Blockers**: None. Zero secrets, credentials, or PHI committed. Strict security headers and `.env.example` enforced.
- **Licensing Blockers**: None. Strictly proprietary notice maintained; all direct dependencies verified under permissive OSS licenses (MIT, Apache-2.0, ISC).
- **Operational Blockers**: None. Development is Local-First; all quality checks (`pnpm verify`, `pnpm test:e2e`) pass locally.
- **Paid Services Created**: NO ($0.00 cost incurred).
- **Known Critical Issues**: None.
- **Deferred Decisions**: Provider/implementation choices (AI provider, embedding model, storage provider, edge host, payment gateway, worker host, email provider) remain tracked with status `DEFERRED` and explicit slice deadlines.
