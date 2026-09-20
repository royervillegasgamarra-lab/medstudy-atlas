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
$allRepoFiles = Get-ChildItem -Path $repoRoot -Recurse -File | Where-Object {
    $_.FullName -notmatch '[\\/](\.git|node_modules|review-output|\.temp|\.branches)[\\/]'
} | ForEach-Object {
    $_.FullName.Substring($repoRoot.Length + 1).Replace("\", "/")
}
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
    "- `execution-report.md` -- The standardized $phaseTitle Execution Report.",
    '- `status.md` -- Current project status and subsystem states.',
    '- `test-results.md` -- Verification and test suite execution status.',
    "- `changed-files.txt` -- List of all files changed relative to $BaseBranch.",
    '- `git-status.txt` -- Exact git status snapshot at package generation.',
    "- `git-log.txt` -- Commit history of the phase branch against $BaseBranch.",
    "- `git-diff.patch` -- Unified diff patch showing all code/doc modifications.",
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
$matchedReports = Get-ChildItem -Path (Join-Path $repoRoot "docs/reports") -Filter "$PhaseSlug-*.md" -ErrorAction SilentlyContinue
if ($matchedReports -and $matchedReports.Count -gt 0) {
    Copy-Item -Path $matchedReports[0].FullName -Destination (Join-Path $stagingDir "execution-report.md")
} else {
    Write-Host "ERROR: Review package generation ABORTED!" -ForegroundColor Red
    Write-Host "Expected execution report not found for phase: $PhaseSlug in docs/reports/" -ForegroundColor Red
    throw "Review package generation aborted: Expected phase execution report (docs/reports/$PhaseSlug-*.md) missing. Falling back to an older phase report is strictly prohibited."
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
            "$env:ProgramFiles\Docker\Docker\resources\bin"
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

        # If test:e2e re-generated existing committed screenshots in docs/screenshots, restore them to clean commit state
        $screenshotStatus = git -C $repoRoot status --porcelain docs/screenshots 2>$null
        if ($screenshotStatus) {
            git -C $repoRoot checkout -- docs/screenshots 2>$null
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
}

# 5. Security Audit of Staging Directory
Write-Host "Running automated security scan on staging files..." -ForegroundColor Yellow

$prohibitedPatterns = @(
    '\.git[\\/]',
    'node_modules[\\/]',
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
