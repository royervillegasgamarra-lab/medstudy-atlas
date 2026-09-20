# MedStudy Atlas

Adaptive medical learning workspace engineered with evidence-based cognitive learning science, clinical knowledge modeling, and context-aware AI.

## Project Overview

MedStudy Atlas is designed to help medical students in Peru and Latin America master high-volume, complex curricula efficiently and retain clinical knowledge long-term.

- **Target Audience**: Medical students in Peru and Latin America.
- **Current Status**: **Phase 1B — Onboarding, Curriculum & Exam Targets COMPLETE (IN REVIEW)** (Local-First; Onboarding wizard, Subject-first curriculum model, Exam target countdowns with deterministic Peru calendar dates, server-enforced onboarding RPC, pgTAP database tests, and two-user isolation operational locally, $0.00 cost).
- **Next Checkpoint**: **Vertical Slice 1C — Document Library & Private/Secure Storage** (`phase/01c-documents`).

---

## Local Prerequisites

- **Node.js**: `^22.22.2 || ^24.15.0 || >=26.0.0` (verified on `v24.21.0`; required by `jsdom` and `vitest` engine constraints; generic Node 20 is not supported)
- **Package Manager**: `pnpm` (`11.19.0`, pinned via Corepack / `packageManager`)
- **Container Runtime**: Docker Desktop or compatible container runtime running (required for local Supabase stack)
- **Git**: Local Git repository (Local-First development model; remote push optional)

---

## Quick Start / Reproducing Local Setup

To reproduce the Phase 1A local environment (Identity, Auth, SSR proxy, and RLS):

1. **Ensure Docker Desktop / compatible container runtime is running**:
   Verify Docker is running (`docker info`).

2. **Install dependencies**:
   ```bash
   pnpm install --frozen-lockfile
   ```

3. **Start local Supabase stack**:
   ```bash
   pnpm db:start
   ```

4. **Inspect current local Supabase status**:
   ```bash
   pnpm db:status
   ```
   The Supabase CLI outputs the local stack status and connection details, including `API_URL` and `PUBLISHABLE_KEY`.

5. **Configure environment variables**:
   Create `.env.local` from `.env.example`:
   ```bash
   cp .env.example .env.local
   ```
   Obtain the local Supabase URL and publishable key from the `pnpm db:status` output and populate `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL`: Local API URL (e.g. `http://127.0.0.1:54321`)
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: Local publishable key (`sb_publishable_...`)

   *(Note: Never commit `.env.local` or hard-code local keys into source code; `.env.local` is strictly gitignored).*

6. **Reset database and apply migrations**:
   ```bash
   pnpm db:reset
   ```

7. **Start local development server**:
   ```bash
   pnpm dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

> **Note**: `pnpm db:test`, `pnpm db:reset`, and `pnpm db:types` require the local Supabase stack (`pnpm db:start`) to be running.

---

## Local Quality Commands

All verification commands operate locally without remote CI dependencies:

| Command | Description |
| :--- | :--- |
| `pnpm db:start` | Starts local Supabase containerized stack via Docker. |
| `pnpm db:stop` | Stops local Supabase containerized stack. |
| `pnpm db:status` | Shows status, local URLs, and keys for local Supabase stack. |
| `pnpm db:reset` | Resets local database and replays all migrations (requires running stack). |
| `pnpm db:types` | Generates TypeScript database types to `src/types/database.ts` (requires running stack). |
| `pnpm db:test` | Executes pgTAP in-database RLS and isolation tests (requires running stack). |
| `pnpm dev` | Starts Next.js development server on `http://localhost:3000`. |
| `pnpm build` | Compiles optimized production build via Turbopack. |
| `pnpm start` | Starts production server locally. |
| `pnpm format:check` | Verifies code formatting style with Prettier. |
| `pnpm format` | Automatically formats codebase with Prettier. |
| `pnpm lint` | Runs ESLint 9 (Flat Config) with Next.js rules. |
| `pnpm typecheck` | Strict TypeScript check (`tsc --noEmit`). |
| `pnpm test` | Runs Vitest unit and component tests. |
| `pnpm test:e2e` | Runs Playwright headless browser smoke and auth isolation tests. |
| `pnpm audit` | Audits dependency tree against known vulnerability databases. |
| `pnpm check` | Composite fast check: `format:check` + `lint` + `typecheck` + `test` + `db:test`. |
| `pnpm verify` | Full verification gate: `pnpm check` + `build`. |

---

## Proprietary Software Notice

**Copyright © 2026 MedStudy Atlas. All rights reserved.**

This repository contains proprietary software and intellectual property.

- **No license is granted**: You may not copy, modify, distribute, publish, sublicense, or sell any portion of this software without prior written authorization.
- **External dependencies**: Third-party libraries utilized retain their respective open-source licenses (documented in `docs/engineering/dependencies.md`).

---

## Documentation Navigation

- **[Project Charter](docs/product/project-charter.md)**: Product mission, target audience, pricing hypothesis, and core thesis.
- **[MVP Scope Definition](docs/product/mvp-definition.md)**: In-scope features and vertical slices 1A–1K.
- **[Application Structure](docs/engineering/application-structure.md)**: Modular monolith architecture, directory layout, and conventions.
- **[Toolchain Documentation](docs/engineering/toolchain.md)**: Exact verified versions of Node, pnpm, Next.js, React, Tailwind, etc.
- **[Dependency Record](docs/engineering/dependencies.md)**: Direct dependencies, licenses, and adoption rationale.
- **[Local Quality Gates](docs/engineering/local-quality-gates.md)**: Detailed quality commands and local-first verification standards.
- **[System Overview](docs/architecture/system-overview.md)**: High-level topology, student loop, and cost model.
- **[Architecture Decision Records (ADRs)](docs/adrs/README.md)**: Index of accepted architectural decisions (ADRs 001–008).
- **[Current Status](docs/status.md)**: Real-time project snapshot and subsystem states.
