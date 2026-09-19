# Verified Engineering Toolchain & Versions

This document records the verified, official baseline toolchain versions selected for MedStudy Atlas during **Phase 0C — Engineering Baseline**.

- **Verification Date**: September 19, 2026
- **Architecture Reference**: ADR 001, ADR 008
- **Package Manager Standard**: `pnpm` (Corepack-managed, pinned in `package.json`)

---

## 1. Core Tooling Baseline

| Tool / Technology | Verified Exact Version | Source / Canonical Identifier | Role / Notes |
| :--- | :--- | :--- | :--- |
| **Node.js** | `v24.21.0` | Node.js Runtime | Local development runtime. Supported engine range: `^22.22.2 || ^24.15.0 || >=26.0.0` (derived from `jsdom` and `vitest` engine requirements; generic Node 20 is not supported). |
| **Node Types** | `24.13.6` | `@types/node@24.13.6` | Aligned with Node.js 24 runtime major. |
| **pnpm** | `11.19.0` | `pnpm` (`packageManager` pinned) | Deterministic, content-addressable package manager. |
| **Next.js** | `16.3.5` | `next@16.3.5` | Full-stack App Router with Turbopack bundler. |
| **React** | `19.2.8` | `react@19.2.8` | Core UI library required by Next.js 16. |
| **React DOM** | `19.2.8` | `react-dom@19.2.8` | DOM renderer for React. |
| **TypeScript** | `5.9.3` | `typescript@5.9.3` | Strict type checking (`strict: true`, `noImplicitAny: true`). |
| **Tailwind CSS** | `4.3.3` | `tailwindcss@4.3.3` + `@tailwindcss/postcss@4.3.3` | CSS-first v4 engine with `@theme inline` tokens. |
| **shadcn/ui** | `4.21.0` | `shadcn@4.21.0` (preset: `base-nova`) | Accessible, source-owned component primitives via `@base-ui/react`. |
| **ESLint** | `9.39.5` | `eslint@9.39.5` + `eslint-config-next@16.3.5` | Next.js 16 flat config format (`eslint.config.mjs`). |
| **Prettier** | `3.9.8` | `prettier@3.9.8` | Code formatter (`.prettierrc`). |
| **Vitest** | `5.0.1` | `vitest@5.0.1` | Unit and component testing runner. |
| **Testing Library** | `16.3.3` | `@testing-library/react@16.3.3` | User-centric DOM testing utilities with `jsdom@30.1.0`. |
| **Playwright** | `1.63.0` | `@playwright/test@1.63.0` | Headless browser automation (Chromium v1243 / Chrome 153). |
| **Zod** | `4.6.5` | `zod@4.6.5` | Environment variable validation and schema contracts. |
| **next-themes** | `0.4.6` | `next-themes@0.4.6` | Theme management supporting light, dark, and system preferences. |

---

## 2. Node Engine Constraint Derivation

The locked dependency graph includes transitive dependencies (`jsdom@30.1.0`, `@asamuzakjp/css-color@7.0.0`, `@asamuzakjp/dom-selector@9.2.0`) requiring `node: ^22.22.2 || ^24.15.0 || >=26.0.0`, and `vitest@5.0.1` requiring `node: ^22.12.0 || ^24.0.0 || >=26.0.0`. Generic Node 20 is not supported by these packages.
Consequently, `package.json` enforces `engines.node: "^22.22.2 || ^24.15.0 || >=26.0.0"`. The verified active runtime is `Node v24.21.0`.

---

## 3. Lockfile Integrity

- Lockfile format: `pnpm-lock.yaml` (version 9/11).
- Single package manager invariant: Zero `package-lock.json` or `yarn.lock` files allowed in the repository.
- Build scripts approved via `pnpm-workspace.yaml`: `unrs-resolver: true`.
