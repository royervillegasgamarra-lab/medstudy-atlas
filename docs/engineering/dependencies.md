# Direct Dependency & License Record

This document maintains the official record of all direct dependencies introduced to MedStudy Atlas, evaluated under the `dependency-review` skill and the Open-Source Policy (`docs/licensing/open-source-policy.md`).

---

## 1. Runtime Dependencies (`dependencies`)

| Package | Pinned Version | Purpose | License | Category | Reason for Adoption |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `next` | `16.3.5` | Full-stack application framework (App Router, Turbopack, Server Actions, RSC). | MIT | Runtime | Foundational application architecture (ADR 001). Single application codebase. |
| `react` | `19.2.8` | Core UI library for component rendering and state. | MIT | Runtime | Required peer dependency of Next.js 16. |
| `react-dom` | `19.2.8` | DOM renderer for React. | MIT | Runtime | Required peer dependency of Next.js 16. |
| `@base-ui/react` | `1.8.0` | Unstyled, accessible UI component primitives. | MIT | Runtime | Primitives engine powering shadcn/ui v4 components. Source-owned, zero lock-in. |
| `class-variance-authority` | `0.7.1` | Type-safe CSS variant composition utility. | Apache-2.0 | Runtime | Standard companion for shadcn/ui components (Button, Badge). |
| `cn` | `0.3.0` | Minimal className merger utility. | MIT | Runtime | Lightweight utility for dynamic Tailwind class combination. |
| `lucide-react` | `1.47.0` | Accessible SVG icon collection. | ISC | Runtime | Clean, professional UI icons for medical interface and theme toggle. |
| `next-themes` | `0.4.6` | Theme management for Next.js with zero hydration flicker. | MIT | Runtime | Accessible dark/light mode toggling without complex state boilerplates. |
| `shadcn` | `4.21.0` | Component CLI and runtime primitives generator. | MIT | Runtime | Code-owned component system; allows styling customization without library overhead. |
| `tw-animate-css` | `1.4.0` | CSS animation helpers for Tailwind CSS v4. | MIT | Runtime | Smooth theme transitions and UI micro-interactions. |
| `zod` | `4.6.5` | TypeScript-first schema declaration and validation. | MIT | Runtime | Strongly-typed environment variable parsing and configuration boundaries. |
| `@supabase/supabase-js` | `2.116.0` | Supabase JavaScript client for database and auth communication. | MIT | Runtime | Official Supabase client for PostgreSQL operations, authentication, and RLS. |
| `@supabase/ssr` | `0.12.7` | Supabase SSR package providing cookie-based session management. | MIT | Runtime | Manages server-side cookie persistence and token rotation in Next.js 16 App Router. |
| `ai` | `7.0.107` | Vercel AI SDK Core for structured schema generation and provider abstractions. | Apache-2.0 | Runtime | Standard structured output generation library, Zod-compatible, provider-agnostic. |
| `@ai-sdk/openai-compatible` | `3.0.53` | OpenAI-compatible provider adapter for Vercel AI SDK. | Apache-2.0 | Runtime | Provides standard HTTP transport to any OpenAI-compatible inference endpoint. |

---

## 2. Development Dependencies (`devDependencies`)

| Package | Pinned Version | Purpose | License | Category | Reason for Adoption |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `typescript` | `5.9.3` | Static type checker. | Apache-2.0 | Dev | Non-negotiable type safety, strict mode enforcement. |
| `@types/node` | `24.13.6` | Node.js type definitions. | MIT | Dev | Type definitions for Node runtime APIs (aligned with Node 24 runtime). |
| `@types/react` | `19.3.0` | React type definitions. | MIT | Dev | Type definitions for React 19 components and hooks. |
| `@types/react-dom` | `19.3.0` | React DOM type definitions. | MIT | Dev | Type definitions for React DOM elements. |
| `tailwindcss` | `4.3.3` | Utility-first CSS framework (v4 CSS-first engine). | MIT | Dev | High-performance styling, zero runtime overhead, responsive design tokens. |
| `@tailwindcss/postcss` | `4.3.3` | PostCSS integration plugin for Tailwind CSS v4. | MIT | Dev | Seamless Next.js compilation of Tailwind v4 directives. |
| `eslint` | `9.39.5` | Static code analysis and linting engine. | MIT | Dev | Code quality, React hook safety, and anti-pattern prevention. |
| `eslint-config-next` | `16.3.5` | Official Next.js ESLint configuration. | MIT | Dev | Recommended Next.js rules, Core Web Vitals, and TypeScript linting. |
| `prettier` | `3.9.8` | Code formatting engine. | MIT | Dev | Consistent, automated code style across the codebase. |
| `vitest` | `5.0.1` | Fast, Vite-native unit and component test runner. | MIT | Dev | Rapid unit test feedback loop with native TypeScript and ESM support. |
| `@vitejs/plugin-react` | `6.1.1` | React support plugin for Vitest. | MIT | Dev | Enables JSX/TSX transformation during unit testing. |
| `jsdom` | `30.1.0` | Pure-JavaScript DOM implementation for Node. | MIT | Dev | Browser-like DOM environment for component testing in Vitest. |
| `@testing-library/react` | `16.3.3` | UI component testing utilities. | MIT | Dev | User-centric component testing without implementation detail coupling. |
| `@testing-library/dom` | `10.4.2` | DOM testing utilities companion. | MIT | Dev | Required peer dependency of `@testing-library/react`. |
| `vite-tsconfig-paths` | `6.1.1` | Path alias resolution plugin for Vitest. | MIT | Dev | Enables `@/*` alias support in Vitest tests. |
| `@playwright/test` | `1.63.0` | End-to-end browser automation framework. | Apache-2.0 | Dev | Headless browser smoke verification across desktop and mobile viewports. |
| `supabase` | `2.117.0` | Supabase CLI for local container management, migrations, and typegen. | MIT | Dev | Enables local-first containerized PostgreSQL stack, migrations, and schema type generation. |

---

## 3. License Audit & Proprietary Posture

- **All direct runtime dependencies are licensed under permissive open-source licenses**: MIT, Apache-2.0, or ISC.
- **Zero GPL, AGPL, SSPL, or copyleft dependencies** are present in runtime or build artifacts.
- **Commercial SaaS Compatibility**: All reviewed direct dependencies declare permissive licenses and no licensing blocker has been identified under the project's current dependency policy.
- **Proprietary Notice**: MedStudy Atlas remains proprietary software; no open-source license has been applied to the project repository itself.
