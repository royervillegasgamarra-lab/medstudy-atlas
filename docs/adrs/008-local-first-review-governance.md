# ADR 008: Local-First Development and Review Package Governance

## Status
`ACCEPTED`

## Context
MedStudy Atlas previously required remote GitHub pushes, Pull Requests, and remote CI pipeline executions to consider phases completed or externally reviewable. This introduced operational blocking when remote authentication, organization tier rules, or network connections stalled development. We must decouple development and external review from remote platform locks while preserving strict engineering rigor.

## Decision Drivers
- **Unblocked Development Velocity**: AI agents and human engineers must be able to develop, verify, and complete phases without depending on remote service availability.
- **Strict Verification Standards**: Independence from GitHub must not compromise review thoroughness, secret detection, or branch isolation.
- **Portability & Ownership**: Maintain full control over local Git repositories and code artifacts.

## Options Considered
1. **Local-First Development Model with Self-Contained Review Packages**:
   - *Pros*: Local Git is the primary source of truth; remotes are optional; external review is conducted via automated, security-audited Review Packages (`review-output/*.zip`); squash merges occur locally upon approval; zero blocking on remote network issues.
   - *Cons*: Reviewers inspect a ZIP archive and unified diff rather than a web-based GitHub Pull Request UI.
2. **Mandatory GitHub PR & Remote CI Gating**:
   - *Pros*: Conventional web UI for PR reviews.
   - *Cons*: Prone to authentication timeouts, tier limitations, and remote CI blocking on phases with no application code yet.

## Decision
**ADOPT Option 1**: Establish **Local-First Development and Review Package Governance**:
- **Local Git as Source of Truth**: `main` represents the local verified baseline. All feature and phase work occurs on isolated local branches.
- **Review Packages**: Every completed phase or milestone produces a self-contained Review Package ZIP via `scripts/create-review-package.ps1` containing `REVIEW.md`, execution reports, status snapshots, test results, and unified git diffs against `main`.
- **Pre-Compression Security Scan**: The packaging script performs automated checks against secrets, `.env` files, `.git/`, and credentials before archiving.
- **Local Squash Merge**: Once externally approved, branches are squash-merged into `main` locally.
- **Remote Push Optional**: Pushing to remote repositories (e.g. GitHub `origin`) is strictly optional and never a blocker.

## Consequences
### Positive
- Total autonomy from remote service outages, authentication freezes, or platform lock-in.
- Complete, tamper-evident local audit trails preserved in Git history and review ZIPs.
- Clean, linear, bisectable commit history on `main`.

### Negative / Trade-offs
- External reviewers must download and inspect the local review archive.
- *Mitigation*: The review ZIP is structured cleanly with standardized markdown reports (`REVIEW.md`, `execution-report.md`, `git-diff.patch`) for straightforward inspection.

## Reversibility & Migration Path
Because standard Git branches and commits are maintained locally, the repository can push to GitHub, GitLab, or any remote at any time without modification.

## Date
2026-09-19
