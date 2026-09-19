---
name: pr-readiness
description: >-
  Prepare and verify a branch before declaring it ready for external review in a Local-First workflow. Use this skill to inspect git diff against main, verify working tree state, check for secrets, verify documentation, run available project checks, ensure no unrelated changes, update the Execution Report, and generate the local Review Package.
---

# Local Review Readiness Skill

Use this skill before declaring any branch ready for external human review in MedStudy Atlas. Under Local-First development, remote pushes, GitHub Pull Requests, and GitHub Actions are not required. External review is conducted via local Review Packages.

## Pre-Review Verification Protocol

1. **Branch & Working Tree Verification**:
   - Verify that the active branch is a dedicated feature/phase branch (e.g., `phase/00a-governance`) and NOT `main`.
   - Run `git status` to verify the working tree is clean or in a known, intentional state.
   - Run `git diff main...HEAD` to confirm that all changes are intentional, minimal, and directly relevant to the checkpoint objectives.
   - Ensure no temporary files, debug statements, or scratch scripts are staged.

2. **Secret & Sensitive Data Audit**:
   - Scan modified lines for potential API keys, passwords, database URLs, tokens, credentials, or private keys.
   - Confirm `.env` and `.env.*` files are ignored and never tracked.
   - Verify no PHI, patient data, or copyrighted third-party material exists in the diff.

3. **Run Available Project Checks**:
   - Execute all currently defined build, test, lint, and typecheck commands for the current phase.
   - If a check fails, report the failure honestly. **NEVER** hide, skip, comment out, or delete a check to manufacture a passing state.
   - In early phases where application tooling is not yet initialized, explicitly record:
     `NOT APPLICABLE — APPLICATION TOOLING NOT YET IMPLEMENTED`.

4. **Documentation & Traceability**:
   - Verify that all relevant documentation in `docs/` is synchronized with the code changes.
   - Ensure the Execution Report (`docs/reports/<phase-or-task-slug>.md`) is updated with complete, accurate information, using `LOCAL HEAD SHA BEFORE REPORT`.
   - Confirm `docs/status.md` accurately reflects the current checkpoint state, subsystem states, and development mode (`LOCAL-FIRST`).

5. **Generate Local Review Package**:
   - Run the local review packaging script: `scripts/create-review-package.ps1`.
   - Verify that `review-output/<phase-or-task-slug>-review.zip` was generated and contains:
     - `REVIEW.md`
     - `execution-report.md`
     - `status.md`
     - `changed-files.txt`
     - `git-status.txt`
     - `git-log.txt`
     - `git-diff.patch`
     - `repository-tree.txt`
     - `test-results.md`
     - Relevant governance, agent, and documentation files.
   - Verify that the ZIP is safe and free of secrets, `.git/`, `node_modules/`, or large binary files.
