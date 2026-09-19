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
   - Stated license (e.g., MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC).
   - Commercial SaaS compatibility assessment (copyleft, patent grants, attribution obligations).
   - **BLOCKER**: If the license is unknown, ambiguous, or lacks explicit commercial reuse rights, reject or block the dependency immediately.
   - Flags: GPL, LGPL, AGPL, SSPL, BSL, source-available, or unclear licenses are NOT default MVP choices and require explicit review before adoption.

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

## Evaluation Hierarchy (OSS / GitHub-First)

Before building a substantial capability or introducing a paid API/SaaS, evaluate in this order:
1. **Existing capability**: Leverage what is already in the current stack.
2. **Mature permissive OSS**: Mature permissively licensed open-source project.
3. **Simple in-house**: Simple deterministic in-house implementation.
4. **Free / low-cost API**: External API with low friction and low cost.
5. **Custom / self-hosted infrastructure**: Only when explicitly justified.

### Total Cost of Ownership (TCO)
Do NOT self-host a complex system merely because its source code is free. Evaluate Total Cost of Ownership including:
- Implementation time & integration complexity
- Ongoing maintenance & upgrades
- Hosting, compute, and storage costs
- Monitoring and operational complexity
- Security attack surface & vulnerability patching
- Paid API or external model dependencies

A paid API can be preferable when its total cost is lower than self-hosting.

## GitHub Scout

Before introducing a substantial dependency, SaaS, API, or building a complex capability, perform a lightweight candidate search.

### Evaluation Criteria
Evaluate candidate repositories across:
- **Actual problem solved**: Does it directly address the verified need?
- **Canonical repository**: Is it the authoritative upstream source?
- **License**: Permissive and commercially compatible?
- **Commercial compatibility**: Free of restrictive or reciprocal obligations?
- **Recent activity & maintenance**: Active maintainers, recent releases, responsive issue triage?
- **Integration effort**: Effort required to integrate, wrap, or isolate?
- **External API requirements**: Does it depend on third-party cloud services?
- **Infrastructure requirements**: Additional background workers, redis, or heavy DB extensions required?
- **Hidden operational cost**: Telemetry, maintenance overhead, breaking upgrade cadence?
- **Security impact**: Known CVEs, dependency footprint, safe post-install behavior?
- **Reversibility**: Can it be swapped or deprecated easily if needed?

*Rule*: Do not install repositories simply because they are popular or viral.

## Decision Recommendations

Every review must conclude with one of four clear recommendations:

- **ADOPT**: Permissive license, active maintenance, low risk, high utility.
- **ADAPT**: Modify usage pattern, isolate behind an internal abstraction, or vendor a minimal subset.
- **WATCH**: Promising tool under observation; not ready for immediate adoption due to maturity, license ambiguity, or pending roadmap need.
- **AVOID**: Restrictive/unclear license, poor maintenance, high operational complexity, heavy transitive dependencies, or simpler alternative available.
