# Open-Source & Third-Party Licensing Policy

## 1. Proprietary Nature of MedStudy Atlas
MedStudy Atlas is a commercial proprietary software platform. The codebase is **NOT** open source. All rights are reserved by the owners. No public license is granted to copy, distribute, modify, or commercialize this software.

External open-source libraries and tools utilized within MedStudy Atlas retain their respective licenses and must be vetted rigorously to ensure complete compatibility with our proprietary, commercial SaaS model.

## 2. Permitted Dependency Licenses (Default for MVP)
To maintain minimal licensing complexity, the following permissive open-source licenses are the default choices for runtime and build-time dependencies, provided standard attribution requirements are satisfied:
- **MIT License**
- **Apache License 2.0**
- **BSD 2-Clause License**
- **BSD 3-Clause License**
- **ISC License**

## 3. Non-Default Licenses Requiring Explicit Review
To avoid unnecessary licensing complexity and speculative legal analysis, dependencies with copyleft, source-available, or non-standard terms are **NOT default MVP choices** and require explicit review before adoption:
- **GPL / LGPL / AGPL**
- **SSPL / BSL (Business Source License)**
- **Source-available or non-commercial licenses** (e.g., CC-BY-NC, Elastic License)
- **Unclear or customized license terms**

Rather than making broad legal conclusions, the project policy is simple: these are not default choices for the MVP. If a component with one of these licenses is considered, it must be explicitly evaluated and approved via the `dependency-review` skill before any adoption.

## 4. Absolute Blocker: Unknown Licenses
- **Rule**: If a package or asset has no declared license, says "All Rights Reserved", or has missing licensing terms, **ADOPTION IS BLOCKED**.
- An undeclared license cannot be assumed to be public domain.

## 5. Vetting Procedure
Before introducing any new dependency:
1. Identify the exact license file in the upstream repository.
2. Confirm it matches an approved default permissive license (or submit for explicit review).
3. Run the `dependency-review` skill (including GitHub Scout evaluation).
4. Record the evaluation in the Execution Report.
