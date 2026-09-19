# Public Repository Safety Policy

## 1. Context & Temporary Visibility
The `medstudy-atlas` repository is temporarily **PUBLIC** solely to facilitate external architectural review, peer feedback, and governance audits.

Because this repository is public, **everything committed to Git history is instantly exposed to the entire internet and permanently cached by third-party search engines, scrapers, and archive services.**

## 2. Absolute Prohibitions (Zero-Tolerance)
The following categories of data must **NEVER** be committed under any circumstances:

1. **Secrets & Credentials**:
   - Passwords, access tokens, API keys, private keys, SSH keys.
   - Supabase keys (service role keys, anon keys with secret schemas).
   - AI provider keys (OpenAI, Anthropic, Google Gemini, Groq, etc.).
   - Payment provider credentials (Stripe, Mercado Pago, etc.).
   - Database connection strings containing passwords or hosts.
   - `.env` or `.env.local` files containing actual values.

2. **Patient Data & PHI**:
   - Protected Health Information (PHI) under HIPAA/GDPR/local privacy laws.
   - Identifiable patient records, clinical notes, patient names, dates, hospital numbers, or raw diagnostic images.

3. **Private Student & User Data**:
   - Student names, emails, academic records, grades, or personal identifiers.

4. **Proprietary & Copyrighted Content**:
   - Commercial question bank questions or answer explanations (e.g., UWorld, Amboss, Kaplan, USMLEWorld).
   - Scanned or copied pages from copyrighted commercial textbooks (e.g., Robbins, Harrison's, First Aid).
   - Proprietary third-party medical illustrations or clinical photography without documented commercial licenses.

## 3. Safe Secret Handling
- Always use environment variable references (`process.env.VARIABLE_NAME`).
- Provide sanitized examples in `.env.example` using obvious mock placeholders (e.g., `SUPABASE_URL=https://your-project.supabase.co`, `API_KEY=your_key_here`).
- **Never "commit and delete"**: Deleting a committed secret in a subsequent commit leaves it in Git history forever. If a secret is ever accidentally committed, treat it as immediately compromised, rotate it immediately, and scrub the Git history using specialized tools (e.g., `git-filter-repo` or BFG).

## 4. What Is Permitted in Phase 0
- Architectural design documents and specifications.
- Antigravity agent rules and skills (`.agents/`).
- Markdown documentation in `docs/`.
- Sanitized configuration templates (e.g., `.env.example`, tsconfig, lint configs).
- Open-source license review documentation.

## 5. Pre-Private Transition Checklist
Before the repository is eventually switched back to private, the following verification checklist must be completed:
- [ ] Run automated secret scan (e.g., `gitleaks`, `trufflehog`) across the entire Git history.
- [ ] Verify that no proprietary medical content was committed.
- [ ] Verify that all contributors and collaborators have appropriate access levels.
- [ ] Note: Remember that switching to private does NOT erase external mirrors or forks created while public. Assume anything committed while public remains public.
