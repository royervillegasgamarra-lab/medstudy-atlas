# Antigravity Hooks Architectural Plan

## 1. Overview
Antigravity supports lifecycle hooks via `.agents/hooks.json`, executing shell commands at defined points during the agent's interaction loop (`PreToolUse`, `PostToolUse`, `PreInvocation`, `PostInvocation`, `Stop`).

## 2. Phase 0A Status: No Executable Hooks
- **Mandate**: **DO NOT** create active executable hooks in Phase 0A.
- **Rationale**: The project currently contains only documentation and governance policies. No package manager, linter, typechecker, or test runner is installed yet. Executable hooks calling nonexistent commands would fail or block agent operations unnecessarily.
- **Implementation Note**: No `.agents/hooks.json` will be created during Phase 0A.

## 3. Candidate Hooks for Phase 0C (Engineering Baseline)
Once the project has stable scripts and validation commands in Phase 0C, the following hooks should be evaluated for activation:

### A. Branch Safety Guard (`PreToolUse`)
- **Event**: `PreToolUse` (matcher: `run_command`)
- **Purpose**: Intercept shell commands that attempt to push directly to `main` or merge without a PR.
- **Action**: Check if the command targets `git push origin main` and return `"decision": "deny"`.

### B. Secret Scanner (`PreToolUse` / `PostToolUse`)
- **Event**: `PreToolUse` or `PostToolUse` (matcher: `run_command|write_to_file|replace_file_content`)
- **Purpose**: Prevent accidental staging or writing of high-entropy strings resembling API keys, database URLs, or private tokens.
- **Action**: Run a lightweight regex pattern scan against file write arguments or staged git diffs.

### C. Formatting & Lint Diagnostic (`PostToolUse`)
- **Event**: `PostToolUse` (matcher: `write_to_file|replace_file_content`)
- **Purpose**: Automatically run code formatters (e.g., Prettier) or report lint warnings after code modifications.
- **Action**: Execute `pnpm lint --fix` or `pnpm format` on changed paths.

### D. PR Readiness Gate (`Stop`)
- **Event**: `Stop`
- **Purpose**: Ensure that before an agent concludes a task marked as ready for PR, all verification tests have passed and the execution report is updated.
- **Action**: Verify that test outputs exist and no untracked secrets are present.
