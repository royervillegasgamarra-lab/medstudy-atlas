---
name: execution-report
description: >-
  Generate the standardized MedStudy Atlas Execution Report at the end of every checkpoint, phase, milestone, feature, or substantial task. Use this skill whenever completing work before requesting review or declaring a task done.
---

# Execution Report Skill

Use this skill to produce an honest, comprehensive, and standardized Execution Report at the conclusion of every milestone, phase, feature, or checkpoint in MedStudy Atlas.

## Location & Naming Convention

Reports are stored in:
`docs/reports/<phase-or-task-slug>.md` (e.g., `docs/reports/phase-00a-governance.md`).

The template is located at:
`docs/reports/_template.md`.

## Execution Workflow

1. **Review Checkpoint Objectives**:
   - Compare all stated requirements from the task prompt against actual deliverables.
   - Note any gaps, deferred items, or necessary deviations.

2. **Inspect Git & Working State**:
   - Run `git status` and `git diff` to identify all changed, created, or untracked files.
   - Record the current commit SHA as `Report based on SHA` (or `Implementation SHA before report`).
   - **SHA Semantics Rule**: Committed reports must NOT claim to contain their own final PR HEAD SHA. Modifying and committing the report changes the commit SHA, creating a self-referential paradox. The FINAL PR HEAD SHA must instead be printed in Antigravity's final chat output after all report/status files are committed and pushed.

3. **Verify Safety & Compliance**:
   - Confirm zero secrets, keys, or credentials were committed.
   - Confirm zero PHI or unverified proprietary medical assets were included.
   - Confirm no unauthorized dependencies or licenses were introduced.

4. **Document Verifications Honestly**:
   - For every check (typecheck, lint, test, build, browser), report the actual command run and output.
   - If a test or check does not exist yet (e.g., in early phases), explicitly state:
     `NOT APPLICABLE — NOT YET IMPLEMENTED`
   - Never fabricate test results or mark a missing check as passed.

5. **Assess Review Readiness**:
   - Set `READY_FOR_EXTERNAL_REVIEW: YES` only when all deliverables for the current checkpoint are complete, documented, and all known issues are honestly disclosed.
   - Set `READY_FOR_EXTERNAL_REVIEW: NO` if blocking issues, incomplete core requirements, or uncommitted breaking states exist.

6. **Generate Report**:
   - Populate all sections of the report template faithfully using `Report based on SHA`.

7. **Final Chat Output & PR HEAD SHA**:
   - After all report, documentation, and code changes are committed and pushed, print the standardized execution summary in Antigravity's final chat output.
   - The summary MUST explicitly print `FINAL PR HEAD SHA: <sha>`.
   - Never edit the committed report file to update it with this final commit SHA, as doing so restarts the self-referential commit cycle.
