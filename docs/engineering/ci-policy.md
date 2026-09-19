# Continuous Integration (CI) Policy

## 1. Overview
This document establishes the mandatory security and quality standards for GitHub Actions CI workflows in `medstudy-atlas`.

> [!IMPORTANT]
> No CI workflow files (`.github/workflows/*.yml`) are created during Phase 0A, as no application code or package manager exists yet. Workflows will be formally authored and activated in **Phase 0C (Engineering Baseline)**.

## 2. CI Security Mandates

1. **Minimal `GITHUB_TOKEN` Permissions**:
   - All workflows must explicitly declare top-level permissions.
   - Default to `permissions: { contents: read }`.
   - Never grant write permissions (`contents: write`, `pull-requests: write`, etc.) unless strictly required by a specialized release or comment bot, and scope them exclusively to that specific job.

2. **Full Commit SHA Pinning**:
   - All third-party GitHub Actions must be pinned to full 40-character commit SHAs, accompanied by a comment indicating the version tag.
   - **Prohibited**: Floating tags (e.g., `@v4`, `@v3`, `@main`, `@latest`).
   - *Example*:
     ```yaml
     # Correct:
     - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2

     # Prohibited:
     - uses: actions/checkout@v4
     ```

3. **No Self-Approving Workflows**:
   - Workflows must never have permissions to approve their own Pull Requests or bypass required review rules.

4. **Secret Protection in CI**:
   - Never expose production credentials or API keys in CI test runs.
   - Mock all external service calls (Supabase, AI providers, payment gateways) in automated CI environments.

## 3. Mandatory CI Verification Pipeline (Phase 0C+)
Every Pull Request targeting `main` must pass the following sequential or parallel stages:
1. **Dependency Audit**: Verify frozen lockfile (`pnpm install --frozen-lockfile`) and scan for known CVEs.
2. **Static Analysis & Linting**: ESLint strict configuration with zero warnings allowed.
3. **Type Checking**: `tsc --noEmit` with strict null checks and zero errors.
4. **Unit & Integration Tests**: Fast execution of isolated test suites with coverage thresholds.
5. **Build Verification**: Production Next.js build compilation.
6. **E2E / Browser Verification**: Playwright smoke tests verifying core user flows.
