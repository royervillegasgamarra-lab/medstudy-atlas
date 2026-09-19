# MedStudy Atlas — Application Structure & Engineering Conventions

This document outlines the directory structure, component conventions, and architectural boundaries of the MedStudy Atlas codebase established in **Phase 0C — Engineering Baseline**.

---

## 1. Directory Structure Overview

```
medstudy-atlas/
├── .agents/                    # Agent rules, workflows, and skills
├── docs/                       # Project documentation, ADRs, and reports
│   ├── adrs/                   # Architecture Decision Records (ADR 001–008)
│   ├── architecture/           # Domain, data, and system models
│   ├── engineering/            # Toolchain, quality gates, dependencies
│   ├── product/                # MVP scope, roadmap, metrics
│   ├── reports/                # Standardized phase execution reports
│   └── screenshots/            # Verification screenshots
├── public/                     # Static public assets (SVGs, icons)
├── src/
│   ├── app/                    # Next.js App Router routes & layouts
│   │   ├── api/health/         # Minimal health check endpoint
│   │   ├── error.tsx           # Global error boundary
│   │   ├── globals.css         # Tailwind v4 theme tokens and styles
│   │   ├── layout.tsx          # Root HTML layout with ThemeProvider
│   │   ├── not-found.tsx       # 404 page
│   │   └── page.tsx            # Local landing / workspace shell
│   ├── components/             # Shared UI components
│   │   ├── theme-provider.tsx  # Next-themes wrapper
│   │   ├── theme-toggle.tsx    # Accessible light/dark toggle button
│   │   └── ui/                 # Source-owned shadcn/ui primitives (button, card, badge)
│   ├── config/                 # Centralized configuration & environment
│   │   ├── app.ts              # App metadata, business assumptions, limits
│   │   └── env.ts              # Strongly-typed environment validation via Zod
│   ├── lib/                    # Shared utility functions (cn helper)
│   ├── modules/                # Logical domain module boundaries (modular monolith)
│   └── types/                  # Foundational TypeScript domain types
├── tests/
│   ├── e2e/                    # Playwright end-to-end browser smoke tests
│   └── unit/                   # Vitest unit and component tests
├── components.json             # shadcn/ui CLI configuration
├── eslint.config.mjs           # ESLint flat configuration
├── next.config.ts              # Next.js configuration with security headers
├── package.json                # Pinned dependencies and verification scripts
├── playwright.config.ts        # Playwright test runner configuration
├── pnpm-lock.yaml              # Deterministic pnpm dependency lockfile
├── pnpm-workspace.yaml         # Approved build scripts configuration
├── postcss.config.mjs          # Tailwind CSS v4 PostCSS configuration
├── tsconfig.json               # Strict TypeScript configuration
└── vitest.config.mts           # Vitest runner configuration
```

---

## 2. Server vs. Client Component Conventions

- **Server Components by Default**: All components in `src/app/` and `src/components/` are React Server Components unless explicit browser interaction, DOM events, or client-side hooks (`useState`, `useEffect`, `useTheme`) are required.
- **Client Components Isolated**: When interactivity is required, mark the file with `"use client"` at the top line. Keep client components as leaf nodes to minimize JavaScript bundle size.
- **Data Fetching**: Performed via Server Components, Server Actions, or Route Handlers. Direct client-to-database connections are prohibited.
- **Secret Isolation**: Server-side credentials (database passwords, future AI provider keys) must NEVER be exposed or prefixed with `NEXT_PUBLIC_`. Client components only access `NEXT_PUBLIC_` variables.

---

## 3. Modular Monolith Boundaries (`src/modules/*`)

Each domain module maintains a clear boundary:
- **`identity`**: User authentication, profiles, session management.
- **`curriculum`**: Medical courses, subjects, exam target blueprints.
- **`documents`**: Ingestion, validation, selective OCR, and chunking.
- **`knowledge`**: Canonical medical concepts and relational graph.
- **`learning`**: Spaced repetition (`ts-fsrs`), Study Packs, "Today" engine.
- **`assessment`**: MCQs, student attempts, Error Notebook.
- **`tutor`**: Context-grounded conversational AI tutor with citations.
- **`ai`**: Thin `AIProvider` isolating LLMs, cost controls, and telemetry.
- **`billing`**: Subscription tiers, quotas, payment webhooks.
- **`analytics`**: In-database telemetry and unit economics tracking.

**Coupling Rules**: Modules communicate exclusively through public service interfaces, never by reaching into internal module subdirectories.

---

## 4. UI Component Conventions (`src/components/ui/*`)

- **Source-Owned Primitives**: UI components are owned in the repository (not consumed as opaque black-box npm packages).
- **Styling**: Styled using Tailwind CSS utility classes and `class-variance-authority` (cva).
- **Accessibility**: Built on accessible primitives (`@base-ui/react`) with full keyboard navigation and ARIA attributes.
- **Theme Support**: Semantic color tokens (`bg-background`, `text-foreground`, `bg-primary`, `border-border`) ensure automatic adaptability between light and dark modes.

---

## 5. Testing Locations

- **Unit & Component Tests**: Located in `tests/unit/` and executed via `pnpm test` (Vitest).
- **End-to-End Smoke Tests**: Located in `tests/e2e/` and executed via `pnpm test:e2e` (Playwright).

---

## 6. Security Headers & CSP Baseline

MedStudy Atlas configures baseline HTTP security headers in `next.config.ts`:

- **`Content-Security-Policy`**:
  - `default-src 'self'`: Restricts resource loading to the origin.
  - `script-src 'self' 'unsafe-eval' 'unsafe-inline'`: Required for Next.js App Router client hydration scripts and Turbopack/HMR development evaluation.
  - `style-src 'self' 'unsafe-inline'`: Required for Tailwind CSS v4 and dynamic component styles.
  - `img-src 'self' blob: data:`: Supports local images, data URLs, and blob-based previews.
  - `font-src 'self'`: Local fonts only.
  - `object-src 'none'`: Disables browser plugins (Flash, Java).
  - `base-uri 'self'`: Prevents DOM injection of malicious `<base>` tags.
  - `form-action 'self'`: Restricts form submissions to origin.
  - `frame-ancestors 'none'`: Modern clickjacking prevention.
- **`X-Content-Type-Options`**: `nosniff` (prevents MIME type sniffing).
- **`X-Frame-Options`**: `DENY` (legacy clickjacking defense).
- **`Referrer-Policy`**: `strict-origin-when-cross-origin`.
- **`Permissions-Policy`**: `camera=(), microphone=(), geolocation=()` (disables unused browser hardware APIs).

### Intentional Deviations & Security Notes
1. **CSP is Defense-in-Depth**: CSP alone does not prevent XSS; proper React auto-escaping, input sanitization, and strict TypeScript boundaries remain primary defenses.
2. **Inline Scripts & Eval**: In development, Turbopack and React Fast Refresh require `'unsafe-eval'`. In production without nonce middleware, Next.js hydration requires `'unsafe-inline'`. Nonce-based strict CSP will be evaluated when edge middleware is introduced in Phase 1.
3. **Localhost HTTP Compatibility**: `upgrade-insecure-requests` is omitted in local development headers to avoid breaking `http://localhost:3000`.
