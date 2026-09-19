# Local Quality Gates & Verification Commands

Under MedStudy Atlas's **Local-First** engineering discipline (ADR 008), code verification is conducted locally through reproducible, cross-platform package scripts. Remote continuous integration (e.g. GitHub Actions) is strictly optional and not required to validate branches or generate review artifacts.

---

## 1. Verification Scripts Reference

| Command | Purpose | Tools Involved | Speed / Loop |
| :--- | :--- | :--- | :--- |
| `pnpm format:check` | Verifies code adheres to formatting rules without modifying files. | Prettier | Fast (<2s) |
| `pnpm format` | Automatically formats all source code and configuration files. | Prettier | Fast (<2s) |
| `pnpm lint` | Strict static analysis for syntax, type, and React hook rules. | ESLint 9 (Flat Config) + `eslint-config-next` | Fast (<3s) |
| `pnpm typecheck` | Strict TypeScript validation without emitting build artifacts. | `tsc --noEmit` | Fast (<3s) |
| `pnpm test` | Executes unit and component tests. | Vitest (with `jsdom` + `@testing-library/react`) | Fast (<2s) |
| `pnpm test:e2e` | Headless browser smoke tests against local server. | Playwright (Chromium) | Moderate (~5-10s) |
| `pnpm build` | Compiles production Next.js application with Turbopack. | Next.js 16 (`next build`) | Moderate (~3-5s) |
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
5. `pnpm build`

---

## 3. End-to-End Browser Smoke Verification: `pnpm test:e2e`
Runs Playwright against the local application, launching `pnpm dev` automatically via `webServer`:
```bash
pnpm test:e2e
```
Verifies:
- Root URL (`/`) HTTP 200 response and correct heading/tagline rendering.
- Phase 0C badge visibility.
- Mobile viewport rendering (375x667) with zero horizontal overflow.
- 404 (`/non-existent-route-for-testing`) graceful fallback route.
- Health endpoint (`/api/health`) returning `{ status: "ok" }`.
- Zero browser console errors.
- Generates desktop and mobile screenshots in `docs/screenshots/`.

---

## 4. Pre-Commit Safety Check
Before committing to any branch, ensure:
1. `pnpm verify` passes with zero errors.
2. `pnpm audit` reports zero known vulnerabilities.
3. `git status` shows only intentional files.
4. Zero secrets, tokens, credentials, or `.env` files with values are tracked.
