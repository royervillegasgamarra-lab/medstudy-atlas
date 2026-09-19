# Open-Source & Third-Party Licensing Policy

## 1. Proprietary Nature of MedStudy Atlas
MedStudy Atlas is a commercial proprietary software platform. The codebase is **NOT** open source. All rights are reserved by the owners. No public license is granted to copy, distribute, modify, or commercialize this software.

External open-source libraries and tools utilized within MedStudy Atlas retain their respective licenses and must be vetted rigorously to ensure complete compatibility with our proprietary, commercial SaaS model.

## 2. Permitted Dependency Licenses (Generally Safe)
The following permissive open-source licenses are generally acceptable for runtime and build-time dependencies, provided their attribution and copyright notice requirements are satisfied:
- **MIT License**
- **Apache License 2.0** (includes patent grant)
- **BSD 2-Clause ("Simplified" or "FreeBSD") License**
- **BSD 3-Clause ("Revised" or "New") License**
- **ISC License**

## 3. Licenses Requiring Deeper Review (Flag & Evaluate)
Dependencies with the following licenses cannot be introduced automatically. They require explicit legal and technical compatibility analysis via the `dependency-review` skill:
- **GPL (v2, v3)**: Strict copyleft. Prohibited in any client-side bundle or statically linked code that would trigger reciprocal source code disclosure obligations.
- **LGPL (v2.1, v3)**: Weak copyleft. May be permissible if dynamically linked or used as a standalone runtime service, but requires verification that SaaS distribution does not trigger copyleft.
- **AGPL (v3)**: Network copyleft. Prohibited unless the component is run as a completely separate, unmodified standalone service that does not link into proprietary application logic.
- **Source-Available / Non-Commercial**:
  - Business Source License (BSL / BUSL)
  - Server Side Public License (SSPL)
  - Elastic License
  - CC-BY-NC (Non-Commercial Creative Commons)
  - Any license with user/revenue restrictions.

## 4. Absolute Blocker: Unknown or Ambiguous Licenses
- **Rule**: If a package or asset has no declared license, says "All Rights Reserved", or has ambiguous/conflicting license terms, **ADOPTION IS BLOCKED**.
- Absence of a license does not mean public domain; under international copyright law, the author retains all rights.

## 5. Vetting Procedure
Before introducing any new dependency:
1. Identify the exact license file in the upstream repository.
2. Run the `dependency-review` skill.
3. Record the evaluation in the PR description and Execution Report.
4. Ensure dependency notices/attributions are generated for third-party compliance.
