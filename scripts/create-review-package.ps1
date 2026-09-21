# scripts/create-review-package.ps1
# MedStudy Atlas -- Local Review Package Generator
# Generates a self-contained ZIP archive for external review without GitHub dependency.

[CmdletBinding()]
param (
    [string]$PhaseSlug = "phase-00a",
    [string]$BaseBranch = "main",
    [switch]$RunChecks = $false
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..") | Select-Object -ExpandProperty Path
$outputDir = Join-Path $repoRoot "review-output"
$packageName = "$PhaseSlug-review"
$stagingDir = Join-Path $outputDir "staging-$packageName"
$zipPath = Join-Path $outputDir "$packageName.zip"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "MedStudy Atlas -- Review Package Generator" -ForegroundColor Cyan
Write-Host "Phase: $PhaseSlug | Base: $BaseBranch | Mode: LOCAL-FIRST" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# 0. Permanent Safeguard: Verify clean working tree before packaging
Write-Host "Verifying working tree is clean..." -ForegroundColor Yellow
$porcelainStatus = (git -C $repoRoot status --porcelain)
if ($porcelainStatus) {
    Write-Host "ERROR: Review package generation ABORTED!" -ForegroundColor Red
    Write-Host "Working tree has uncommitted or untracked changes:" -ForegroundColor Red
    $porcelainStatus | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    throw "Review package generation aborted: git status --porcelain must be empty. Commit or stash all changes before generating a review package."
}
Write-Host "Working tree is clean. Proceeding with packaging..." -ForegroundColor Green

# 1. Ensure output and clean staging directory
if (-not (Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
}

if (Test-Path $stagingDir) {
    Remove-Item -Recurse -Force -Path $stagingDir
}
New-Item -ItemType Directory -Path $stagingDir -Force | Out-Null

# 2. Extract Git Evidence
Write-Host "Extracting Git evidence (baseline: $BaseBranch)..." -ForegroundColor Yellow

$currentBranch = (git -C $repoRoot branch --show-current).Trim()
$headSha = (git -C $repoRoot rev-parse HEAD).Trim()

# changed-files.txt
$changedFiles = git -C $repoRoot diff --name-status "$BaseBranch...HEAD"
$changedFiles | Out-File -FilePath (Join-Path $stagingDir "changed-files.txt") -Encoding utf8

# git-status.txt
$gitStatus = git -C $repoRoot status
$gitStatus | Out-File -FilePath (Join-Path $stagingDir "git-status.txt") -Encoding utf8

# git-log.txt
$gitLog = git -C $repoRoot log --oneline --decorate --graph "$BaseBranch..HEAD"
$gitLog | Out-File -FilePath (Join-Path $stagingDir "git-log.txt") -Encoding utf8

# git-diff.patch
$gitDiff = git -C $repoRoot diff "$BaseBranch...HEAD"
$gitDiff | Out-File -FilePath (Join-Path $stagingDir "git-diff.patch") -Encoding utf8

# repository-tree.txt
$allRepoFiles = git -C $repoRoot ls-files
$allRepoFiles | Out-File -FilePath (Join-Path $stagingDir "repository-tree.txt") -Encoding utf8

# Infer PhaseSlug from branch if not provided or default
if (-not $PhaseSlug -or $PhaseSlug -eq "phase-00a") {
    $detectedBranch = (git -C $repoRoot branch --show-current).Trim()
    if ($detectedBranch -match "phase/00b") {
        $PhaseSlug = "phase-00b"
    } elseif ($detectedBranch -match "phase/00a") {
        $PhaseSlug = "phase-00a"
    } elseif ($detectedBranch -match "phase/00c") {
        $PhaseSlug = "phase-00c"
    } elseif ($detectedBranch -match "phase/01a") {
        $PhaseSlug = "phase-01a"
    } elseif ($detectedBranch -match "phase/01b") {
        $PhaseSlug = "phase-01b"
    } elseif ($detectedBranch -match "phase/01c") {
        $PhaseSlug = "phase-01c"
    } elseif ($detectedBranch -match "phase/01d") {
        $PhaseSlug = "phase-01d"
    } elseif ($detectedBranch -match "phase/01e") {
        $PhaseSlug = "phase-01e"
    }
}

# Consistency check: Verify requested phase, current branch, execution report, and status.md
Write-Host "Verifying phase and environment consistency for $PhaseSlug..." -ForegroundColor Yellow
$branchMatches = switch -Regex ($PhaseSlug) {
    "00?a" { $currentBranch -match "phase/00a" }
    "00?b" { $currentBranch -match "phase/00b" }
    "00?c" { $currentBranch -match "phase/00c" }
    "01?a" { $currentBranch -match "phase/01a" }
    "01?b" { $currentBranch -match "phase/01b" }
    "01?c" { $currentBranch -match "phase/01c" }
    "01?d" { $currentBranch -match "phase/01d" }
    "01?e" { $currentBranch -match "phase/01e" }
    default { $true }
}
if (-not $branchMatches) {
    throw "Consistency Error: Requested phase '$PhaseSlug' does not match current branch '$currentBranch'."
}

$expectedReportMatches = Get-ChildItem -Path (Join-Path $repoRoot "docs/reports") -Filter "$PhaseSlug-*.md" -ErrorAction SilentlyContinue
if (-not $expectedReportMatches -or $expectedReportMatches.Count -eq 0) {
    throw "Consistency Error: Expected execution report 'docs/reports/$PhaseSlug-*.md' does not exist."
}

$statusContent = Get-Content (Join-Path $repoRoot "docs/status.md") -Raw -Encoding utf8
$phaseIdentifier = switch -Regex ($PhaseSlug) {
    "00?a" { "0A" }
    "00?b" { "0B" }
    "00?c" { "0C" }
    "01?a" { "1A" }
    "01?b" { "1B" }
    "01?c" { "1C" }
    "01?d" { "1D" }
    "01?e" { "1E" }
    default { $PhaseSlug }
}
if ($statusContent -notmatch $phaseIdentifier) {
    throw "Consistency Error: docs/status.md does not reference expected phase '$phaseIdentifier'."
}

if (-not $headSha) {
    throw "Consistency Error: Unable to determine git HEAD commit SHA."
}
Write-Host "Phase consistency verified: Phase=$PhaseSlug, Branch=$currentBranch, HEAD=$headSha" -ForegroundColor Green

# 3. Create Core Evidence Documents
Write-Host "Assembling core evidence documents..." -ForegroundColor Yellow

# Generate dynamic REVIEW.md based on Phase
$phaseTitle = switch -Regex ($PhaseSlug) {
    "00?a" { "Phase 0A -- Governance Bootstrap" }
    "00?b" { "Phase 0B -- Architecture Foundation" }
    "00?c" { "Phase 0C -- Engineering Baseline" }
    "01?a" { "Vertical Slice 1A -- Identity, Auth & RLS Baseline" }
    "01?b" { "Vertical Slice 1B -- Onboarding, Curriculum & Exam Targets" }
    "01?c" { "Vertical Slice 1C -- Document Library & Secure Upload" }
    "01?d" { "Phase 1D $([char]0x2014) Document Processing / Ingestion" }
    "01?e" { "Phase 1E $([char]0x2014) Deterministic Chunking, Evidence Layer & Study Pack Generation" }
    default { "$PhaseSlug -- Local Review Package" }
}

$reviewCriteria = switch -Regex ($PhaseSlug) {
    "00?a" {
        @(
            '1. [ ] **Local-First Governance**: Git local is the source of truth; no dependencies on GitHub pushes/PRs.',
            '2. [ ] **Revenue-First & Time-to-Market**: Principles prioritizing rapid student value and low operating costs (~S/10/mo) are recorded.',
            '3. [ ] **OSS-First & GitHub Scout**: Evaluation hierarchy (1-5) and candidate classification (`ADOPT`, `ADAPT`, `WATCH`, `AVOID`) are documented.',
            '4. [ ] **Proprietary Software Integrity**: Strictly proprietary notice declared; zero open-source LICENSE files added for MedStudy.',
            '5. [ ] **Review Readiness Skill**: Skill operates locally without requiring remote push or PR.',
            '6. [ ] **Zero Product Code**: Zero application code, zero database instances, zero AI providers, zero paid services.',
            '7. [ ] **Zero Secrets**: No passwords, tokens, API keys, credentials, or PHI committed.'
        )
    }
    "00?b" {
        @(
            '1. [ ] **Monolithic Modular Architecture**: Next.js App Router (current patched stable release at Phase 0C), modular folder structure (`src/modules/*`), single PostgreSQL database.',
            '2. [ ] **Lean RAG Architecture**: PostgreSQL `pgvector` hybrid search, `tsvector` FTS, reciprocal rank fusion (RRF), strict tenant isolation via `documents.user_id` join, prompt injection defense via serialized/escaped data.',
            '3. [ ] **Data Model & Strict Tenant Isolation**: Explicit tenant isolation (`documents.user_id`), cascade deletes, strict schema with `qa_status DEFAULT ''PENDING'' CHECK (qa_status IN (''PENDING'', ''PASSED'', ''FAILED''))` on `study_packs` and `questions`.',
            '4. [ ] **FSRS Spaced Repetition**: Memory-efficient FSRS algorithm via `open-spaced-repetition/ts-fsrs` (exact package version pinned in Phase 1H), zero client-side scheduling drift.',
            '5. [ ] **Selective OCR Pipeline & Worker Model**: `pdf-inspector` for selective OCR with empirical bypass rate measurement; PostgreSQL queue coordinates jobs, background worker executes processing (local dev in same repo, prod host selected before Slice 1D).',
            '6. [ ] **Cost & Threat Modeling**: Symbolic Unit Economics Framework with configurable gross margin target; lowest-cost adequate managed backup for MVP; unvalidated numbers labeled as initial configurable assumptions.',
            '7. [ ] **Zero Implementation Code**: Only architecture, research, ADRs, threat models, and documentation created; zero application packages or cloud resources.',
            '8. [ ] **Zero Secrets**: No passwords, tokens, API keys, credentials, or PHI committed.'
        )
    }
    "00?c" {
        @(
            '1. [ ] **Executable Engineering Baseline**: Next.js 16 (App Router), React 19, TypeScript strict mode, Tailwind CSS v4, and shadcn/ui operational locally.',
            '2. [ ] **Strict Quality Gates**: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` all pass cleanly with zero errors.',
            '3. [ ] **Localhost & Browser Verification**: Desktop and mobile viewports render cleanly with light/dark theme support and zero console errors.',
            '4. [ ] **Automated Testing**: Real unit tests (Vitest) and browser smoke tests (Playwright) execute and pass.',
            '5. [ ] **Architecture Alignment**: Directory structure reflects modular monolith domain boundaries (`src/modules/*`); single application repository.',
            '6. [ ] **Zero Cloud Resources & Paid Services**: No database instances, no auth providers, no AI provider keys, no external cloud spend ($0.00 cost).',
            '7. [ ] **Zero Secrets**: No passwords, tokens, API keys, credentials, or PHI committed.'
        )
    }
    "01?a" {
        @(
            '1. [ ] **Hardened Trigger & Security Definer**: `private.handle_new_user()` and `private.handle_updated_at()` are hardened with `SET search_path = ''''` with explicit schema-qualified relations and execution revoked from public/anon/authenticated.',
            '2. [ ] **Direct Profile INSERT Revoked**: Authenticated and anon direct INSERT capability revoked; profile creation strictly controlled by auth trigger.',
            '3. [ ] **Explicit Grants & Column Update Control**: Table-wide UPDATE revoked; UPDATE granted strictly on user-editable fields (`full_name`, `medical_school`, `year_of_study`, `target_exam_date`). System columns cannot be updated.',
            '4. [ ] **Canonical Schema**: Canonical table is `public.user_profiles`; unused `public.profiles` view removed; dead `target_exam_id` field removed.',
            '5. [ ] **Publishable Key Model**: `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` configured without hardcoded JWT fallback; fails clearly if missing.',
            '6. [ ] **Proxy Token Verification**: Proxy uses `supabase.auth.getClaims()` for session renewal/verification and preserves refreshed cookies and auth cache headers on redirects.',
            '7. [ ] **Mandatory RLS Test Matrix**: 57 pgTAP in-database tests verify schema, function privileges, anon denial, user A/B isolation, column-level restrictions, manual insert denial, cascade deletion, and trigger execution (`pnpm db:test`).',
            '8. [ ] **Generated Database Types**: `src/types/database.ts` generated via `pnpm db:types` and wired to Supabase clients and domain types.',
            '9. [ ] **Sanitized Backend Errors**: User-visible actions map backend/database errors to safe product messages with zero SQL/stack leaks.',
            '10. [ ] **Roadmap Consistency**: Next slice aligned as 1B — Onboarding / Curriculum / Exam Target.',
            '11. [ ] **Password Policy Baseline**: Minimum 8 characters synchronized across config, schemas, UI, and tests.',
            '12. [ ] **Zero Cloud Resources & Paid Services**: No Supabase Cloud project, no external hosting, zero spend ($0.00).'
        )
    }
    "01?b" {
        @(
            '1. [ ] **Academic Profile Normalization**: `public.user_profiles` schema normalized; `target_exam_date` removed; `year_of_study` practical range (1-10); `onboarding_completed_at` marker implemented.',
            '2. [ ] **Curriculum Schema (Subjects First)**: `public.subjects` table implemented with unique active subject index (`idx_subjects_user_name_unique`), `updated_at` trigger, and RLS.',
            '3. [ ] **Exam Targets & Ownership Integrity**: `public.exam_targets` table implemented with composite foreign key enforcing `exam_targets.user_id = subjects.user_id` when `subject_id` is set.',
            '4. [ ] **Explicit Privilege Model (GRANTS/REVOKES)**: Strict least-privilege GRANTS on `subjects` and `exam_targets`; direct table DELETE revoked; column-level UPDATE restrictions.',
            '5. [ ] **In-Database Security Matrix (pgTAP)**: Comprehensive in-database test suites verify anon denial, user isolation, active subject deduplication, ownership integrity, and cascade deletion.',
            '6. [ ] **Server-Side Onboarding Completion**: Server validates that at least one active subject exists before setting `onboarding_completed_at`; client cannot forge completion.',
            '7. [ ] **Authenticated Routing & Resumability**: `/onboarding` is protected; uncompleted users visiting `/app` redirect to `/onboarding`; completed users visiting `/onboarding` redirect to `/app`; progress is safely resumable.',
            '8. [ ] **First Useful Dashboard**: Displays greeting, active subjects, upcoming exam countdown, subject and exam management; zero fake AI data.',
            '9. [ ] **Timezone-Safe Date Handling**: Calendar date parsing and countdown without UTC timezone shift.',
            '10. [ ] **Automated Tests**: Unit tests, database tests, and Playwright E2E tests (onboarding lifecycle, management, two-user isolation) pass cleanly.',
            '11. [ ] **Course Hierarchy Simplification**: Documented explicitly; Course entity deferred to post-MVP.',
            '12. [ ] **Zero Cloud Resources & Paid Services**: Local-First execution; $0.00 cost.'
        )
    }
    "01?c" {
        @(
            '1. [ ] **Reservation-Backed Storage RLS & Direct Authenticated Upload**: Private Supabase Storage bucket (`documents`, `public = false`), canonical object keys (`{user_id}/{doc_id}/source.pdf`), direct client-to-storage upload via authenticated `upload()` with `upsert: false`. Storage INSERT RLS strictly validates active UPLOADING reservation owned by `auth.uid()` with matching key. Reusable signed upload capability eliminated. Broad `storage.objects` permissions removed.',
            '2. [ ] **Privileged Finalization Boundary & Safe Two-Step Cleanup**: Authenticated browser cannot invoke `READY` transition directly. Finalization is strictly executed by trusted server code calling `finalize_document_upload_privileged` (callable ONLY by `service_role`). Safe two-step cleanup (UPLOADING -> CLEANUP_PENDING -> physical remove -> REJECTED/FAILED) ensures quota safety under transient failures.',
            '3. [ ] **Container-Level File Validation & Bounded Range Read**: Server-side inspection of `%PDF-` magic bytes via HTTP Range request on internal signed URL (HTTP 206, byteLength <= 5, timeout), avoiding 25 MB memory downloads. Non-PDFs rejected and physically deleted.',
            '4. [ ] **Metadata & Composite Foreign Key**: `public.documents` table with composite foreign key `(subject_id, user_id) REFERENCES public.subjects(id, user_id)` and input check constraints.',
            '5. [ ] **Centralized & Concurrency-Safe Quotas**: 25MB max file size, 10 active documents, 100MB total active storage (counting `READY`, `CLEANUP_PENDING`, and unexpired `UPLOADING` reservations within 2-hour lease). Concurrency serialized per user via `pg_advisory_xact_lock`. Declared size must equal actual size.',
            '6. [ ] **Privileged Archive & Physical Storage Cleanup**: Archiving physically deletes storage object via official Storage API with explicit error inspection before calling `archive_document_privileged` (service_role only). Quota freed only on confirmed blob removal.',
            '7. [ ] **Short-Lived Signed Download URLs**: Authorized downloads use signed URLs with 300s TTL. Direct public URLs and direct storage SELECT are denied.',
            '8. [ ] **Document Library UI & PHI Warning**: Mobile-first responsive library at `/app/documents`, drag-and-drop uploader with mandatory educational-use PHI warning banner, quota progress bar, and soft-delete archive with confirmation.',
            '9. [ ] **In-Database Security Matrix (pgTAP)**: 62 pgTAP tests in `03_documents_rls.sql` verify table schema, absence of `finalize_token`, anon denials, direct mutation denials, input constraints, quota limits, lease expiration, authenticated archive denial, two-user isolation, storage INSERT RLS policy, and archive idempotency.',
            '10. [ ] **Authoritative Storage API Integration Tests**: 27 authoritative integration tests in `tests/integration/storage-security.test.ts` verify direct upload denial without reservation, reservation-backed upload success, fake PDF rejection with physical blob cleanup, size mismatch rejection with real object, authenticated archive denial, storage error handling, cross-user download denial, token reuse prevention, abandoned upload recovery, CLEANUP_PENDING recovery, archive idempotency, adversarial archive/upload TOCTOU race prevention, real concurrent quota serialization, real size-mismatch physical cleanup, DB cleanup completion failure recovery, and Storage 404 error classification (NoSuchKey vs NoSuchBucket vs ambiguous 404).',
            '11. [ ] **E2E & Browser Verification (Playwright)**: E2E tests verify onboarding-to-upload flow, fake PDF rejection in UI, valid PDF READY, user-content XSS regression, mobile & desktop rendering, and archival.',
            '12. [ ] **Zero AI & Cloud Spend**: No text extraction, OCR, embeddings, vector search, or external paid storage introduced ($0.00 cloud spend).'
        )
    }
    "01?d" {
        @(
            '1. [ ] **Subprocess Security Boundary & Stripped Environment**: Application credentials are not inherited through the parser child-process environment. The Python parser runs with a strictly stripped environment (`createSafeParserEnvironment`); zero Supabase secret keys, service-role keys, database URLs, AI keys, or auth tokens are passed to the parser.',
            '2. [ ] **Structural Preflight (`qpdf` 12.4.1)**: `qpdf --is-encrypted`, `qpdf --check`, and `qpdf --show-npages` detect encrypted PDFs (`PDF_ENCRYPTED`), corrupt PDFs (`PDF_CORRUPT`), zero-page PDFs (`PDF_ZERO_PAGES`), and oversized page counts (`PDF_PAGE_COUNT_EXCEEDED` > 300 pages) before text parsing. Diagnostic output stream bounded to 64 KB per stdout/stderr diagnostic stream (`PREFLIGHT_FAILED`).',
            '3. [ ] **Native Text Extraction & Provenance (`pypdfium2` 5.13.0)**: Native digital text extracted via PDFium; page dimensions, character counts, and SHA-256 hashes recorded. Pages with >= 50 native characters bypass OCR entirely.',
            '4. [ ] **Selective Local OCR (`tesseract` 5.5.3)**: Pages with < 50 native characters undergo local Tesseract OCR using strictly `spa+eng` language packs. Render scale capped with pixel limit validation (12M max pixels/page). Max 60 OCR pages enforced per document (`OCR_PAGE_LIMIT`). Text length bounded per page (`TEXT_PAGE_LIMIT`) and per document (`TEXT_DOCUMENT_LIMIT`).',
            '5. [ ] **Worker Lease Fencing & Concurrency Control**: `claim_next_processing_run` generates fresh `claim_token UUID` and enforces `lease_expires_at`. Privileged persist and fail RPCs require an active non-null lease and claim token matching `status = ''RUNNING'' AND claim_token = p_claim_token AND lease_expires_at > NOW()` (raises 55000 otherwise).',
            '6. [ ] **Trusted Node Orchestrator Semantic Provenance**: Node layer independently verifies source SHA-256, per-page text SHA-256, Unicode code points, aggregate counters, and pipeline version before persisting.',
            '7. [ ] **Bounded Parser Output Reads**: Node orchestrator checks file counts, manifest size (<= 64 KB), and page JSON size (<= 1.5 MB) before reading files into memory.',
            '8. [ ] **Storage Error Classification & Archive Race Closure**: Confirmed missing source classified as `SOURCE_MISSING` (terminal); bucket/network errors classified as `STORAGE_UNAVAILABLE` (retryable). Document archiving terminally cancels active runs and deletes derived pages.',
            '9. [ ] **Database Schema & Composite Foreign Keys**: `public.document_processing_runs` has `UNIQUE (id, document_id, user_id)`. `public.document_pages` enforces composite FK `(processing_run_id, document_id, user_id)` preventing cross-tenant references.',
            '10. [ ] **Terminal Retry Semantics & UI Integration**: Max 3 attempts enforced (`FAILED_FINAL` cannot be re-enqueued or claimed); UI displays live badges, "Error no recuperable", "Procesar", and "Reintentar".',
            '11. [ ] **Automated Test Suites**: 55 pgTAP tests (`04_processing_runs_rls.sql`, 245 total DB tests), 38 unit tests (`parser.test.ts`), 8 provenance tests (`provenance.test.ts`), 17 integration tests (`processing-worker.test.ts`, 186 total Vitest tests), and Playwright E2E tests pass cleanly.',
            '12. [ ] **Zero Cloud Resources & Paid Services**: Local-First execution; $0.00 cost.'
        )
    }
    "01?e" {
        @(
            '1. [ ] **Page-Bounded Deterministic Chunking**: `document_chunks` partitions physical pages without crossing page boundaries (`page_start === page_end`). Target 400-800 tokens, 10-15% overlap. Primary keys refetched to guarantee valid database UUID provenance for citations.',
            '2. [ ] **Two-Call LLM Generation & Evidence Verification Pipeline**: Call 1 produces candidate sections (Summary, Objectives, Concepts, High-Yield Points, Key Terms Glossary) with candidate chunk IDs. Call 2 independently verifies factual textual support against cited chunks (`evidence-verifier.ts`).',
            '3. [ ] **Deterministic Citation Validation (`citation-validator.ts`)**: Model is NEVER trusted to output page numbers. Server validates chunk IDs and derives authoritative page numbers from database chunks. Strips hallucinated chunk IDs. Validates quote snippets with substring and fuzzy matching.',
            '4. [ ] **Strict QA Quality Gate**: Rejects candidate packs unless satisfying >= 1 Summary, >= 1 Objective, >= 1 Concept, and >= 50% supported claims (`INSUFFICIENT_EVIDENCE` / `FAILED_FINAL`).',
            '5. [ ] **Cached Study Pack Read Guarantee**: Generated Study Packs are cached in PostgreSQL (`study_packs`, `study_pack_items`, `study_pack_item_citations`). Reloads and views make zero AI calls ($0.00 spend).',
            '6. [ ] **Thin `AIProvider` Abstraction & Mock Provider**: Application decoupled from heavy agentic frameworks. `MockAIProvider` enables deterministic local verification at $0.00 cost; `OpenAICompatibleProvider` enables production deployment.',
            '7. [ ] **Cost Engine & Telemetry Tracking**: `pricing.ts` accurately computes token costs with cached token discounting (`uncachedInput = Math.max(0, inputTokens - cachedTokens)`). Telemetry logged to `public.ai_usages` with costs tracked to 6 decimal places.',
            '8. [ ] **Database Schema, Composite Foreign Keys & RLS**: 5 tables (`document_chunks`, `study_packs`, `study_pack_items`, `study_pack_item_citations`, `ai_usages`) with composite FKs. Direct mutations revoked; privileged RPCs control queue and writes. 54 pgTAP tests passing in `05_chunks_and_study_packs_rls.sql`.',
            '9. [ ] **Worker Lease Fencing & Concurrency Control**: `study-packs-worker.ts` claims jobs via `claim_next_study_pack` (`FOR UPDATE SKIP LOCKED`) with fencing token `claim_token UUID` and lease expiration. Expired or missing leases immediately revoke write authority with SQLSTATE 55000.',
            '10. [ ] **Scientific Presentation UI**: Responsive study pack view with interactive citation badges (`Pág. X`), coverage & provenance disclosure panel, library status badges, and React plain-text escaping (zero `dangerouslySetInnerHTML`).',
            '11. [ ] **Synthetic Medical Lecture Benchmark Harness**: Opt-in developer CLI (`pnpm ai:benchmark:study-pack`) evaluates 5 realistic medical fixtures with 100% QA pass rate and $0.00 cost.',
            '12. [ ] **Automated Test Suite**: 231 Vitest tests, 299 pgTAP database tests, and Playwright E2E test pass cleanly with zero secrets committed.'
        )
    }
    default {
        @(
            '1. [ ] **Local-First Compliance**: Work matches phase objectives without remote dependencies.',
            '2. [ ] **Verification**: Applicable automated or manual checks executed.',
            '3. [ ] **Zero Secrets**: No credentials or private tokens committed.'
        )
    }
}

$nextStep = switch -Regex ($PhaseSlug) {
    "00?a" {
        @(
            '## 4. Next Step Upon Approval',
            "Upon approval of this review package, merge $currentBranch into $BaseBranch locally via squash merge:",
            '```powershell',
            "git checkout $BaseBranch",
            "git merge --squash $currentBranch",
            'git commit -m "chore(phase-0a): complete governance bootstrap"',
            '```',
            'Then proceed to **Phase 0B -- Architecture Foundation** (`phase/00b-architecture`).'
        )
    }
    "00?b" {
        @(
            '## 4. Next Step Upon Approval',
            "Upon approval of this review package, merge $currentBranch into $BaseBranch locally via squash merge:",
            '```powershell',
            "git checkout $BaseBranch",
            "git merge --squash $currentBranch",
            'git commit -m "chore(phase-0b): complete architecture foundation"',
            '```',
            'Then proceed to **Phase 0C -- Engineering Baseline** (`phase/00c-engineering`).'
        )
    }
    "00?c" {
        @(
            '## 4. Next Step Upon Approval',
            "Upon approval of this review package, merge $currentBranch into $BaseBranch locally via squash merge:",
            '```powershell',
            "git checkout $BaseBranch",
            "git merge --squash $currentBranch",
            'git commit -m "chore(phase-0c): complete engineering baseline"',
            '```',
            'Then proceed to **Vertical Slice 1A -- Identity, Auth & RLS Baseline** (`phase/01a-identity`).'
        )
    }
    "01?a" {
        @(
            '## 4. Next Step Upon Approval',
            "Upon approval of this review package, merge $currentBranch into $BaseBranch locally via squash merge:",
            '```powershell',
            "git checkout $BaseBranch",
            "git merge --squash $currentBranch",
            'git commit -m "feat(phase-01a): implement identity, auth, and rls baseline"',
            '```',
            'Then proceed to **Vertical Slice 1B -- Onboarding / Curriculum / Exam Target** (`phase/01b-onboarding`).'
        )
    }
    "01?b" {
        @(
            '## 4. Next Step Upon Approval',
            "Upon approval of this review package, merge $currentBranch into $BaseBranch locally via squash merge:",
            '```powershell',
            "git checkout $BaseBranch",
            "git merge --squash $currentBranch",
            'git commit -m "feat(phase-01b): implement onboarding, curriculum, and exam targets"',
            '```',
            'Then proceed to **Vertical Slice 1C -- Document Library & Secure Upload** (`phase/01c-documents`).'
        )
    }
    "01?c" {
        @(
            '## 4. Next Step Upon Approval',
            "Upon approval of this review package, merge $currentBranch into $BaseBranch locally via squash merge:",
            '```powershell',
            "git checkout $BaseBranch",
            "git merge --squash $currentBranch",
            'git commit -m "feat(phase-01c): implement document library and secure upload boundary"',
            '```',
            'Then proceed to **Vertical Slice 1D -- Secure Document Processing / Ingestion & Page Provenance** (`phase/01d-processing`).'
        )
    }
    "01?d" {
        @(
            '## 4. Next Step Upon Approval',
            "Upon approval of this review package, merge $currentBranch into $BaseBranch locally via squash merge:",
            '```powershell',
            "git checkout $BaseBranch",
            "git merge --squash $currentBranch",
            'git commit -m "feat(phase-01d): implement secure document processing and page provenance"',
            '```',
            'Then proceed to **Vertical Slice 1E -- Deterministic Chunking & Study Pack Generation** (`phase/01e-study-packs`).'
        )
    }
    "01?e" {
        @(
            '## 4. Next Step Upon Approval',
            "Upon approval of this review package, merge $currentBranch into $BaseBranch locally via squash merge:",
            '```powershell',
            "git checkout $BaseBranch",
            "git merge --squash $currentBranch",
            'git commit -m "feat(phase-01e): implement deterministic chunking, evidence layer and study pack generation"',
            '```',
            'Then proceed to **Vertical Slice 1F -- Context-Grounded AI Tutor & Hybrid Vector Retrieval** (`phase/01f-tutor-rag`).'
        )
    }
    default {
        @(
            '## 4. Next Step Upon Approval',
            "Upon approval of this review package, merge $currentBranch into $BaseBranch locally via squash merge:",
            '```powershell',
            "git checkout $BaseBranch",
            "git merge --squash $currentBranch",
            "git commit -m `"chore($PhaseSlug): complete phase`"",
            '```'
        )
    }
}

$reviewLines = @(
    '# MedStudy Atlas -- External Review Package',
    "**Phase**: $phaseTitle",
    '**Development Mode**: LOCAL-FIRST',
    "**Target Branch**: $currentBranch",
    "**Baseline Branch**: $BaseBranch",
    "**Commit SHA**: $headSha",
    "**Generated**: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')",
    '',
    '---',
    '',
    '## 1. Purpose of this Package',
    "This self-contained review package provides complete review evidence for **$phaseTitle** under MedStudy Atlas's **LOCAL-FIRST** development model. No GitHub access, remote pushes, or cloud services are required to conduct this review.",
    '',
    '## 2. Package Contents',
    '- `REVIEW.md` -- This review guide and summary.',
    ('- `execution-report.md` -- The standardized ' + $phaseTitle + ' Execution Report.'),
    ('- `failure-matrix.md` -- The ' + $phaseTitle + ' Failure Matrix.'),
    '- `status.md` -- Current project status and subsystem states.',
    '- `test-results.md` -- Verification and test suite execution status.',
    ('- `changed-files.txt` -- List of all files changed relative to ' + $BaseBranch + '.'),
    '- `git-status.txt` -- Exact git status snapshot at package generation.',
    ('- `git-log.txt` -- Commit history of the phase branch against ' + $BaseBranch + '.'),
    ('- `git-diff.patch` -- Unified diff patch showing all code/doc modifications.'),
    '- `repository-tree.txt` -- Full file tree of the repository.',
    '- `governance/` -- Core governance policies, CI policy, and project charter.',
    '- `agents/` -- Workspace invariant rules and agent skills (`.agents/`).',
    '- `relevant-docs/` -- Additional relevant documentation (licensing, security, architecture, product, ADRs, roadmaps, engineering).',
    '- `source/` -- Application source code (`src/`), test suite (`tests/`), configuration files, and verification screenshots (`docs/screenshots/`).',
    '',
    '## 3. Review Objectives & Checklist',
    "Please verify the following $phaseTitle criteria:"
)
$reviewLines += $reviewCriteria
$reviewLines += ''
$reviewLines += $nextStep

$reviewLines | Out-File -FilePath (Join-Path $stagingDir "REVIEW.md") -Encoding utf8

# execution-report.md
$matchedReports = Get-ChildItem -Path (Join-Path $repoRoot "docs/reports") -Filter "$PhaseSlug-*.md" -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch 'failure-matrix' }
if ($matchedReports -and $matchedReports.Count -gt 0) {
    Copy-Item -Path $matchedReports[0].FullName -Destination (Join-Path $stagingDir "execution-report.md")
} else {
    Write-Host "ERROR: Review package generation ABORTED!" -ForegroundColor Red
    Write-Host "Expected execution report not found for phase: $PhaseSlug in docs/reports/" -ForegroundColor Red
    throw "Review package generation aborted: Expected phase execution report (docs/reports/$PhaseSlug-*.md) missing. Falling back to an older phase report is strictly prohibited."
}

# failure-matrix.md
$matchedMatrix = Get-ChildItem -Path (Join-Path $repoRoot "docs/reports") -Filter "$PhaseSlug-failure-matrix.md" -ErrorAction SilentlyContinue
if ($matchedMatrix -and $matchedMatrix.Count -gt 0) {
    Copy-Item -Path $matchedMatrix[0].FullName -Destination (Join-Path $stagingDir "failure-matrix.md")
}

# status.md
$statusSource = Join-Path $repoRoot "docs/status.md"
if (Test-Path $statusSource) {
    Copy-Item -Path $statusSource -Destination (Join-Path $stagingDir "status.md")
}

# test-results.md
if (Test-Path (Join-Path $repoRoot "package.json")) {
    $resultsDir = Join-Path $outputDir "test-evidence"

    # If -RunChecks was requested, execute commands and save logs to test-evidence/
    if ($RunChecks) {
        Write-Host "Executing quality checks to capture actual test evidence..." -ForegroundColor Yellow
        if (-not (Test-Path $resultsDir)) {
            New-Item -ItemType Directory -Path $resultsDir -Force | Out-Null
        }

        # Ensure Docker Desktop is in PATH if installed in user or system locations
        $dockerPaths = @(
            "C:\Users\DR_ CHAPATIN\AppData\Local\Programs\DockerDesktop\resources\bin",
            "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin",
            "$env:ProgramFiles\Docker\Docker\resources\bin",
            "C:\Program Files\Tesseract-OCR",
            (Join-Path $repoRoot "tools\bin\qpdf\bin")
        )
        foreach ($dp in $dockerPaths) {
            if ((Test-Path $dp) -and ($env:PATH -notlike "*$dp*")) {
                $env:PATH = "$dp;$env:PATH"
            }
        }

        $checksToRun = @(
            @{ Name = "install"; Cmd = "pnpm install --frozen-lockfile" },
            @{ Name = "format"; Cmd = "pnpm format:check" },
            @{ Name = "lint"; Cmd = "pnpm lint" },
            @{ Name = "typecheck"; Cmd = "pnpm typecheck" },
            @{ Name = "unit"; Cmd = "pnpm test" }
        )

        $pkgJson = Get-Content (Join-Path $repoRoot "package.json") -Raw | ConvertFrom-Json
        if ($pkgJson.scripts.PSObject.Properties['db:reset']) {
            $checksToRun += @{ Name = "db-reset"; Cmd = "pnpm db:reset" }
        }
        if ($pkgJson.scripts.PSObject.Properties['db:types']) {
            $checksToRun += @{ Name = "db-types"; Cmd = "pnpm db:types" }
        }
        if ($pkgJson.scripts.PSObject.Properties['db:test']) {
            $checksToRun += @{ Name = "database"; Cmd = "pnpm db:test" }
        }
        if ($pkgJson.scripts.PSObject.Properties['build']) {
            $checksToRun += @{ Name = "build"; Cmd = "pnpm build" }
        }
        if ($pkgJson.scripts.PSObject.Properties['test:e2e']) {
            $checksToRun += @{ Name = "e2e"; Cmd = "pnpm test:e2e" }
        }
        $checksToRun += @{ Name = "audit"; Cmd = "pnpm audit" }

        if ($PhaseSlug -match "01?d") {
            $checksToRun += @(
                @{ Name = "python-version"; Cmd = "python --version" },
                @{ Name = "qpdf-version"; Cmd = "qpdf --version" },
                @{ Name = "tesseract-version"; Cmd = "tesseract --version" },
                @{ Name = "tesseract-langs"; Cmd = "tesseract --list-langs" }
            )
        }

        if ($PhaseSlug -match "01?e") {
            $checksToRun += @(
                @{ Name = "benchmark"; Cmd = "pnpm ai:benchmark:study-pack" }
            )
        }

        $repoTestResultsDir = Join-Path $repoRoot "test-results"
        if (-not (Test-Path $repoTestResultsDir)) {
            New-Item -ItemType Directory -Path $repoTestResultsDir -Force | Out-Null
        }

        foreach ($chk in $checksToRun) {
            Write-Host "  Running $($chk.Cmd)..." -ForegroundColor Cyan
            $logFile = Join-Path $resultsDir "$($chk.Name).log"
            $repoLogFile = Join-Path $repoTestResultsDir "$($chk.Name).log"
            $out = & cmd.exe /c "$($chk.Cmd) 2>&1"
            $exitCode = $LASTEXITCODE
            $header = "COMMAND: $($chk.Cmd)`nEXIT_CODE: $exitCode`nTIMESTAMP: $(Get-Date -Format 'o')`nBRANCH: $currentBranch`nHEAD_SHA: $headSha`nPHASE: $PhaseSlug`n---`n"
            $fullLogContent = $header + ($out -join "`n")
            Set-Content -Path $logFile -Value $fullLogContent -Encoding utf8
            Set-Content -Path $repoLogFile -Value $fullLogContent -Encoding utf8
        }

        # Synchronize all logs from resultsDir to repoTestResultsDir in case a test runner (e.g. Playwright) wiped test-results
        Get-ChildItem -Path $resultsDir -Filter "*.log" | ForEach-Object {
            Copy-Item -Path $_.FullName -Destination (Join-Path $repoTestResultsDir $_.Name) -Force
        }

        # If test:e2e re-generated existing committed screenshots in docs/screenshots or modified next-env.d.ts, restore them to clean commit state
        $screenshotStatus = git -C $repoRoot status --porcelain docs/screenshots 2>$null
        if ($screenshotStatus) {
            git -C $repoRoot checkout -- docs/screenshots 2>$null
        }
        $nextEnvStatus = git -C $repoRoot status --porcelain next-env.d.ts 2>$null
        if ($nextEnvStatus) {
            git -C $repoRoot checkout -- next-env.d.ts 2>$null
        }
    }

    $checkDefinitions = @(
        @{ Label = "Frozen Lockfile Install (`pnpm install --frozen-lockfile`)"; Key = "install"; Mandatory = $true },
        @{ Label = "Format Check (`pnpm format:check`)"; Key = "format"; Mandatory = $true },
        @{ Label = "Lint (`pnpm lint`)"; Key = "lint"; Mandatory = $true },
        @{ Label = "Typecheck (`pnpm typecheck`)"; Key = "typecheck"; Mandatory = $true },
        @{ Label = "Unit Tests (`pnpm test`)"; Key = "unit"; Mandatory = $true },
        @{ Label = "Database Reset (`pnpm db:reset`)"; Key = "db-reset"; Mandatory = $true },
        @{ Label = "Database Types (`pnpm db:types`)"; Key = "db-types"; Mandatory = $true },
        @{ Label = "Database Tests (`pnpm db:test`)"; Key = "database"; Mandatory = $true },
        @{ Label = "Production Build (`pnpm build`)"; Key = "build"; Mandatory = $true },
        @{ Label = "E2E Smoke Tests (`pnpm test:e2e`)"; Key = "e2e"; Mandatory = $true },
        @{ Label = "Dependency Audit (`pnpm audit`)"; Key = "audit"; Mandatory = $false }
    )

    if ($PhaseSlug -match "01?d") {
        $checkDefinitions += @(
            @{ Label = 'Python Version (`python --version`)'; Key = "python-version"; Mandatory = $true },
            @{ Label = 'QPDF Version (`qpdf --version`)'; Key = "qpdf-version"; Mandatory = $true },
            @{ Label = 'Tesseract Version (`tesseract --version`)'; Key = "tesseract-version"; Mandatory = $true },
            @{ Label = 'Tesseract Languages (`tesseract --list-langs`)'; Key = "tesseract-langs"; Mandatory = $true }
        )
    }

    if ($PhaseSlug -match "01?e") {
        $checkDefinitions += @(
            @{ Label = 'AI Benchmark Suite (`pnpm ai:benchmark:study-pack`)'; Key = "benchmark"; Mandatory = $true }
        )
    }

    $stagedResultsDir = Join-Path $stagingDir "test-results"
    $gateLines = @()
    $details = @()
    $anyRan = $false
    $allPassed = $true
    $missingMandatory = @()
    $failedChecks = @()
    $staleChecks = @()
    $branchMismatchChecks = @()
    $phaseMismatchChecks = @()

    foreach ($def in $checkDefinitions) {
        $logFile = Join-Path (Join-Path $repoRoot "test-results") "$($def.Key).log"
        if (-not (Test-Path $logFile)) {
            $fallbackFile = Join-Path $resultsDir "$($def.Key).log"
            if (Test-Path $fallbackFile) {
                $logFile = $fallbackFile
            }
        }
        if (Test-Path $logFile) {
            $anyRan = $true
            if (-not (Test-Path $stagedResultsDir)) {
                New-Item -ItemType Directory -Path $stagedResultsDir -Force | Out-Null
            }
            Copy-Item -Path $logFile -Destination (Join-Path $stagedResultsDir "$($def.Key).log") -Force

            $rawContent = Get-Content -Path $logFile -Raw -Encoding utf8
            $isPass = $false
            $isUnavailable = $false
            $isStale = $false
            $isBranchMismatch = $false
            $isPhaseMismatch = $false

            if ($def.Key -eq "audit" -and ($rawContent -match 'ENOTFOUND|getaddrinfo|ECONNREFUSED|registry.*unavailable|network.*unavailable|fetch failed|NOT EXECUTED.*UNAVAILABLE')) {
                $isUnavailable = $true
            } elseif ($rawContent -match 'EXIT_CODE:\s*0\b') {
                $isPass = $true
            } elseif ($rawContent -notmatch 'EXIT_CODE:' -and ($rawContent -match 'passed|success|All matched files use Prettier|No known vulnerabilities found')) {
                $isPass = $true
            }

            # Check metadata in header if present
            if ($rawContent -match 'HEAD_SHA:\s*([a-f0-9]+)') {
                $loggedSha = $matches[1].Trim()
                if ($loggedSha -ne $headSha) {
                    $isStale = $true
                }
            } elseif ($def.Mandatory) {
                $isStale = $true
            }

            if ($rawContent -match 'BRANCH:\s*([^\r\n]+)') {
                $loggedBranch = $matches[1].Trim()
                if ($loggedBranch -ne $currentBranch) {
                    $isBranchMismatch = $true
                }
            } elseif ($def.Mandatory) {
                $isBranchMismatch = $true
            }

            if ($rawContent -match 'PHASE:\s*([^\r\n]+)') {
                $loggedPhase = $matches[1].Trim()
                if ($loggedPhase -ne $PhaseSlug) {
                    $isPhaseMismatch = $true
                }
            } elseif ($def.Mandatory) {
                $isPhaseMismatch = $true
            }

            if ($isUnavailable) {
                $gateLines += "- **$($def.Label)**: NOT EXECUTED -- REGISTRY/NETWORK UNAVAILABLE (Verified from log: ``test-results/$($def.Key).log``)"
            } elseif ($isStale) {
                $allPassed = $false
                $staleChecks += $def.Label
                $gateLines += "- **$($def.Label)**: STALE EVIDENCE -- HEAD_SHA MISMATCH (Verified from log: ``test-results/$($def.Key).log``)"
            } elseif ($isBranchMismatch) {
                $allPassed = $false
                $branchMismatchChecks += $def.Label
                $gateLines += "- **$($def.Label)**: BRANCH MISMATCH (Verified from log: ``test-results/$($def.Key).log``)"
            } elseif ($isPhaseMismatch) {
                $allPassed = $false
                $phaseMismatchChecks += $def.Label
                $gateLines += "- **$($def.Label)**: PHASE MISMATCH (Verified from log: ``test-results/$($def.Key).log``)"
            } elseif ($isPass) {
                $gateLines += "- **$($def.Label)**: PASS (Verified from actual execution log: ``test-results/$($def.Key).log``)"
            } else {
                $allPassed = $false
                $failedChecks += $def.Label
                $gateLines += "- **$($def.Label)**: FAIL (Verified from actual execution log: ``test-results/$($def.Key).log``)"
            }

            $lines = Get-Content -Path $logFile -Encoding utf8
            $snippet = if ($lines.Count -gt 25) { ($lines[0..24] -join "`n") + "`n... [truncated, see test-results/$($def.Key).log for full output]" } else { $lines -join "`n" }
            $details += "#### $($def.Label)"
            $details += '```'
            $details += $snippet
            $details += '```'
            $details += ''
        } else {
            $gateLines += "- **$($def.Label)**: NOT EXECUTED"
            if ($def.Mandatory) {
                $allPassed = $false
                $missingMandatory += $def.Label
            }
        }
    }

    # Reject missing, failed, stale, or mismatched mandatory checks
    if ($missingMandatory.Count -gt 0) {
        Write-Host "ERROR: Review package generation ABORTED!" -ForegroundColor Red
        Write-Host "Missing required evidence for mandatory quality gates:" -ForegroundColor Red
        $missingMandatory | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
        throw "Review package generation aborted: Missing mandatory test evidence ($($missingMandatory -join ', ')). Run verification checks first or pass -RunChecks."
    }

    if ($staleChecks.Count -gt 0) {
        Write-Host "ERROR: Review package generation ABORTED!" -ForegroundColor Red
        Write-Host "Stale evidence detected (log HEAD_SHA does not match current HEAD $headSha):" -ForegroundColor Red
        $staleChecks | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
        throw "Review package generation aborted: Stale test evidence detected ($($staleChecks -join ', ')). Rerun verification checks on current commit."
    }

    if ($branchMismatchChecks.Count -gt 0) {
        Write-Host "ERROR: Review package generation ABORTED!" -ForegroundColor Red
        Write-Host "Branch mismatch detected (log BRANCH does not match current branch $currentBranch):" -ForegroundColor Red
        $branchMismatchChecks | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
        throw "Review package generation aborted: Branch mismatch detected ($($branchMismatchChecks -join ', '))."
    }

    if ($phaseMismatchChecks.Count -gt 0) {
        Write-Host "ERROR: Review package generation ABORTED!" -ForegroundColor Red
        Write-Host "Phase mismatch detected (log PHASE does not match requested phase $PhaseSlug):" -ForegroundColor Red
        $phaseMismatchChecks | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
        throw "Review package generation aborted: Phase mismatch detected ($($phaseMismatchChecks -join ', '))."
    }

    if ($failedChecks.Count -gt 0) {
        Write-Host "ERROR: Review package generation ABORTED!" -ForegroundColor Red
        Write-Host "Quality gate failures detected:" -ForegroundColor Red
        $failedChecks | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
        throw "Review package generation aborted: Quality gate failures detected ($($failedChecks -join ', '))."
    }

    # Post-verification clean tree check
    Write-Host "Verifying working tree remains clean after quality checks..." -ForegroundColor Yellow
    $postCheckStatus = (git -C $repoRoot status --porcelain)
    if ($postCheckStatus) {
        Write-Host "ERROR: Review package generation ABORTED!" -ForegroundColor Red
        Write-Host "Working tree was modified during check execution or has uncommitted changes:" -ForegroundColor Red
        $postCheckStatus | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
        throw "Review package generation aborted: git status --porcelain must be empty after running checks."
    }
    Write-Host "Working tree remains clean." -ForegroundColor Green

    $overallStatus = if (-not $anyRan) {
        "NO TESTS EXECUTED FOR THIS REVIEW ARTIFACT"
    } elseif ($allPassed) {
        "ALL EXECUTED CHECKS PASSING (GREEN)"
    } else {
        "SOME CHECKS FAILED (RED)"
    }

    $testLines = @(
        "# Test Results -- $phaseTitle",
        '',
        "**Status**: $overallStatus",
        '**Evidence Source**: Actual command execution logs in `test-results/`',
        "**Generated**: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')",
        '',
        '### Quality Gate Results:'
    ) + $gateLines

    if ($details.Count -gt 0) {
        $testLines += ''
        $testLines += '### Actual Command Execution Evidence:'
        $testLines += $details
    } else {
        $testLines += ''
        $testLines += '> **Note**: No execution logs were found in `test-results/`. Real verification output or `-RunChecks` execution is required for external review evidence.'
    }
} else {
    $testLines = @(
        "# Test Results -- $PhaseSlug",
        '',
        '**Status**: NOT APPLICABLE -- APPLICATION TOOLING NOT YET IMPLEMENTED',
        '',
        '### Detail:',
        "- $PhaseSlug establishes workspace governance and architecture documentation.",
        '- Zero application code, package managers (pnpm/npm), or test runners (Vitest/Jest/Playwright) are installed.',
        '- Automated tests and verification pipelines will be formally authored and activated in **Phase 0C (Engineering Baseline)**.'
    )
}
$testLines | Out-File -FilePath (Join-Path $stagingDir "test-results.md") -Encoding utf8

# 4. Copy Subsystems: governance/, agents/, relevant-docs/, source/
Write-Host "Copying governance, agent, documentation, and source files..." -ForegroundColor Yellow

# governance/
$govDir = Join-Path $stagingDir "governance"
New-Item -ItemType Directory -Path $govDir -Force | Out-Null
Copy-Item -Path (Join-Path $repoRoot "docs/engineering/development-governance.md") -Destination $govDir -ErrorAction SilentlyContinue
Copy-Item -Path (Join-Path $repoRoot "docs/engineering/ci-policy.md") -Destination $govDir -ErrorAction SilentlyContinue
Copy-Item -Path (Join-Path $repoRoot "docs/engineering/antigravity-hooks-plan.md") -Destination $govDir -ErrorAction SilentlyContinue
Copy-Item -Path (Join-Path $repoRoot "docs/product/project-charter.md") -Destination $govDir -ErrorAction SilentlyContinue

# agents/
$agentsDir = Join-Path $stagingDir "agents"
New-Item -ItemType Directory -Path $agentsDir -Force | Out-Null
if (Test-Path (Join-Path $repoRoot ".agents")) {
    Copy-Item -Path (Join-Path $repoRoot ".agents/*") -Destination $agentsDir -Recurse -Force
}

# relevant-docs/
$docsDir = Join-Path $stagingDir "relevant-docs"
New-Item -ItemType Directory -Path $docsDir -Force | Out-Null
Copy-Item -Path (Join-Path $repoRoot "README.md") -Destination $docsDir -ErrorAction SilentlyContinue
Copy-Item -Path (Join-Path $repoRoot ".gitignore") -Destination $docsDir -ErrorAction SilentlyContinue
if (Test-Path (Join-Path $repoRoot "docs/architecture")) {
    Copy-Item -Path (Join-Path $repoRoot "docs/architecture") -Destination $docsDir -Recurse -Force
}
if (Test-Path (Join-Path $repoRoot "docs/product")) {
    Copy-Item -Path (Join-Path $repoRoot "docs/product") -Destination $docsDir -Recurse -Force
}
if (Test-Path (Join-Path $repoRoot "docs/security")) {
    Copy-Item -Path (Join-Path $repoRoot "docs/security") -Destination $docsDir -Recurse -Force
}
if (Test-Path (Join-Path $repoRoot "docs/licensing")) {
    Copy-Item -Path (Join-Path $repoRoot "docs/licensing") -Destination $docsDir -Recurse -Force
}
if (Test-Path (Join-Path $repoRoot "docs/adrs")) {
    Copy-Item -Path (Join-Path $repoRoot "docs/adrs") -Destination $docsDir -Recurse -Force
}
if (Test-Path (Join-Path $repoRoot "docs/roadmap")) {
    Copy-Item -Path (Join-Path $repoRoot "docs/roadmap") -Destination $docsDir -Recurse -Force
}
if (Test-Path (Join-Path $repoRoot "docs/engineering")) {
    Copy-Item -Path (Join-Path $repoRoot "docs/engineering") -Destination $docsDir -Recurse -Force
}
if (Test-Path (Join-Path $repoRoot "docs/screenshots")) {
    Copy-Item -Path (Join-Path $repoRoot "docs/screenshots") -Destination $docsDir -Recurse -Force
}

# source/ (for Phase 0C+)
if ($PhaseSlug -match "00?c" -or (Test-Path (Join-Path $repoRoot "src")) -or (Test-Path (Join-Path $repoRoot "package.json"))) {
    $sourceDir = Join-Path $stagingDir "source"
    New-Item -ItemType Directory -Path $sourceDir -Force | Out-Null
    Copy-Item -Path (Join-Path $repoRoot "package.json") -Destination $sourceDir -ErrorAction SilentlyContinue
    Copy-Item -Path (Join-Path $repoRoot "pnpm-lock.yaml") -Destination $sourceDir -ErrorAction SilentlyContinue
    Copy-Item -Path (Join-Path $repoRoot "pnpm-workspace.yaml") -Destination $sourceDir -ErrorAction SilentlyContinue
    Copy-Item -Path (Join-Path $repoRoot "next.config.ts") -Destination $sourceDir -ErrorAction SilentlyContinue
    Copy-Item -Path (Join-Path $repoRoot "next-env.d.ts") -Destination $sourceDir -ErrorAction SilentlyContinue
    Copy-Item -Path (Join-Path $repoRoot "tsconfig.json") -Destination $sourceDir -ErrorAction SilentlyContinue
    Copy-Item -Path (Join-Path $repoRoot "postcss.config.mjs") -Destination $sourceDir -ErrorAction SilentlyContinue
    Copy-Item -Path (Join-Path $repoRoot "eslint.config.mjs") -Destination $sourceDir -ErrorAction SilentlyContinue
    Copy-Item -Path (Join-Path $repoRoot "components.json") -Destination $sourceDir -ErrorAction SilentlyContinue
    Copy-Item -Path (Join-Path $repoRoot "vitest.config.mts") -Destination $sourceDir -ErrorAction SilentlyContinue
    Copy-Item -Path (Join-Path $repoRoot "playwright.config.ts") -Destination $sourceDir -ErrorAction SilentlyContinue
    Copy-Item -Path (Join-Path $repoRoot ".prettierrc") -Destination $sourceDir -ErrorAction SilentlyContinue
    Copy-Item -Path (Join-Path $repoRoot ".prettierignore") -Destination $sourceDir -ErrorAction SilentlyContinue
    Copy-Item -Path (Join-Path $repoRoot ".env.example") -Destination $sourceDir -ErrorAction SilentlyContinue
    Copy-Item -Path (Join-Path $repoRoot "requirements-parser.txt") -Destination $sourceDir -ErrorAction SilentlyContinue
    if (Test-Path (Join-Path $repoRoot "src")) {
        Copy-Item -Path (Join-Path $repoRoot "src") -Destination $sourceDir -Recurse -Force
    }
    if (Test-Path (Join-Path $repoRoot "tests")) {
        Copy-Item -Path (Join-Path $repoRoot "tests") -Destination $sourceDir -Recurse -Force
    }
    if (Test-Path (Join-Path $repoRoot "supabase")) {
        Copy-Item -Path (Join-Path $repoRoot "supabase") -Destination $sourceDir -Recurse -Force
        if (Test-Path (Join-Path $sourceDir "supabase\.temp")) {
            Remove-Item -Recurse -Force -Path (Join-Path $sourceDir "supabase\.temp")
        }
        if (Test-Path (Join-Path $sourceDir "supabase\.branches")) {
            Remove-Item -Recurse -Force -Path (Join-Path $sourceDir "supabase\.branches")
        }
    }
    if (Test-Path (Join-Path $repoRoot "scripts")) {
        Copy-Item -Path (Join-Path $repoRoot "scripts") -Destination $sourceDir -Recurse -Force
    }

    # Clean Python caches, virtualenvs, local env files, and tools from staging
    Get-ChildItem -Path $stagingDir -Recurse -Directory -Filter "__pycache__" -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    Get-ChildItem -Path $stagingDir -Recurse -File -Include "*.pyc", "*.pyo" -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
    if (Test-Path (Join-Path $sourceDir ".venv")) {
        Remove-Item -Recurse -Force -Path (Join-Path $sourceDir ".venv") -ErrorAction SilentlyContinue
    }
    if (Test-Path (Join-Path $sourceDir "tools")) {
        Remove-Item -Recurse -Force -Path (Join-Path $sourceDir "tools") -ErrorAction SilentlyContinue
    }
    if (Test-Path (Join-Path $sourceDir ".env.local")) {
        Remove-Item -Force -Path (Join-Path $sourceDir ".env.local") -ErrorAction SilentlyContinue
    }
}

# 5. Security Audit of Staging Directory
Write-Host "Running automated security scan on staging files..." -ForegroundColor Yellow

$prohibitedPatterns = @(
    '\.git[\\/]',
    'node_modules[\\/]',
    '__pycache__',
    '\.pyc$',
    '\.venv',
    'tools[\\/]',
    '\.env(\..+)?$',
    '\.pem$',
    '\.key$',
    'id_rsa',
    'credentials',
    'secret'
)

$stagedFiles = Get-ChildItem -Path $stagingDir -Recurse -File
$violations = @()

foreach ($file in $stagedFiles) {
    $relPath = $file.FullName.Substring($stagingDir.Length + 1).Replace("\", "/")
    
    # Check filename patterns
    foreach ($pattern in $prohibitedPatterns) {
        if ($relPath -match $pattern -and $relPath -notmatch 'public-repository-safety\.md' -and $relPath -notmatch 'open-source-policy\.md' -and $relPath -notmatch 'security-review' -and $relPath -notmatch '\.env\.example$') {
            $violations += "Prohibited file pattern match: $relPath ($pattern)"
        }
    }
    
    # Check content for potential secrets / private keys
    try {
        $content = Get-Content -Path $file.FullName -Raw -ErrorAction SilentlyContinue
        if ($content) {
            if ($content -match '-----BEGIN (RSA|OPENSSH|EC|DSA|PRIVATE) KEY-----') {
                $violations += "Private key found in file: $relPath"
            }
            if ($content -match '(?i)(password|secret|api_key|apikey|token)\s*[:=]\s*[a-zA-Z0-9_\-]{16,}') {
                $violations += "Potential credential assignment found in file: $relPath"
            }
        }
    } catch {
        # Ignore binary or unreadable files
    }
}

if ($violations.Count -gt 0) {
    Write-Host "SECURITY AUDIT FAILED!" -ForegroundColor Red
    $violations | ForEach-Object { Write-Host " - $_" -ForegroundColor Red }
    Remove-Item -Recurse -Force -Path $stagingDir
    throw "Review package generation aborted due to security violations."
}

Write-Host "Security audit PASSED. No secrets or prohibited files detected." -ForegroundColor Green

# 6. Compress to ZIP
Write-Host "Creating review package ZIP: $zipPath..." -ForegroundColor Yellow
if (Test-Path $zipPath) {
    Remove-Item -Force -Path $zipPath
}

Compress-Archive -Path "$stagingDir\*" -DestinationPath $zipPath -CompressionLevel Optimal

# 7. Cleanup Staging
Remove-Item -Recurse -Force -Path $stagingDir

# 8. Report Result
$zipItem = Get-Item $zipPath
$zipSizeKB = [math]::Round($zipItem.Length / 1KB, 2)
Write-Host "==========================================" -ForegroundColor Green
Write-Host "Review Package Created Successfully!" -ForegroundColor Green
Write-Host "Path: $($zipItem.FullName)" -ForegroundColor Green
Write-Host "Size: $zipSizeKB KB ($($zipItem.Length) bytes)" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
