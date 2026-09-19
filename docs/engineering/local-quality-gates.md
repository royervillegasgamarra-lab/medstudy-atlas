# Local Quality Gates & Verification Commands

Under MedStudy Atlas's **Local-First** engineering discipline (ADR 008), code verification is conducted locally through reproducible, cross-platform package scripts. Remote continuous integration (e.g. GitHub Actions) is strictly optional and not required to validate branches or generate review artifacts.

---

## 1. Verification Scripts Reference

| Command | Purpose | Tools Involved | Speed / Loop |
| :--- | :--- | :--- | :--- |
| `pnpm db:start` | Starts local containerized Supabase stack via Docker. | Supabase CLI (`supabase start`) | Moderate (~10-15s) |
| `pnpm db:stop` | Stops local containerized Supabase stack. | Supabase CLI (`supabase stop`) | Fast (<5s) |
| `pnpm db:status` | Shows status, local URLs, and keys for local Supabase stack. | Supabase CLI (`supabase status`) | Fast (<2s) |
| `pnpm format:check` | Verifies code adheres to formatting rules without modifying files. | Prettier | Fast (<2s) |
| `pnpm format` | Automatically formats all source code and configuration files. | Prettier | Fast (<2s) |
| `pnpm lint` | Strict static analysis for syntax, type, and React hook rules. | ESLint 9 (Flat Config) + `eslint-config-next` | Fast (<3s) |
| `pnpm typecheck` | Strict TypeScript validation without emitting build artifacts. | `tsc --noEmit` | Fast (<3s) |
| `pnpm test` | Executes unit and component tests. | Vitest (with `jsdom` + `@testing-library/react`) | Fast (<2s) |
| `pnpm db:reset` | Resets local PostgreSQL container and replays migrations. | Supabase CLI (`supabase db reset`) | Moderate (~15-20s) |
| `pnpm db:types` | Generates TypeScript database types from local schema. | Supabase CLI (`supabase gen types typescript --local`) | Fast (<5s) |
| `pnpm db:test` | Executes in-database pgTAP RLS and isolation tests. | Supabase CLI (`supabase test db`) | Fast (<3s) |
| `pnpm build` | Compiles production Next.js application with Turbopack. | Next.js 16 (`next build`) | Moderate (~3-5s) |
| `pnpm test:e2e` | Headless browser smoke and auth isolation tests. | Playwright (Chromium) | Moderate (~15-25s) |
| `pnpm audit` | Audits dependency tree against known vulnerability databases. | pnpm | Fast (<5s) |

---

## 2. Composite Quality Gate Commands

### Fast Developer Loop: `pnpm check`
Executes all fast local checks in sequence. Run this before staging or committing changes:
```bash
pnpm check
```
**Sequence**:
1. `pnpm format:check`
2. `pnpm lint`
3. `pnpm typecheck`
4. `pnpm test`
5. `pnpm db:test`

### Full Gate Verification: `pnpm verify`
Executes complete verification including production build compilation:
```bash
pnpm verify
```
**Sequence**:
1. `pnpm format:check`
2. `pnpm lint`
3. `pnpm typecheck`
4. `pnpm test`
5. `pnpm db:test`
6. `pnpm build`

---

## 3. Complete Phase 1A Verification Sequence
For final branch verification and review package readiness, execute the complete sequential pipeline:
```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm db:reset
pnpm db:types
pnpm db:test
pnpm build
pnpm test:e2e
pnpm audit
```

---

## 4. End-to-End Browser Smoke & Auth Isolation: `pnpm test:e2e`
Runs Playwright against the local application, launching `pnpm dev` automatically via `webServer`:
```bash
pnpm test:e2e
```
Verifies:
- Root URL (`/`) HTTP 200 response and correct heading/tagline rendering with Phase 1A status.
- Mobile viewport rendering (375x667) with zero horizontal overflow.
- 404 (`/non-existent-route-for-testing`) graceful fallback route.
- Health endpoint (`/api/health`) returning `{ status: "ok" }`.
- Auth lifecycle: signup -> view `/app` -> edit profile -> logout -> login.
- Open redirect defense: protocol-relative and backslash bypass targets sanitized.
- Two-user isolation across distinct browser contexts.
- Generates desktop, mobile, auth, and profile screenshots in `docs/screenshots/`.

---

## 5. Pre-Commit Safety Check
Before committing to any branch, ensure:
1. Complete verification sequence passes with zero errors.
2. `pnpm audit` reports zero known vulnerabilities.
3. `git status` shows only intentional files.
4. Zero secrets, tokens, credentials, or `.env` files with values are tracked.
