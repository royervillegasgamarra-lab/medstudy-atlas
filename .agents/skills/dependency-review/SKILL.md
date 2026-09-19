---
name: dependency-review
description: >-
  Evaluate third-party dependencies before introducing them to MedStudy Atlas. Use this skill when proposing or adding any external package, library, or tool to inspect licensing, commercial SaaS compatibility, maintenance, security risk, bundle impact, and alternatives.
---

# Dependency Review Skill

Use this skill before introducing, upgrading, or replacing any third-party dependency in MedStudy Atlas.

## Core Vetting Criteria

For every proposed dependency, evaluate and document:

1. **Package Details**:
   - Exact package name and registry identifier.
   - Official repository URL and documentation site.
   - Exact version proposed for introduction (pinned).

2. **Licensing & SaaS Compatibility**:
   - Stated license (e.g., MIT, Apache-2.0, BSD-3-Clause, ISC).
   - Commercial SaaS compatibility assessment (copyleft, patent grants, attribution obligations).
   - **BLOCKER**: If the license is unknown, ambiguous, or lacks explicit commercial reuse rights, reject or block the dependency immediately.
   - Flags: GPL, AGPL, SSPL, BSL, or non-commercial/academic-only licenses require escalated human review.

3. **Maintenance & Community Health**:
   - Release frequency, last commit date, open issue count, and maintainer responsiveness.
   - Vulnerability history (CVEs, security advisories).
   - Funding/backing model and risk of abandonment.

4. **Rationale & Alternatives**:
   - Specific architectural or business problem the package solves.
   - Native language/runtime alternatives considered.
   - Leaner, lighter-weight alternative packages considered.
   - Justification for why in-house implementation is inappropriate.

5. **Technical & Runtime Impact**:
   - Security attack surface (transitive dependencies, post-install scripts).
   - Bundle size impact (client-side bundle vs. server-only).
   - Runtime performance and memory characteristics.
   - Tree-shaking and modern ESM support.

## Decision Recommendations

Every review must conclude with one of three clear recommendations:

- **ADOPT**: Clear license, strong maintenance, low risk, essential utility.
- **ADAPT**: Modify usage pattern, isolate behind an internal abstraction, or vendor a minimal subset.
- **AVOID**: Restrictive/unclear license, poor maintenance, heavy transitive dependency tree, or simple native alternative available.
