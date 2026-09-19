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

# 3. Create Core Evidence Documents
Write-Host "Assembling core evidence documents..." -ForegroundColor Yellow

# REVIEW.md
$reviewLines = @(
    '# MedStudy Atlas -- External Review Package',
    '**Phase**: Phase 0A -- Governance Bootstrap',
    '**Development Mode**: LOCAL-FIRST',
    "**Target Branch**: $currentBranch",
    "**Baseline Branch**: $BaseBranch",
    "**Commit SHA**: $headSha",
    "**Generated**: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')",
    '',
    '---',
    '',
    '## 1. Purpose of this Package',
    'This self-contained review package provides complete review evidence for **Phase 0A -- Governance Bootstrap** under MedStudy Atlas''s **LOCAL-FIRST** development model. No GitHub access, remote pushes, or cloud services are required to conduct this review.',
    '',
    '## 2. Package Contents',
    '- `REVIEW.md` -- This review guide and summary.',
    '- `execution-report.md` -- The standardized Phase 0A Execution Report.',
    '- `status.md` -- Current project status and subsystem states.',
    '- `test-results.md` -- Verification and test suite execution status.',
    "- `changed-files.txt` -- List of all files changed relative to $BaseBranch.",
    '- `git-status.txt` -- Exact git status snapshot at package generation.',
    "- `git-log.txt` -- Commit history of the phase branch against $BaseBranch.",
    "- `git-diff.patch` -- Unified diff patch showing all code/doc modifications.",
    '- `repository-tree.txt` -- Full file tree of the repository.',
    '- `governance/` -- Core governance policies, CI policy, and project charter.',
    '- `agents/` -- Workspace invariant rules and agent skills (`.agents/`).',
    '- `relevant-docs/` -- Additional relevant documentation (licensing, security, ADRs, roadmaps).',
    '',
    '## 3. Review Objectives & Checklist',
    'Please verify the following Phase 0A criteria:',
    '1. [ ] **Local-First Governance**: Git local is the source of truth; no dependencies on GitHub pushes/PRs.',
    '2. [ ] **Revenue-First & Time-to-Market**: Principles prioritizing rapid student value and low operating costs (~S/10/mo) are recorded.',
    '3. [ ] **OSS-First & GitHub Scout**: Evaluation hierarchy (1-5) and candidate classification (`ADOPT`, `ADAPT`, `WATCH`, `AVOID`) are documented.',
    '4. [ ] **Proprietary Software Integrity**: Strictly proprietary notice declared; zero open-source LICENSE files added for MedStudy.',
    '5. [ ] **Review Readiness Skill**: Skill operates locally without requiring remote push or PR.',
    '6. [ ] **Zero Product Code**: Zero application code, zero database instances, zero AI providers, zero paid services.',
    '7. [ ] **Zero Secrets**: No passwords, tokens, API keys, credentials, or PHI committed.',
    '',
    '## 4. Next Step Upon Approval',
    "Upon approval of this review package, merge $currentBranch into $BaseBranch locally via squash merge:",
    '```powershell',
    "git checkout $BaseBranch",
    "git merge --squash $currentBranch",
    'git commit -m "chore(phase-0a): complete governance bootstrap"',
    '```',
    'Then proceed to **Phase 0B -- Architecture Foundation**.'
)
$reviewLines | Out-File -FilePath (Join-Path $stagingDir "REVIEW.md") -Encoding utf8

# execution-report.md
$reportSource = Join-Path $repoRoot "docs/reports/phase-00a-governance.md"
if (Test-Path $reportSource) {
    Copy-Item -Path $reportSource -Destination (Join-Path $stagingDir "execution-report.md")
}

# status.md
$statusSource = Join-Path $repoRoot "docs/status.md"
if (Test-Path $statusSource) {
    Copy-Item -Path $statusSource -Destination (Join-Path $stagingDir "status.md")
}

# test-results.md
$testLines = @(
    '# Test Results -- Phase 0A',
    '',
    '**Status**: NOT APPLICABLE -- APPLICATION TOOLING NOT YET IMPLEMENTED',
    '',
    '### Detail:',
    '- Phase 0A establishes workspace governance, agent rules, and documentation architecture.',
    '- Zero application code, package managers (pnpm/npm), or test runners (Vitest/Jest/Playwright) are installed.',
    '- Automated tests and verification pipelines will be formally authored and activated in **Phase 0C (Engineering Baseline)**.'
)
$testLines | Out-File -FilePath (Join-Path $stagingDir "test-results.md") -Encoding utf8

# 4. Copy Subsystems: governance/, agents/, relevant-docs/
Write-Host "Copying governance, agent, and documentation files..." -ForegroundColor Yellow

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
        if ($relPath -match $pattern -and $relPath -notmatch 'public-repository-safety\.md' -and $relPath -notmatch 'open-source-policy\.md' -and $relPath -notmatch 'security-review') {
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
