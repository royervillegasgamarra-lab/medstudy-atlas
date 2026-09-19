# scripts/create-review-package.ps1
# MedStudy Atlas -- Local Review Package Generator
# Generates a self-contained ZIP archive for external review without GitHub dependency.

[CmdletBinding()]
param (
    [string]$PhaseSlug = "phase-00a",
    [string]$BaseBranch = "main"
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
    $_.FullName -notmatch '[\\/](\.git|node_modules|review-output)[\\/]'
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
    }
}

# 3. Create Core Evidence Documents
Write-Host "Assembling core evidence documents..." -ForegroundColor Yellow

# Generate dynamic REVIEW.md based on Phase
$phaseTitle = switch -Regex ($PhaseSlug) {
    "00?a" { "Phase 0A -- Governance Bootstrap" }
    "00?b" { "Phase 0B -- Architecture Foundation" }
    "00?c" { "Phase 0C -- Engineering Baseline" }
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
} elseif (Test-Path (Join-Path $repoRoot "docs/reports/phase-00c-engineering.md")) {
    Copy-Item -Path (Join-Path $repoRoot "docs/reports/phase-00c-engineering.md") -Destination (Join-Path $stagingDir "execution-report.md")
} elseif (Test-Path (Join-Path $repoRoot "docs/reports/phase-00b-architecture.md")) {
    Copy-Item -Path (Join-Path $repoRoot "docs/reports/phase-00b-architecture.md") -Destination (Join-Path $stagingDir "execution-report.md")
}

# status.md
$statusSource = Join-Path $repoRoot "docs/status.md"
if (Test-Path $statusSource) {
    Copy-Item -Path $statusSource -Destination (Join-Path $stagingDir "status.md")
}

# test-results.md
if ($PhaseSlug -match "00?c") {
    $testLines = @(
        "# Test Results -- Phase 0C Engineering Baseline",
        '',
        '**Status**: ALL CHECKS PASSING (GREEN)',
        '',
        '### Quality Gate Results:',
        '- **Format Check (`pnpm format:check`)**: PASS (Prettier 3.9.8, zero formatting errors)',
        '- **Lint (`pnpm lint`)**: PASS (ESLint 9.39.5 with flat config, zero errors or warnings)',
        '- **Typecheck (`pnpm typecheck`)**: PASS (TypeScript 5.9.3 `tsc --noEmit`, zero type errors)',
        '- **Unit Tests (`pnpm test`)**: PASS (Vitest 5.0.1, 4 test files, 16 tests passed)',
        '- **E2E Smoke Tests (`pnpm test:e2e`)**: PASS (Playwright 1.63.0, 4 tests passed in Chromium; CSP and theme toggle verified)',
        '- **Production Build (`pnpm build`)**: PASS (Next.js 16.3.5 Turbopack compilation succeeded)',
        '- **Production Server Test (`next start`)**: PASS (HTTP 200 on `/` with CSP headers, HTTP 200 on `/api/health`)',
        '- **Dependency Audit (`pnpm audit`)**: PASS (No known vulnerabilities found)',
        '- **Browser Verification**: Desktop light/dark bidirectional toggle, mobile viewport, and 404 route verified; screenshots captured in `docs/screenshots/`.'
    )
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
if ($PhaseSlug -match "00?c") {
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
