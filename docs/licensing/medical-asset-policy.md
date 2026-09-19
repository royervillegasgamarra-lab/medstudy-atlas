# Medical Asset & Content Provenance Policy

## 1. Principles of Medical Content Governance
Medical education requires absolute clinical reliability, accuracy, and legal compliance. MedStudy Atlas adheres to strict content governance:

1. **Copyright Compliance**: No proprietary question banks, clinical textbooks, or commercial medical atlases may be copied, scraped, or ingested without explicit written licenses.
2. **Clinical Provenance**: Every medical fact, concept relation, anatomical illustration, and clinical vignette must have traceable origin metadata.
3. **No Unverified Reuse**: Content that is free to view online (e.g., open-access websites, academic repositories, government portals) is **NOT** automatically free for commercial exploitation. Explicit commercial reuse permissions must be verified.

## 2. Medical Asset Ledger
Every external medical asset (images, illustrations, datasets, clinical reference ranges, ontologies) incorporated into MedStudy Atlas must be registered in the Medical Asset Ledger with the following metadata fields:

| Field Name | Type | Description |
| :--- | :--- | :--- |
| `sourceName` | String | Name of the institution, publisher, or author. |
| `sourceURL` | String | Direct canonical URL to the original asset. |
| `sourceId` | String | Unique identifier from the source repository (e.g., DOI, accession number). |
| `title` | String | Descriptive title or clinical description of the asset. |
| `license` | String | Exact license identifier (e.g., CC-BY-4.0, Public Domain / CC0, Custom Agreement). |
| `licenseURL` | String | Direct link to the official license terms. |
| `attribution` | String | Exact required attribution text as specified by the license or author. |
| `commercialUseAllowed` | Boolean | Must be `true` for any asset included in the platform. |
| `derivativesAllowed` | Boolean | Whether modifications, annotations, or adaptations are permitted. |
| `shareAlike` | Boolean | Whether adaptations require identical license distribution (requires review). |
| `version` | String | Asset or dataset version. |
| `retrievedAt` | ISO 8601 | Exact timestamp when the asset was retrieved. |
| `notes` | String | Clinical review notes, intended usage context, and limitations. |
| `verificationStatus` | Enum | `PENDING_REVIEW`, `VERIFIED_LEGAL`, `REJECTED`. |

## 3. Promotion Rule
**Zero-Tolerance Promotion Rule**: No medical asset or content bundle with `verificationStatus: PENDING_REVIEW` or an unverified license may be promoted to public, shared, or production catalog content.

## 4. User-Uploaded Study Materials
- When students upload personal lecture slides or notes for private study, they retain ownership of their materials.
- User-uploaded content must be stored in isolated private storage, processed only for that student's private study context, and never mixed into the global public Medical Knowledge Graph or shared question pools without explicit authorization.
