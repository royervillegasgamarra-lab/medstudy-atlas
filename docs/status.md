# MedStudy Atlas — Project Status

## Snapshot
- **Current Phase**: Phase 0B — Architecture Foundation
- **Development Mode**: LOCAL-FIRST
- **Repository**: Local Git repository
- **Remote**: Optional / not required
- **Current Branch**: `phase/00b-architecture`
- **Current External Review**: Pending Phase 0B local review package review
- **Next Checkpoint**: Phase 0C — Engineering Baseline

## Subsystem State
| Subsystem | State | Notes |
| :--- | :--- | :--- |
| **Product Implementation** | `NOT_STARTED` | Zero application code created; lean architecture fully documented. |
| **Database** | `UNINITIALIZED` | Conceptual & logical schema designed (ADR 002 & data-model.md); $0 cost. |
| **AI Services** | `UNINITIALIZED` | Thin AIProvider interface & hard cost controls designed (ADR 006); $0 cost. |
| **Billing & Payments** | `UNINITIALIZED` | Provider-neutral domain designed; Mercado Pago/Stripe integration deferred to Phase 1K; $0 cost. |
| **Deployment & Hosting** | `UNINITIALIZED` | Deployment topology and environments designed (deployment.md); $0 cost. |
| **Authentication** | `UNINITIALIZED` | Supabase Auth integration designed in ADR 001; no accounts created. |

## Risk & Governance Posture
- **Security Blockers**: None. Zero secrets, credentials, or PHI committed. Threat model defined in `docs/security/threat-model.md`.
- **Licensing Blockers**: None. Strictly proprietary notice maintained; all evaluated OSS candidates vetted for permissive licenses.
- **Operational Blockers**: None. Development is Local-First; no remote pushes required.
- **Known Critical Issues**: None.
- **Deferred Decisions**: Core architecture decisions resolved in ADRs 001–008. Specific provider/implementation choices (AI provider, embedding model, storage provider, edge host, payment gateway, worker host, email provider) are tracked with status `DEFERRED` and explicit slice deadlines.
