---
name: pr-readiness
description: >-
  Prepare and verify a branch before declaring it externally reviewable or opening a Pull Request. Use this skill to inspect git diff, untracked files, check for secrets, verify documentation, run available project checks, ensure no unrelated changes, generate/update the Execution Report, and prepare PR summaries without hiding failures.
---

# PR Readiness Skill

Use this skill before declaring any branch ready for external human review or submitting a Pull Request.

## Pre-PR Verification Protocol

1. **Inspect Git Working Tree & Diffs**:
   - Run `git status` to detect untracked, modified, or stray files.
   - Run `git diff` against the target base branch (`main`) to verify that every change is intentional and directly relevant to the current checkpoint.
   - Ensure no unintended temporary files, debug statements, or scratch scripts are staged.

2. **Secret & Sensitive Data Audit**:
   - Scan modified lines for potential API keys, passwords, database URLs, tokens, or private credentials.
   - Confirm `.env` files with actual values are ignored and never tracked.
   - Verify no PHI or copyrighted third-party material exists in the diff.

3. **Run Available Project Checks**:
   - Execute all currently defined build, test, lint, and typecheck commands for the current phase.
   - If a check fails, report the failure honestly. **NEVER** hide, skip, comment out, or delete a check to manufacture a passing state.
   - In early phases where tools are not yet initialized, explicitly note checks as `NOT APPLICABLE — NOT YET IMPLEMENTED`.

4. **Documentation & Traceability**:
   - Verify that all relevant documentation in `docs/` is synchronized with the code changes.
   - Ensure the Execution Report (`docs/reports/<phase-or-task-slug>.md`) is updated with complete, accurate information.
   - Confirm `docs/status.md` reflects the current checkpoint state.

5. **Branch Hygiene & Remote Sync**:
   - Verify the branch follows naming conventions (`phase/*`, `feat/*`, `fix/*`).
   - Push the branch to the remote repository (`origin`).
   - Prepare a structured Pull Request title and description including objectives, changes, verification results, and review instructions.
