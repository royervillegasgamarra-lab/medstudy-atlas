---
name: security-review
description: >-
  Review security implications of features, architectural changes, or pull requests in MedStudy Atlas. Use this skill to evaluate authorization, authentication, tenant isolation, XSS, CSRF, SSRF, upload safety, secret leakage, injection, rate limits, webhooks, prompt injection, and cost abuse against OWASP ASVS and web security best practices.
---

# Security Review Skill

Use this skill to evaluate the security posture of any feature, architectural decision, or pull request within MedStudy Atlas.

## Review Scope & Threat Model

Evaluate changes against relevant categories from OWASP ASVS and modern web/AI application security:

1. **Authentication & Session Security**:
   - Secure token handling, short-lived sessions, proper token refresh flows.
   - No client-side storage of sensitive credentials or service-role keys.

2. **Authorization & Tenant Isolation**:
   - Strict tenant boundary enforcement at the database (PostgreSQL Row Level Security) and API layers.
   - Prevention of Insecure Direct Object References (IDOR).
   - Verification that user context cannot access another student's or institution's data.

3. **Data Ingestion & Upload Security**:
   - Content-type validation and server-side magic byte MIME checking (prevent MIME spoofing).
   - File size limits, malicious file handling (PDF bombs, zip bombs, malware).
   - Storage isolation: uploaded files must reside in private object storage with signed URL access only.

4. **Injection & Input Validation**:
   - SQL injection prevention (parameterized queries, ORM/query builder safety).
   - Cross-Site Scripting (XSS) defenses (strict output encoding, Content Security Policy).
   - Server-Side Request Forgery (SSRF) prevention on URL fetching or webhook endpoints.

5. **AI Safety & Prompt Injection**:
   - Defense against direct and indirect prompt injection in retrieval-augmented generation (RAG).
   - Treat all retrieved documents and user input as untrusted data.
   - Output sanitization before rendering AI responses in the UI.
   - Guardrails against hallucinations generating dangerous clinical recommendations (accompanied by clear educational disclaimers).

6. **Operational Security & Abuse Prevention**:
   - Rate limiting on authentication, search, and AI generation endpoints.
   - Cost-abuse protections (hard token caps, user quotas, circuit breakers).
   - Webhook signature verification and replay prevention (idempotency keys).
   - Zero hardcoded secrets in codebase or Git history.

## Applicability Rule

Do not force-fit every security category into every review. Focus deeply on the threat surface genuinely impacted by the specific changes under review.
