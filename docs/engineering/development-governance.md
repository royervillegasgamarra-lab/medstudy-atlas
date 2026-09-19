# Development Governance

This document establishes the mandatory engineering standards, branching workflows, and review protocols for the `medstudy-atlas` repository.

## 1. Core Rule: No Direct Development on `main`
- The `main` branch represents deployable, verified code.
- **Absolute Rule**: Direct pushes and direct commits to `main` are strictly forbidden.
- All work must occur on dedicated branches and merge to `main` exclusively through reviewed Pull Requests.

## 2. Server-Side vs. Procedural Governance
- **Current Account Reality**: Depending on GitHub organization/tier settings and repository visibility (specifically when transitioning between public and private), automated GitHub branch protection rules or enterprise rulesets may not be available or enforced.
- **Procedural Enforcement**: The absence of server-side branch locks does NOT waive the branch isolation requirement. All human contributors and AI agents are procedurally bound by this governance policy.
- Agents must never push directly to `main` or merge their own PRs.

## 3. Branching Strategy & Naming Conventions
All branches must branch off the latest `main` and follow standard prefixes:
- `phase/<phase-id>-<slug>`: Major governance, architecture, or baseline milestones (e.g., `phase/00a-governance`).
- `feat/<issue-id>-<slug>`: New user-facing or technical features.
- `fix/<issue-id>-<slug>`: Bug fixes and patches.
- `docs/<slug>`: Pure documentation updates.
- `chore/<slug>`: Dependency maintenance, CI updates, or non-functional refactoring.

## 4. Antigravity Worktree Isolation
- Agents operating within Antigravity must utilize isolated Git worktrees (`Workspace: 'branch'` or Antigravity New Worktree Mode).
- Worktree branches must be pushed cleanly to the remote repository under their canonical branch name.

## 5. Pull Request & Merge Workflow
1. **Branch Verification**: Before opening a PR, execute the `pr-readiness` skill:
   - Working tree clean.
   - Zero secrets or untracked sensitive files.
   - All available tests and checks pass.
   - Execution report generated and committed.
2. **PR Creation**: Open a PR against `main` with a clear description, linked issues, and reference to the execution report.
3. **External Review**: Every PR requires external human review and explicit approval before merge.
4. **Squash Merge**: PRs must be merged using **Squash and Merge** to maintain a clean, linear, and bisectable Git history on `main`.

## 6. Architecture & Decision Integrity
- **No Silent Architecture Changes**: Any significant change to data structures, boundaries, services, or frameworks requires an Architecture Decision Record (ADR) in `docs/adrs/`.
- Previously accepted ADRs cannot be overturned without submitting a superseding ADR with clear justification and migration paths.

## 7. Dependency & Migration Review Protocols
- **Dependency Protocol**: Before adding any third-party dependency, execute the `dependency-review` skill. Commercial SaaS compatibility and explicit licensing are mandatory.
- **Database & Migration Protocol**:
  - Migrations must be strictly additive and backward-compatible.
  - Destructive operations (dropping columns, truncating tables, rewriting data types) are prohibited without an approved migration plan, dual-write phase, and verified rollback script.
- **Rollback Expectations**: Every architectural or configuration change must specify a concrete rollback procedure in its execution report or PR summary.
