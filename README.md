# MedStudy Atlas

Adaptive medical learning workspace engineered with evidence-based cognitive learning science, clinical knowledge modeling, and context-aware AI.

## Project Overview

MedStudy Atlas is designed to help medical students in Peru and Latin America master high-volume, complex curricula efficiently and retain clinical knowledge long-term.

- **Target Audience**: Medical students in Peru and Latin America.
- **Current Status**: **Phase 0C — Engineering Baseline COMPLETE** (Local-First; application running locally, zero external cloud dependencies or paid services).
- **Next Checkpoint**: **Vertical Slice 1A — Identity, Auth & RLS Baseline** (`phase/01a-identity`).

---

## Local Prerequisites

- **Node.js**: `^22.22.2 || ^24.15.0 || >=26.0.0` (verified on `v24.21.0`; required by `jsdom` and `vitest` engine constraints; generic Node 20 is not supported)
- **Package Manager**: `pnpm` (`11.19.0`, pinned via Corepack / `packageManager`)
- **Git**: Local Git repository (Local-First development model; remote push optional)

---

## Quick Start / Developer Flow

```bash
# 1. Install dependencies
pnpm install

# 2. Run local development server (http://localhost:3000)
pnpm dev

# 3. Run fast local quality checks (format, lint, typecheck, unit tests)
pnpm check

# 4. Run browser smoke tests (Playwright)
pnpm test:e2e

# 5. Compile production build
pnpm build

# 6. Run complete verification gate (format, lint, typecheck, tests, build)
pnpm verify
```

---

## Local Quality Commands

All verification commands operate locally without remote CI dependencies:

| Command | Description |
| :--- | :--- |
| `pnpm dev` | Starts Next.js development server on `http://localhost:3000`. |
| `pnpm build` | Compiles optimized production build via Turbopack. |
| `pnpm start` | Starts production server locally. |
| `pnpm format:check` | Verifies code formatting style with Prettier. |
| `pnpm format` | Automatically formats codebase with Prettier. |
| `pnpm lint` | Runs ESLint 9 (Flat Config) with Next.js rules. |
| `pnpm typecheck` | Strict TypeScript check (`tsc --noEmit`). |
| `pnpm test` | Runs Vitest unit and component tests. |
| `pnpm test:e2e` | Runs Playwright headless browser smoke tests and captures screenshots. |
| `pnpm check` | Composite fast check: `format:check` + `lint` + `typecheck` + `test`. |
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
