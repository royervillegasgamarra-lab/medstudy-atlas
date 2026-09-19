# Architecture Decision Records (ADRs)

## Overview
This directory stores Architecture Decision Records (ADRs) for `medstudy-atlas`. ADRs document important architectural decisions, the context in which they were made, options considered, and their consequences.

## Numbering & Status
- ADRs are numbered sequentially: `001-title.md`, `002-title.md`, etc.
- Template: [`000-template.md`](./000-template.md)
- Status values:
  - `PROPOSED`: Under discussion, awaiting team/stakeholder review.
  - `ACCEPTED`: Approved and actively being implemented.
  - `SUPERSEDED`: Replaced by a subsequent ADR (must link to new ADR).
  - `DEPRECATED`: Abandoned or no longer relevant.

## Decision Integrity
- Architectural decisions cannot be silently changed. Any change to previously accepted architecture must be submitted as a new ADR that references and supersedes the prior decision.
- Substantive ADRs will be introduced in **Phase 0B (Architecture Foundation)**.

## Index of Records
| Number | Title | Status | Date |
| :--- | :--- | :--- | :--- |
| 000 | [Template](./000-template.md) | N/A | 2026-09-19 |
| 001 | [Next.js Full-Stack Application Architecture](./001-application-architecture.md) | `ACCEPTED` | 2026-09-19 |
| 002 | [PostgreSQL as Primary System of Record and Concept Graph](./002-postgresql-system-of-record.md) | `ACCEPTED` | 2026-09-19 |
| 003 | [Document Ingestion Pipeline and Selective OCR](./003-document-pipeline-selective-ocr.md) | `ACCEPTED` | 2026-09-19 |
| 004 | [Lean RAG Architecture with PostgreSQL FTS and pgvector](./004-lean-rag-postgresql.md) | `ACCEPTED` | 2026-09-19 |
| 005 | [Spaced Repetition Scheduling via ts-fsrs](./005-spaced-repetition-fsrs.md) | `ACCEPTED` | 2026-09-19 |
| 006 | [Thin AI Provider Abstraction and Hard Cost Controls](./006-ai-provider-abstraction-cost-controls.md) | `ACCEPTED` | 2026-09-19 |
| 007 | [Database-Backed Background Processing for MVP](./007-background-jobs-database-queue.md) | `ACCEPTED` | 2026-09-19 |
| 008 | [Local-First Development and Review Package Governance](./008-local-first-review-governance.md) | `ACCEPTED` | 2026-09-19 |
