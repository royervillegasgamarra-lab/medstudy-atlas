# Execution Report: [Phase / Task Name]

- **Phase / Task**: [e.g., Phase 0A — Governance Bootstrap]
- **Status**: [COMPLETE / PARTIAL / BLOCKED]
- **Branch**: [e.g., `phase/00a-governance`]
- **Report based on SHA**: [Git commit SHA of implementation prior to report generation]
- **Pull Request**: [URL, PR #, or Pending]
- **Objective**: [Brief statement of purpose and goals]

> **Note on SHA Semantics**: Committed reports record the commit SHA of implementation prior to report generation (`Report based on SHA`). Committed reports do not contain their own final PR HEAD SHA to prevent self-referential commit loops. The final PR HEAD SHA is printed in the final agent chat/execution output upon push.

---

## 1. Work Completed
- [Bullet list of specific deliverables completed]

## 2. File Changes
### Important Files Created
- `path/to/file` — Description

### Important Files Modified
- `path/to/file` — Description

## 3. Architecture & Subsystem Impact
- **Architecture Decisions**: [Summary of ADRs created or architectural choices]
- **Database Impact**: [Migrations, schema changes, or NONE]
- **API Impact**: [Endpoints created, modified, or NONE]
- **AI Impact**: [Prompts, models, embeddings, RAG pipelines, or NONE]
- **Background-Job Impact**: [Queues, workers, cron tasks, or NONE]
- **Dependencies Introduced**: [Packages added, licenses verified, or NONE]

## 4. Security & Compliance Review
- **Security Review**: [Summary of threat evaluation, secret checks, auth, RLS]
- **Medical & Content Safety**: [Clinical positioning, provenance tracking, PHI check]
- **Environment Variables**: [List variable NAMES only, NEVER values; or NONE]

## 5. Verification & Quality
- **Tests / Checks Executed**:
  - Command: `[command]` -> Result: `[output/status]`
  - *(If not yet implemented, state: `NOT APPLICABLE — NOT YET IMPLEMENTED`)*
- **Browser Verification**: [Description of UI testing or NOT APPLICABLE]
- **Performance Impact**: [Latency, bundle size, database query impact]
- **Analytics Impact**: [Events tracked or NONE]
- **Cost Impact**: [$0 / estimated monthly delta]

## 6. Deviations, Issues & Debt
- **Deviations from Specification**: [Any discrepancies from original plan]
- **Known Issues**: [Unresolved minor bugs or limitations]
- **Blockers**: [Hard blockers requiring human intervention]
- **Technical Debt Knowingly Introduced**: [Temporary compromises with rationale]

## 7. Next Steps & Readiness
- **Git Status**: [Clean / Uncommitted details]
- **Recommended Next Step**: [Next phase or task]
- **READY_FOR_EXTERNAL_REVIEW**: [YES / NO]
