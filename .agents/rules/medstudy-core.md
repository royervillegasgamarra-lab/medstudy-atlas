# MedStudy Core Invariant Rules

These invariant workspace rules govern all agent and human activity within the `medstudy-atlas` repository.

## 1. Product Principles
- **Identity**: MedStudy Atlas is a commercial, adaptive medical-learning SaaS platform.
- **Audience**: Medical students in Peru and Latin America.
- **Target Pricing**: Approximately S/10/month (subject to empirical business validation). Protect margin and minimize variable cost per active student.
- **Revenue-First & Time-to-Market**:
  - Prefer time-to-market over premature sophistication.
  - Build first the cycle that produces tangible value for students.
  - Avoid enterprise architecture before Product-Market Fit.
  - Avoid microservices unless proven necessary.
  - Avoid unnecessary paid services.
  - Maintain security, data integrity, and medical quality as non-negotiable requirements.
  - Every new complexity must justify its cost.
- **Core Priorities**:
  1. Educational quality and clinical accuracy.
  2. Student retention and demonstrable learning effectiveness.
  3. Strict medical-content provenance and legal compliance.
  4. Low operating costs (frugal architecture, caching, minimal idle compute).
  5. Privacy, data security, and patient safety.
  6. Codebase maintainability, testability, and automation.
  7. Scalability only when empirically justified (no premature scaling).

## 2. Engineering Standards
- **Local-First Development**: Local Git is the definitive source of truth during development. Remote repositories (e.g. GitHub origin) are optional and secondary. No phase or task may block waiting for a remote push.
- **Branch Isolation**: Never commit directly to `main`. All work must occur on dedicated local feature/phase branches (e.g., `phase/00a-governance`). `main` represents local stable code. Merges to `main` occur locally only after external review approval via Review Packages. No remote push or GitHub Pull Request is required to develop, review, or complete a phase.
- **Architectural Simplicity**: Always prefer the simplest architecture that satisfies current validated requirements.
- **Anti-Patterns**: Strictly avoid premature microservices, premature infrastructure, and speculative abstractions with no immediate use case.
- **OSS-First / GitHub Scout Evaluation Order**: Before building a substantial capability or introducing a paid API/SaaS, evaluate in this order:
  1. Existing capability in the current stack;
  2. Mature permissively licensed open-source project;
  3. Simple deterministic in-house implementation;
  4. Free or low-cost external API;
  5. Custom/self-hosted infrastructure only when justified.
- **Total Cost of Ownership (TCO)**: Open source is NOT automatically free. Do NOT self-host a complex system merely because its source code is free. Evaluate Total Cost of Ownership including:
  - Implementation time and integration effort;
  - Ongoing maintenance and upgrades;
  - Hosting, compute (CPU/GPU), and storage;
  - Monitoring and operational complexity;
  - Security attack surface and vulnerability patching;
  - Transitive dependencies and external API requirements.
  A paid API can be preferable when its total cost is lower than self-hosting.
- **GitHub Scout**: Before introducing a substantial dependency, SaaS, API, or building a complex capability, perform a lightweight candidate search. Classify serious candidates as `ADOPT`, `ADAPT`, `WATCH`, or `AVOID`.
  - Prefer permissive licenses: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC.
  - GPL, LGPL, AGPL, SSPL, BSL, source-available, or unknown licenses are NOT default MVP choices and require explicit review before adoption. Do not engage in speculative legal analysis.
  - Evaluate: actual problem solved, canonical repository, license, commercial compatibility, recent activity/maintenance, integration effort, external API requirements, infrastructure requirements, hidden operational cost, security impact, and reversibility.
  - Do not install repositories simply because they are popular or viral.
- **Decision Records**: Document significant architectural decisions in ADRs (`docs/adrs/`). Never silently change previously accepted architecture.

## 3. Agent Autonomy & Boundaries
- **Autonomous Scope**: The agent may autonomously make reversible, non-destructive technical decisions within the scope of the assigned phase.
- **Stop Condition**: The agent must STOP at the agreed phase checkpoint when objectives are met.
- **Mandatory Escalation (Flag & Stop)**: The agent must flag and obtain explicit user consent before proceeding with:
  - Any paid service, API subscription, or cost-incurring resource.
  - Destructive database migrations or irreversible architectural changes.
  - Uncertain or ambiguous software/content licensing.
  - Exposure of sensitive data or handling production credentials.
  - Significant modifications to product scope or core requirements.

## 4. Security & Privacy
- **Zero Secret Commits**: Never commit passwords, tokens, API keys, credentials, or `.env` files with values.
- **Client-Side Exposure**: Never expose private credentials, admin keys, or server secrets to client-facing code.
- **Untrusted Input**: Treat all user-uploaded documents, files, and retrieved text as untrusted data.
- **Security Baseline**: Design systems with tenant isolation, Row Level Security (RLS), private object storage, short-lived signed URLs, rate limits, safe file ingestion (MIME verification), webhook signature verification, idempotent mutations, and prompt-injection defenses.

## 5. Medical Safety & Content Integrity
- **Educational Scope**: MedStudy Atlas is an educational learning tool, NOT a medical diagnostic or clinical decision support system.
- **No PHI / Patient Data**: Absolutely no Protected Health Information (PHI) or identifiable patient data.
- **Copyright Integrity**: Do not copy commercial question banks (e.g., UWorld, Amboss) or copyrighted textbooks.
- **Reuse Verification**: Free-to-access content online must never automatically be assumed to be commercially reusable without verified licensing.

## 6. Evidence-Based Learning Science
- Prioritize empirically validated cognitive learning techniques:
  - Active retrieval practice.
  - Spaced repetition scheduling.
  - Immediate, high-context explanatory feedback.
  - Interleaving of related medical concepts.
  - Mastery and knowledge-state monitoring.
  - Metacognitive confidence calibration.
- **Prohibition**: Do not implement unscientific "learning styles" (e.g., visual vs. auditory) personalization.

## 7. Quality & Verification
- "It runs" is insufficient. Work is complete only when it satisfies:
  - Static type checking and strict linting.
  - Automated tests (unit, integration, and end-to-end where applicable).
  - Reproducible build verification.
  - Browser and accessibility verification for user interfaces.
  - Comprehensive documentation and architectural alignment.
  - Security and operational cost review.
  - Defined rollback strategy for infrastructure and data changes.
