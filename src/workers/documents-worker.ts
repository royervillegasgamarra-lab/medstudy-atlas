// Load local environment for worker process if available
const procWithEnv = process as unknown as {
  loadEnvFile?: (path?: string) => void;
};
if (typeof procWithEnv.loadEnvFile === "function") {
  try {
    procWithEnv.loadEnvFile(".env.local");
  } catch {
    // ignore if not present
  }
}

import { spawn } from "child_process";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { PROCESSING_LIMITS } from "@/config/processing-limits";
import { isConfirmedObjectNotFoundError } from "@/modules/documents/service";
import {
  processingManifestSchema,
  pageProcessingResultSchema,
  type ProcessingManifest,
  type PageProcessingResult,
  type ProcessingErrorCode,
} from "@/modules/documents/processing-types";

export interface WorkerJobClaim {
  run_id: string;
  document_id: string;
  user_id: string;
  pipeline_version: string;
  attempt_count: number;
  claim_token: string;
  storage_bucket: string;
  storage_key: string;
  size_bytes: number;
  original_filename: string;
}

export interface WorkerRunResult {
  claimed: boolean;
  runId?: string;
  documentId?: string;
  status?: "SUCCEEDED" | "FAILED";
  errorCode?: ProcessingErrorCode;
  pageCount?: number;
  error?: string;
}

export interface ProvenanceValidationInput {
  job: WorkerJobClaim;
  sourceSha256: string;
  manifest: ProcessingManifest;
  pages: PageProcessingResult[];
}

/**
 * Trusted Node Orchestrator Semantic Provenance Verification.
 * Validates cryptographic hashes, Unicode character counts, aggregate counters,
 * and classification invariants before allowing persistence.
 */
export function verifyParserProvenance(input: ProvenanceValidationInput): {
  valid: boolean;
  error?: string;
} {
  const { job, sourceSha256, manifest, pages } = input;

  if (manifest.pipeline_version !== job.pipeline_version) {
    return { valid: false, error: "Pipeline version mismatch" };
  }
  if (manifest.source_sha256 !== sourceSha256) {
    return { valid: false, error: "Source SHA-256 mismatch" };
  }
  if (manifest.page_count !== pages.length) {
    return { valid: false, error: "Page count mismatch" };
  }

  const validCombos: Record<string, string[]> = {
    TEXT_BASED: ["NATIVE"],
    SCANNED: ["OCR"],
    MIXED: ["HYBRID"],
    NO_TEXT: ["NONE"],
    IMAGE_ONLY: ["NONE"],
  };

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    if (page.page_number !== i + 1) {
      return {
        valid: false,
        error: `Page number mismatch: expected ${i + 1}, got ${page.page_number}`,
      };
    }

    // Invariant: exact text SHA-256
    const computedTextSha = crypto
      .createHash("sha256")
      .update(page.text_content, "utf8")
      .digest("hex");
    if (page.text_sha256 !== computedTextSha) {
      return {
        valid: false,
        error: `Text SHA-256 mismatch on page ${page.page_number}`,
      };
    }

    // Invariant: deterministic Unicode code point character count matching Python len()
    const computedCharCount = [...page.text_content].length;
    if (page.char_count !== computedCharCount) {
      return {
        valid: false,
        error: `Character count mismatch on page ${page.page_number}: expected ${computedCharCount}, got ${page.char_count}`,
      };
    }

    if (page.native_char_count < 0 || page.ocr_char_count < 0) {
      return {
        valid: false,
        error: `Negative character count on page ${page.page_number}`,
      };
    }

    const allowed = validCombos[page.classification];
    if (!allowed || !allowed.includes(page.extraction_method)) {
      return {
        valid: false,
        error: `Impossible classification/method combo on page ${page.page_number}: ${page.classification} with ${page.extraction_method}`,
      };
    }

    if (page.classification === "TEXT_BASED" && page.native_char_count === 0) {
      return {
        valid: false,
        error: `TEXT_BASED with zero native chars on page ${page.page_number}`,
      };
    }
    if (
      ["NO_TEXT", "IMAGE_ONLY"].includes(page.classification) &&
      (page.char_count > 0 || page.text_content !== "")
    ) {
      return {
        valid: false,
        error: `NO_TEXT with non-empty content on page ${page.page_number}`,
      };
    }
  }

  const expectedNative = pages.filter(
    (p) => p.classification === "TEXT_BASED"
  ).length;
  const expectedOcr = pages.filter((p) =>
    ["SCANNED", "MIXED"].includes(p.classification)
  ).length;
  const expectedNoText = pages.filter((p) =>
    ["NO_TEXT", "IMAGE_ONLY"].includes(p.classification)
  ).length;

  if (
    manifest.native_text_page_count !== expectedNative ||
    manifest.ocr_page_count !== expectedOcr ||
    manifest.no_text_page_count !== expectedNoText ||
    manifest.native_text_page_count +
      manifest.ocr_page_count +
      manifest.no_text_page_count !==
      manifest.page_count
  ) {
    return { valid: false, error: "Aggregate page counters mismatch" };
  }

  return { valid: true };
}

/**
 * Strips sensitive environment variables before spawning untrusted parser child process.
 * The parser subprocess MUST NOT receive:
 * - SUPABASE_SECRET_KEY
 * - SUPABASE_SERVICE_ROLE_KEY
 * - NEXT_PUBLIC_*
 * - DB credentials
 * - AI/API keys
 * - auth tokens
 */
export function createSafeParserEnvironment(): NodeJS.ProcessEnv {
  const allowedKeys = [
    "PATH",
    "SystemRoot",
    "SYSTEMROOT",
    "SystemDrive",
    "SYSTEMDRIVE",
    "TEMP",
    "TMP",
    "APPDATA",
    "LOCALAPPDATA",
    "USERPROFILE",
    "PATHEXT",
    "COMSPEC",
    "windir",
    "WINDIR",
    "LANG",
    "LC_ALL",
    "TESSDATA_PREFIX",
  ];

  const safeEnv: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV || "production",
  } as NodeJS.ProcessEnv;
  for (const key of allowedKeys) {
    if (process.env[key] !== undefined) {
      safeEnv[key] = process.env[key];
    }
  }

  // Explicitly ensure no application secrets exist
  delete safeEnv.SUPABASE_SECRET_KEY;
  delete safeEnv.SUPABASE_SERVICE_ROLE_KEY;
  delete safeEnv.DATABASE_URL;

  return safeEnv;
}

/**
 * Resolves the Python executable path, favoring project-local .venv if present.
 */
export function resolvePythonExecutable(): string {
  const venvPythonWin = path.resolve(process.cwd(), ".venv/Scripts/python.exe");
  const venvPythonPosix = path.resolve(process.cwd(), ".venv/bin/python");

  try {
    if (fsSync.existsSync(venvPythonWin)) return venvPythonWin;
    if (fsSync.existsSync(venvPythonPosix)) return venvPythonPosix;
  } catch {
    // fallback
  }

  return process.platform === "win32" ? "python.exe" : "python3";
}

/**
 * Resolves the qpdf executable path.
 */
export function resolveQpdfExecutable(): string | undefined {
  const localQpdfWin = path.resolve(
    process.cwd(),
    "tools/bin/qpdf/bin/qpdf.exe"
  );
  try {
    if (fsSync.existsSync(localQpdfWin)) return localQpdfWin;
  } catch {
    // fallback
  }
  return undefined;
}

/**
 * Resolves the tesseract executable path.
 */
export function resolveTesseractExecutable(): string | undefined {
  const standardWin = "C:\\Program Files\\Tesseract-OCR\\tesseract.exe";
  try {
    if (fsSync.existsSync(standardWin)) return standardWin;
  } catch {
    // fallback
  }
  return undefined;
}

/**
 * Claims and processes a single document processing job with claim token fencing and semantic provenance verification.
 */
export async function processNextDocumentJob(
  workerId = `worker-${process.pid}`
): Promise<WorkerRunResult> {
  // 1. Claim next available processing run using PostgreSQL locking and fencing
  const { data: claims, error: claimError } = await supabaseAdmin.rpc(
    "claim_next_processing_run",
    {
      p_worker_id: workerId,
      p_lease_seconds: PROCESSING_LIMITS.workerLeaseSeconds,
    }
  );

  if (claimError) {
    return {
      claimed: false,
      error: `Error al reclamar tarea de procesamiento: ${claimError.message}`,
    };
  }

  const claimList = (claims as unknown as WorkerJobClaim[]) || [];
  if (claimList.length === 0) {
    return { claimed: false };
  }

  const job = claimList[0];
  const randomJobId = crypto.randomBytes(8).toString("hex");
  const jobTempDir = path.join(
    os.tmpdir(),
    "medstudy-atlas-proc",
    `${job.run_id}-${randomJobId}`
  );
  const sourcePdfPath = path.join(jobTempDir, "source.pdf");
  const outputDir = path.join(jobTempDir, "output");
  const ocrTempDir = path.join(jobTempDir, "ocr-temp");

  try {
    // 2. Prepare temporary filesystem isolation
    await fs.mkdir(outputDir, { recursive: true });
    await fs.mkdir(ocrTempDir, { recursive: true });

    // 3. Download source PDF from private Supabase Storage
    const { data: blob, error: downloadError } = await supabaseAdmin.storage
      .from(job.storage_bucket)
      .download(job.storage_key);

    if (downloadError || !blob) {
      const isConfirmedMissing = isConfirmedObjectNotFoundError(downloadError);
      const errorCode: ProcessingErrorCode = isConfirmedMissing
        ? "SOURCE_MISSING"
        : "STORAGE_UNAVAILABLE";
      const isRetryable = !isConfirmedMissing;

      await supabaseAdmin.rpc("fail_processing_run_privileged", {
        p_run_id: job.run_id,
        p_claim_token: job.claim_token,
        p_error_code: errorCode,
        p_retryable: isRetryable,
      });

      return {
        claimed: true,
        runId: job.run_id,
        documentId: job.document_id,
        status: "FAILED",
        errorCode,
      };
    }

    const buffer = Buffer.from(await blob.arrayBuffer());
    await fs.writeFile(sourcePdfPath, buffer);

    // Compute SHA-256 of downloaded PDF in trusted orchestrator
    const sourceSha256 = crypto
      .createHash("sha256")
      .update(buffer)
      .digest("hex");

    // 4. Spawn secure parser child process with explicit centralized configuration
    const pythonExe = resolvePythonExecutable();
    const parserScript = path.resolve(
      process.cwd(),
      "src/parsers/document_parser.py"
    );
    const qpdfExe = resolveQpdfExecutable();
    const tesseractExe = resolveTesseractExecutable();

    const args = [
      parserScript,
      "--input",
      sourcePdfPath,
      "--output",
      outputDir,
      "--temp",
      ocrTempDir,
      "--source-sha256",
      sourceSha256,
      "--config",
      JSON.stringify(PROCESSING_LIMITS),
    ];

    if (qpdfExe) {
      args.push("--qpdf-path", qpdfExe);
    }
    if (tesseractExe) {
      args.push("--tesseract-path", tesseractExe);
    }

    const safeEnv = createSafeParserEnvironment();

    const parserExitCode = await new Promise<number>((resolve, reject) => {
      const child = spawn(pythonExe, args, {
        env: safeEnv,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("PARSER_TIMEOUT"));
      }, PROCESSING_LIMITS.totalJobTimeoutSeconds * 1000);

      child.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      child.on("exit", (code) => {
        clearTimeout(timeout);
        resolve(code ?? 1);
      });
    }).catch((err) => {
      if (err.message === "PARSER_TIMEOUT") return -1;
      return 1;
    });

    // 5. Bound parser output before readFile()
    const manifestPath = path.join(outputDir, "manifest.json");
    const manifestStat = await fs.stat(manifestPath).catch(() => null);

    // Manifest size bound: maximum 64 KB
    if (!manifestStat || manifestStat.size > 64 * 1024) {
      await supabaseAdmin.rpc("fail_processing_run_privileged", {
        p_run_id: job.run_id,
        p_claim_token: job.claim_token,
        p_error_code: "PARSER_OUTPUT_INVALID",
        p_retryable: false,
      });

      return {
        claimed: true,
        runId: job.run_id,
        documentId: job.document_id,
        status: "FAILED",
        errorCode: "PARSER_OUTPUT_INVALID",
      };
    }

    let manifestData: ProcessingManifest | null = null;
    try {
      const rawManifest = await fs.readFile(manifestPath, "utf-8");
      manifestData = processingManifestSchema.parse(JSON.parse(rawManifest));
    } catch {
      manifestData = null;
    }

    if (
      parserExitCode !== 0 ||
      !manifestData ||
      manifestData.status === "FAILED"
    ) {
      let errorCode: ProcessingErrorCode = "PARSER_CRASH";
      if (parserExitCode === -1) {
        errorCode = "PARSER_TIMEOUT";
      } else if (manifestData?.error_code) {
        errorCode = manifestData.error_code;
      }

      const isRetryable = [
        "PARSER_TIMEOUT",
        "PREFLIGHT_TIMEOUT",
        "OCR_TIMEOUT",
        "STORAGE_UNAVAILABLE",
      ].includes(errorCode);

      await supabaseAdmin.rpc("fail_processing_run_privileged", {
        p_run_id: job.run_id,
        p_claim_token: job.claim_token,
        p_error_code: errorCode,
        p_retryable: isRetryable,
      });

      return {
        claimed: true,
        runId: job.run_id,
        documentId: job.document_id,
        status: "FAILED",
        errorCode,
      };
    }

    // Bound page count: must not exceed maxPagesPerDocument or be <= 0
    if (
      manifestData.page_count <= 0 ||
      manifestData.page_count > PROCESSING_LIMITS.maxPagesPerDocument
    ) {
      await supabaseAdmin.rpc("fail_processing_run_privileged", {
        p_run_id: job.run_id,
        p_claim_token: job.claim_token,
        p_error_code: "PARSER_OUTPUT_INVALID",
        p_retryable: false,
      });

      return {
        claimed: true,
        runId: job.run_id,
        documentId: job.document_id,
        status: "FAILED",
        errorCode: "PARSER_OUTPUT_INVALID",
      };
    }

    // Check pages directory contents: exactly page_count files, no unexpected files
    const pagesDir = path.join(outputDir, "pages");
    let pageFiles: string[];
    try {
      pageFiles = await fs.readdir(pagesDir);
    } catch {
      pageFiles = [];
    }

    if (pageFiles.length !== manifestData.page_count) {
      await supabaseAdmin.rpc("fail_processing_run_privileged", {
        p_run_id: job.run_id,
        p_claim_token: job.claim_token,
        p_error_code: "PARSER_OUTPUT_INVALID",
        p_retryable: false,
      });

      return {
        claimed: true,
        runId: job.run_id,
        documentId: job.document_id,
        status: "FAILED",
        errorCode: "PARSER_OUTPUT_INVALID",
      };
    }

    // 6. Trusted Provenance Verification: Read and validate each page result file
    const pagesList: PageProcessingResult[] = [];

    for (let p = 1; p <= manifestData.page_count; p++) {
      const pageFileName = `${String(p).padStart(4, "0")}.json`;
      const pageFilePath = path.join(pagesDir, pageFileName);

      // Bound page JSON size: maximum 1.5 MB per page
      const pageStat = await fs.stat(pageFilePath).catch(() => null);
      if (!pageStat || pageStat.size > 1.5 * 1024 * 1024) {
        await supabaseAdmin.rpc("fail_processing_run_privileged", {
          p_run_id: job.run_id,
          p_claim_token: job.claim_token,
          p_error_code: "PARSER_OUTPUT_INVALID",
          p_retryable: false,
        });

        return {
          claimed: true,
          runId: job.run_id,
          documentId: job.document_id,
          status: "FAILED",
          errorCode: "PARSER_OUTPUT_INVALID",
        };
      }

      try {
        const rawPage = await fs.readFile(pageFilePath, "utf-8");
        const pageObj = pageProcessingResultSchema.parse(JSON.parse(rawPage));
        pagesList.push(pageObj);
      } catch {
        await supabaseAdmin.rpc("fail_processing_run_privileged", {
          p_run_id: job.run_id,
          p_claim_token: job.claim_token,
          p_error_code: "PARSER_OUTPUT_INVALID",
          p_retryable: false,
        });

        return {
          claimed: true,
          runId: job.run_id,
          documentId: job.document_id,
          status: "FAILED",
          errorCode: "PARSER_OUTPUT_INVALID",
        };
      }
    }

    // 7. Verify Semantic Provenance Invariants
    const provenance = verifyParserProvenance({
      job,
      sourceSha256,
      manifest: manifestData,
      pages: pagesList,
    });

    if (!provenance.valid) {
      await supabaseAdmin.rpc("fail_processing_run_privileged", {
        p_run_id: job.run_id,
        p_claim_token: job.claim_token,
        p_error_code: "PARSER_OUTPUT_INVALID",
        p_retryable: false,
      });

      return {
        claimed: true,
        runId: job.run_id,
        documentId: job.document_id,
        status: "FAILED",
        errorCode: "PARSER_OUTPUT_INVALID",
      };
    }

    // 8. Atomically persist results with active claim token and transition run to SUCCEEDED
    const { error: persistError } = await supabaseAdmin.rpc(
      "persist_processing_run_results_privileged",
      {
        p_run_id: job.run_id,
        p_claim_token: job.claim_token,
        p_manifest: manifestData,
        p_pages: pagesList,
      }
    );

    if (persistError) {
      await supabaseAdmin.rpc("fail_processing_run_privileged", {
        p_run_id: job.run_id,
        p_claim_token: job.claim_token,
        p_error_code: "WORKER_INTERNAL_ERROR",
        p_retryable: true,
      });

      return {
        claimed: true,
        runId: job.run_id,
        documentId: job.document_id,
        status: "FAILED",
        errorCode: "WORKER_INTERNAL_ERROR",
      };
    }

    return {
      claimed: true,
      runId: job.run_id,
      documentId: job.document_id,
      status: "SUCCEEDED",
      pageCount: manifestData.page_count,
    };
  } finally {
    // Guaranteed cleanup of temporary working directory on success and failure
    try {
      await fs.rm(jobTempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}

/**
 * Continuous worker loop with adaptive polling.
 */
export async function startDocumentsWorker(
  options: {
    pollIntervalMs?: number;
    idlePollIntervalMs?: number;
    stopSignal?: AbortSignal;
  } = {}
): Promise<void> {
  const pollInterval = options.pollIntervalMs ?? 1000;
  const idleInterval = options.idlePollIntervalMs ?? 5000;

  console.log(
    "[DocumentsWorker] Worker started. Waiting for processing jobs..."
  );

  while (!options.stopSignal?.aborted) {
    try {
      const result = await processNextDocumentJob();

      if (result.claimed) {
        console.log(
          `[DocumentsWorker] Job ${result.runId} (${result.documentId}) finished with status ${result.status} (Pages: ${result.pageCount ?? 0}, Error: ${result.errorCode ?? "none"})`
        );
        // Fast loop while jobs are actively being claimed
        await new Promise((r) => setTimeout(r, pollInterval));
      } else {
        // Adaptive idle backoff
        await new Promise((r) => setTimeout(r, idleInterval));
      }
    } catch (err) {
      console.error("[DocumentsWorker] Unexpected error in worker loop:", err);
      await new Promise((r) => setTimeout(r, idleInterval));
    }
  }

  console.log("[DocumentsWorker] Worker stopped.");
}

// Standalone CLI execution
if (require.main === module) {
  const isOnce = process.argv.includes("--once");

  if (isOnce) {
    processNextDocumentJob()
      .then((res) => {
        console.log(JSON.stringify(res, null, 2));
        process.exit(res.status === "FAILED" ? 1 : 0);
      })
      .catch((err) => {
        console.error(err);
        process.exit(1);
      });
  } else {
    startDocumentsWorker().catch((err) => {
      console.error(err);
      process.exit(1);
    });
  }
}
