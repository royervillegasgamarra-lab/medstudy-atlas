# Development Governance

This document establishes the mandatory engineering standards, branching workflows, and review protocols for the `medstudy-atlas` repository under **Local-First Development**.

## 1. Local-First Development Model
- **Local Git as Source of Truth**: Local Git is the primary, authoritative source of truth during development.
- **Optional Remotes**: Remote repositories (e.g. GitHub `origin`) are optional and secondary. No development, review, or checkpoint completion may block waiting for a remote push or remote service availability.
- **Review Packages**: External human review is conducted through self-contained local Review Packages (`review-output/*.zip`), requiring zero remote connection.
- **Public Deployments**: Public cloud deployments are deferred far into the future; early development focuses entirely on local stability and rapid iteration.

## 2. Core Rule: No Direct Development on `main`
- The `main` branch represents the local stable, verified baseline.
- **Absolute Rule**: Direct commits to `main` are strictly forbidden.
- All work must occur on dedicated local feature/phase branches (e.g., `phase/00a-governance`).
- After external review approval via the local Review Package, branches may be merged locally into `main` using **Squash Merge**.

## 3. Procedural Governance
- **Procedural Enforcement**: Regardless of whether server-side branch protections exist on any remote repository, all human contributors and AI agents are procedurally bound by this governance policy.
- Agents must never commit directly to `main` or perform unapproved merges.

## 4. Branching Strategy & Naming Conventions
All branches must branch off the local `main` and follow standard prefixes:
- `phase/<phase-id>-<slug>`: Major governance, architecture, or baseline milestones (e.g., `phase/00a-governance`).
- `feat/<feature-slug>`: New user-facing or technical features.
- `fix/<issue-slug>`: Bug fixes and patches.
- `docs/<slug>`: Pure documentation updates.
- `chore/<slug>`: Dependency maintenance, CI updates, or non-functional refactoring.

## 5. Antigravity Workspace Isolation
- Agents operating within Antigravity work within the canonical local repository or isolated Git worktrees.
- No work is pushed to remotes unless explicitly instructed by the user.

## 6. Review & Merge Workflow (Local-First)
1. **Branch Verification**: Before concluding a phase or task, execute the `pr-readiness` (Local Review Readiness) protocol:
   - Working tree clean or in a known state.
   - Zero secrets, keys, or untracked sensitive files.
   - All available tests and checks pass (or explicitly marked `NOT APPLICABLE`).
   - Execution report generated and committed.
2. **Review Package Generation**: Run `scripts/create-review-package.ps1` to produce `review-output/<phase-slug>-review.zip`.
3. **External Review**: The local review package is provided to an external human reviewer for inspection and approval.
4. **Local Squash Merge**: Upon explicit external approval, the branch is merged into `main` locally using **Squash and Merge** to maintain a clean, linear, and bisectable Git history.

## 7. Architecture & Decision Integrity
- **No Silent Architecture Changes**: Any significant change to data structures, boundaries, services, or frameworks requires an Architecture Decision Record (ADR) in `docs/adrs/`.
- Previously accepted ADRs cannot be overturned without submitting a superseding ADR with clear justification and migration paths.

## 8. Dependency & Migration Review Protocols
- **Dependency Protocol**: Before adding any third-party dependency, execute the `dependency-review` skill. Commercial SaaS compatibility, permissive licensing, and TCO justification are mandatory.
- **Database & Migration Protocol**:
  - Migrations must be strictly additive and backward-compatible.
  - Destructive operations (dropping columns, truncating tables, rewriting data types) are prohibited without an approved migration plan, dual-write phase, and verified rollback script.
- **Rollback Expectations**: Every architectural or configuration change must specify a concrete rollback procedure in its execution report.
