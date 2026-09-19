# ADR 001: Next.js Full-Stack Application Architecture in Single Repository

## Status
`ACCEPTED`

## Context
MedStudy Atlas requires a modern, responsive, mobile-first web application that serves medical students efficiently on desktop browsers and mobile devices (PWA). The architecture must support fast server-side rendering, type-safe API communication, seamless authentication integration, fast development velocity for a lean team, and low operational maintenance.

## Decision Drivers
- **Time-to-Market & Simplicity**: Minimize moving parts; avoid managing separate frontend and backend repositories.
- **Mobile-First UX**: Medical students frequently review flashcards and study plans on mobile devices between hospital rounds.
- **Low TCO**: Single deployment surface on serverless edge/PaaS hosting.
- **Type Safety**: End-to-end TypeScript from database models to UI components.

## Options Considered
1. **Next.js App Router using the current patched stable release available at Phase 0C initialization (TypeScript, Tailwind CSS, shadcn/ui) in a Single App Repository**:
   - *Pros*: Unified full-stack TypeScript; Server Actions eliminate boilerplate API client code; React Server Components reduce client bundle size; huge ecosystem; seamless deployment on Vercel/Cloudflare; excellent PWA support.
   - *Cons*: Node.js runtime requires care for heavy CPU tasks (mitigated by offloading heavy parsing to workers or external APIs).
2. **Decoupled SPA (Vite + React) + Python Backend (FastAPI)**:
   - *Pros*: Python ecosystem for ML/document processing.
   - *Cons*: Two separate codebases, dual deployment pipelines, cross-origin CORS overhead, duplicated type definitions, doubled operational complexity.
3. **Monorepo (Turborepo with web, api, and worker packages)**:
   - *Pros*: Strict separation of packages.
   - *Cons*: Build tooling complexity, workspace package configuration overhead with no immediate necessity for the MVP.

## Decision
**ADOPT Option 1**: **Next.js App Router using the current patched stable release available at Phase 0C initialization** with TypeScript, Tailwind CSS, and shadcn/ui in a **Single Application Repository**.
- All domain modules reside within `src/modules/*`.
- Server Actions and Route Handlers handle backend operations.
- shadcn/ui provides accessible, unstyled primitives customizable via Tailwind CSS.

## Consequences
### Positive
- Single unified codebase with instant local setup (`pnpm dev`).
- End-to-end type safety between data layer and UI.
- Fast initial page loads via React Server Components.
- Low deployment friction and zero CORS issues.

### Negative / Trade-offs
- Node.js environment is not optimal for heavy continuous CPU workloads (e.g. OCR).
- *Mitigation*: Heavy document processing tasks are queued asynchronously in a background table and executed by isolated worker scripts.

## Reversibility & Migration Path
If a specialized document processing worker in Python becomes necessary in Phase 2+, it can be extracted into an independent micro-worker reading from the same PostgreSQL queue table without restructuring the Next.js web application.

## Date
2026-09-19
