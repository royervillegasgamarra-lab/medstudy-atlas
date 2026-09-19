# Continuous Integration (CI) Policy

## 1. Local-First CI Strategy
MedStudy Atlas adopts a **Local-First** approach to Continuous Integration (CI):
- **Local CI is the Initial Priority**: Verification and quality gates run locally on the developer's machine using local scripts.
- **GitHub Actions Not Required**: Remote CI via GitHub Actions is not required to develop, verify, review, or complete phases.
- **Phase 0A Status**: Zero CI workflows exist during Phase 0A, as no application code or package manager exists yet.
- **Future Remote CI**: Remote CI workflows may be evaluated and added later if they provide tangible value, but they will remain secondary to local verification.

## 2. Local Verification Pipeline (Phase 0C+)
When application code is introduced in Phase 0C (Engineering Baseline), standard local scripts will provide comprehensive automated verification:
1. `typecheck`: Strict TypeScript compiler verification (`tsc --noEmit`) with zero errors.
2. `lint`: Static analysis and code style rules (ESLint) with zero warnings.
3. `test`: Fast execution of unit and integration test suites.
4. `build`: Production Next.js build compilation verification.
5. `e2e`: End-to-end browser smoke verification (Playwright) for core flows.

## 3. Remote CI Security Mandates (Future / Optional)
If and when optional GitHub Actions workflows are implemented in the future, they must adhere to these strict security policies:
1. **Minimal `GITHUB_TOKEN` Permissions**:
   - Explicitly declare top-level permissions, defaulting to `permissions: { contents: read }`.
   - Never grant write permissions unless strictly necessary for a scoped release job.
2. **Full Commit SHA Pinning**:
   - All third-party actions must be pinned to 40-character commit SHAs with version comments (no floating tags).
3. **No Self-Approving Workflows**:
   - Workflows must never have permissions to approve PRs or bypass required review gates.
4. **Secret Protection**:
   - Never expose production credentials or live API keys in CI runs; mock all external services.
