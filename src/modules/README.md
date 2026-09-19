# MedStudy Atlas — Domain Modules Architecture

This directory houses the logical domain modules of MedStudy Atlas according to the modular monolith architecture established in `docs/architecture/domain-model.md` and ADR 001.

## Domain Modules Overview

1. **`identity`** (Slice 1A): User registration, profile management, and Supabase Auth integration.
2. **`curriculum`** (Slice 1B): Academic courses, subjects, and standardized exam blueprints (ENAM, Essalud).
3. **`documents`** (Slice 1C, 1D): Document ingestion, validation, classification via `pdf-inspector`, and chunking.
4. **`knowledge`** (Slice 1D, 1E): Canonical medical concepts and relational graph stored in PostgreSQL.
5. **`learning`** (Slice 1E, 1H, 1I): Study Pack assembly, FSRS spaced repetition scheduling (`ts-fsrs`), and the "Today" study engine.
6. **`assessment`** (Slice 1G): Multiple-choice questions, attempts, and the Error Notebook.
7. **`tutor`** (Slice 1F): Context-grounded conversational AI tutor with verified citations and evidence states.
8. **`ai`** (Slice 1D, 1E, 1F, 1J): Thin `AIProvider` gateway isolating LLM providers, tracking token telemetry, and enforcing cost limits.
9. **`billing`** (Slice 1K): Subscription tiers (Free vs PRO), entitlement checks, and payment gateway webhooks.
10. **`analytics`** (Slice 1J): In-database product telemetry, retention metrics, and unit economics monitoring.

## Coupling Rules & Invariants

- **No Premature Implementation**: These modules will be implemented incrementally across Vertical Slices 1A through 1K.
- **Unidirectional Dependencies**: High-level modules (`tutor`, `learning`) may depend on low-level modules (`documents`, `knowledge`, `ai`), but not vice versa.
- **Strict Boundary**: Cross-module communication must occur via exported public service interfaces, not internal file imports.
- **Zero Secrets**: No module may expose service role keys, database secrets, or AI provider credentials to client-side bundles.
