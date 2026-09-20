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
  PARSER_REPORTED_ERROR_CODES,
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
  transitionCommitted?: boolean;
  error?: string;
}

export interface FailProcessingRunResult {
  transitionCommitted: boolean;
  error?: string;
  fencedOrExpired?: boolean;
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

    // Invariant: bounded safe integers for character counts
    if (
      !Number.isSafeInteger(page.native_char_count) ||
      page.native_char_count < 0 ||
      page.native_char_count > PROCESSING_LIMITS.maxExtractedCharsPerPage ||
      !Number.isSafeInteger(page.ocr_char_count) ||
      page.ocr_char_count < 0 ||
      page.ocr_char_count > PROCESSING_LIMITS.maxExtractedCharsPerPage ||
      !Number.isSafeInteger(page.char_count) ||
      page.char_count < 0 ||
      page.char_count > PROCESSING_LIMITS.maxExtractedCharsPerPage
    ) {
      return {
        valid: false,
        error: `Character count out of bounds or not a safe integer on page ${page.page_number}`,
      };
    }

    const allowed = validCombos[page.classification];
    if (!allowed || !allowed.includes(page.extraction_method)) {
      return {
        valid: false,
        error: `Impossible classification/method combo on page ${page.page_number}: ${page.classification} with ${page.extraction_method}`,
      };
    }

    // Coherence checks per classification
    if (page.classification === "TEXT_BASED") {
      if (page.native_char_count === 0) {
        return {
          valid: false,
          error: `TEXT_BASED with zero native chars on page ${page.page_number}`,
        };
      }
      if (page.ocr_char_count !== 0) {
        return {
          valid: false,
          error: `TEXT_BASED with non-zero ocr chars on page ${page.page_number}`,
        };
      }
      if (page.char_count !== page.native_char_count) {
        return {
          valid: false,
          error: `TEXT_BASED char_count does not match native_char_count on page ${page.page_number}`,
        };
      }
    }

    if (page.classification === "SCANNED") {
      if (page.ocr_char_count === 0) {
        return {
          valid: false,
          error: `SCANNED with zero ocr chars on page ${page.page_number}`,
        };
      }
      if (page.native_char_count !== 0) {
        return {
          valid: false,
          error: `SCANNED with non-zero native chars on page ${page.page_number}`,
        };
      }
      if (page.char_count !== page.ocr_char_count) {
        return {
          valid: false,
          error: `SCANNED char_count does not match ocr_char_count on page ${page.page_number}`,
        };
      }
    }

    if (page.classification === "MIXED") {
      if (page.native_char_count === 0 || page.ocr_char_count === 0) {
        return {
          valid: false,
          error: `MIXED requires both native and ocr chars on page ${page.page_number}`,
        };
      }
      if (
        page.char_count !== page.native_char_count &&
        page.char_count !== page.ocr_char_count
      ) {
        return {
          valid: false,
          error: `MIXED char_count is not consistent with source counts on page ${page.page_number}`,
        };
      }
    }

    if (["NO_TEXT", "IMAGE_ONLY"].includes(page.classification)) {
      if (
        page.char_count !== 0 ||
        page.native_char_count !== 0 ||
        page.ocr_char_count !== 0 ||
        page.text_content !== ""
      ) {
        return {
          valid: false,
          error: `NO_TEXT with non-empty content or non-zero counts on page ${page.page_number}`,
        };
      }
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

export type ParserManifestCandidate =
  | ProcessingManifest
  | {
      status?: unknown;
      error_code?: unknown;
      page_count?: unknown;
      [key: string]: unknown;
    };

export interface ParserOutcomeInput {
  exitCode: number;
  spawnError?: Error | null;
  manifestExists: boolean;
  manifestSize?: number;
  manifestData?: ParserManifestCandidate | null;
}

export interface ClassifiedParserOutcome {
  status: "SUCCEEDED" | "FAILED";
  errorCode?: ProcessingErrorCode;
  isRetryable: boolean;
}

/**
 * Pure helper to classify the outcome of a parser subprocess execution.
 * Evaluates hard process timeouts first, followed by spawn errors, manifest validity,
 * parser-reported failure manifests, and exit code contradictions.
 */
export function classifyParserOutcome(
  input: ParserOutcomeInput
): ClassifiedParserOutcome {
  // 1. Hard parser process timeout: child killed with SIGKILL (-1)
  if (input.exitCode === -1) {
    return {
      status: "FAILED",
      errorCode: "PARSER_TIMEOUT",
      isRetryable: true,
    };
  }

  // 2. Child process spawn or execution error before exit
  if (input.spawnError) {
    return {
      status: "FAILED",
      errorCode: "WORKER_INTERNAL_ERROR",
      isRetryable: false,
    };
  }

  // 3. Manifest existence and size bounding (<= 64 KB)
  if (
    !input.manifestExists ||
    (input.manifestSize !== undefined && input.manifestSize > 64 * 1024)
  ) {
    return {
      status: "FAILED",
      errorCode: "PARSER_OUTPUT_INVALID",
      isRetryable: false,
    };
  }

  // 4. Manifest data parsing or validation failure
  if (!input.manifestData) {
    return {
      status: "FAILED",
      errorCode: "PARSER_OUTPUT_INVALID",
      isRetryable: false,
    };
  }

  // 5. Parser reported failure manifest
  if (input.manifestData.status === "FAILED") {
    const rawErrorCode =
      typeof input.manifestData.error_code === "string"
        ? input.manifestData.error_code
        : undefined;
    // Validate error_code is strictly one of PARSER_REPORTED_ERROR_CODES
    if (
      !rawErrorCode ||
      !(PARSER_REPORTED_ERROR_CODES as readonly string[]).includes(rawErrorCode)
    ) {
      return {
        status: "FAILED",
        errorCode: "PARSER_OUTPUT_INVALID",
        isRetryable: false,
      };
    }

    const isRetryable = (
      [
        "PREFLIGHT_TIMEOUT",
        "OCR_TIMEOUT",
        "PARSER_TIMEOUT",
      ] as readonly string[]
    ).includes(rawErrorCode);

    return {
      status: "FAILED",
      errorCode: rawErrorCode as ProcessingErrorCode,
      isRetryable,
    };
  }

  // 6. Contradiction: non-zero exit code but manifest claimed SUCCEEDED
  if (input.exitCode !== 0) {
    return {
      status: "FAILED",
      errorCode: "PARSER_OUTPUT_INVALID",
      isRetryable: false,
    };
  }

  // 7. Successful parser execution
  return {
    status: "SUCCEEDED",
    isRetryable: false,
  };
}

/**
 * Robust temporary directory cleanup with bounded retries and exponential backoff
 * to handle Windows file locking delays without failing the job or exposing sensitive paths.
 */
async function cleanupJobTempDir(
  dirPath: string,
  runId: string
): Promise<void> {
  const delays = [100, 200, 400];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      await fs.rm(dirPath, {
        recursive: true,
        force: true,
        maxRetries: 2,
        retryDelay: 50,
      });
      return;
    } catch {
      if (attempt < delays.length) {
        await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
      } else {
        console.warn(
          `[DocumentsWorker] Temporary directory cleanup incomplete for run ${runId}. Residual cleanup deferred to OS lifecycle.`
        );
      }
    }
  }
}

/**
 * Safely invokes fail_processing_run_privileged RPC and inspects error.
 * Ensures the worker never reports that a DB transition succeeded when it failed.
 * Detects claim fencing, expired/missing lease write revocation (error 55000), or archived documents.
 */
export async function failActiveProcessingRun(
  job: WorkerJobClaim,
  errorCode: ProcessingErrorCode,
  isRetryable: boolean
): Promise<FailProcessingRunResult> {
  try {
    const { error: failRpcError } = await supabaseAdmin.rpc(
      "fail_processing_run_privileged",
      {
        p_run_id: job.run_id,
        p_claim_token: job.claim_token,
        p_error_code: errorCode,
        p_retryable: isRetryable,
      }
    );

    if (failRpcError) {
      const isFencedOrExpired =
        failRpcError.code === "55000" ||
        failRpcError.message?.includes("claim token") ||
        failRpcError.message?.includes("lease");

      return {
        transitionCommitted: false,
        error: failRpcError.message,
        fencedOrExpired: isFencedOrExpired,
      };
    }

    return { transitionCommitted: true };
  } catch (err) {
    return {
      transitionCommitted: false,
      error: err instanceof Error ? err.message : String(err),
      fencedOrExpired: false,
    };
  }
}

function buildFailedRunResult(
  job: WorkerJobClaim,
  errorCode: ProcessingErrorCode,
  failRes: FailProcessingRunResult
): WorkerRunResult {
  return {
    claimed: true,
    runId: job.run_id,
    documentId: job.document_id,
    status: "FAILED",
    errorCode,
    transitionCommitted: failRes.transitionCommitted,
    ...(failRes.transitionCommitted
      ? {}
      : {
          error: failRes.fencedOrExpired
            ? "Fencing or lease expiration prevented mutating run state in database"
            : "Database transition to failed state could not be committed",
        }),
  };
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

  if (!claims || (claims as unknown as unknown[]).length === 0) {
    return { claimed: false };
  }

  const job = (claims as unknown as WorkerJobClaim[])[0];

  // Best-effort bounded cleanup on every exit path, with operational warning on residual failure
  const jobTempDir = path.join(os.tmpdir(), "medstudy-atlas-proc", job.run_id);
  const inputPdfPath = path.join(jobTempDir, "input.pdf");
  const outputDir = path.join(jobTempDir, "output");

  try {
    await fs.mkdir(jobTempDir, { recursive: true });
    await fs.mkdir(outputDir, { recursive: true });

    // 2. Download source PDF with authoritative error classification
    const { data: pdfBlob, error: downloadError } = await supabaseAdmin.storage
      .from(job.storage_bucket)
      .download(job.storage_key);

    if (downloadError || !pdfBlob) {
      const isConfirmedMissing = isConfirmedObjectNotFoundError(downloadError);
      const errorCode: ProcessingErrorCode = isConfirmedMissing
        ? "SOURCE_MISSING"
        : "STORAGE_UNAVAILABLE";
      const isRetryable = !isConfirmedMissing;

      const failRes = await failActiveProcessingRun(
        job,
        errorCode,
        isRetryable
      );
      return buildFailedRunResult(job, errorCode, failRes);
    }

    const pdfBuffer = Buffer.from(await pdfBlob.arrayBuffer());
    await fs.writeFile(inputPdfPath, pdfBuffer);

    // 3. Compute trusted source SHA-256 in Node before handing to parser
    const sourceSha256 = crypto
      .createHash("sha256")
      .update(pdfBuffer)
      .digest("hex");

    // 4. Invoke Python parser subprocess with stripped environment
    const pythonExe = resolvePythonExecutable();
    const parserScript = process.env.MEDSTUDY_PARSER_SCRIPT
      ? path.resolve(process.cwd(), process.env.MEDSTUDY_PARSER_SCRIPT)
      : path.resolve(process.cwd(), "src/parsers/document_parser.py");
    const qpdfExe = resolveQpdfExecutable();
    const tesseractExe = resolveTesseractExecutable();

    const args = [
      parserScript,
      "--input",
      inputPdfPath,
      "--output",
      outputDir,
      "--temp",
      path.join(jobTempDir, "ocr_temp"),
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

    const { exitCode: parserExitCode, error: parserSpawnError } =
      await new Promise<{ exitCode: number; error: Error | null }>(
        (resolve) => {
          const child = spawn(pythonExe, args, {
            env: safeEnv,
            shell: false,
            stdio: ["ignore", "ignore", "ignore"],
          });

          const timeout = setTimeout(() => {
            child.kill("SIGKILL");
            resolve({ exitCode: -1, error: new Error("PARSER_TIMEOUT") });
          }, PROCESSING_LIMITS.parserProcessTimeoutSeconds * 1000);

          child.on("error", (err) => {
            clearTimeout(timeout);
            resolve({ exitCode: 1, error: err });
          });

          child.on("exit", (code) => {
            clearTimeout(timeout);
            resolve({ exitCode: code ?? 1, error: null });
          });
        }
      );

    // 5. Hard parser timeout check: immediately classify as PARSER_TIMEOUT with p_retryable: true
    // Do NOT inspect manifest.json on hard process timeout.
    if (parserExitCode === -1) {
      const failRes = await failActiveProcessingRun(
        job,
        "PARSER_TIMEOUT",
        true
      );
      return buildFailedRunResult(job, "PARSER_TIMEOUT", failRes);
    }

    // 6. Inspect and bound parser output manifest
    const manifestPath = path.join(outputDir, "manifest.json");
    const manifestStat = await fs.stat(manifestPath).catch(() => null);

    let manifestData: ProcessingManifest | null = null;
    if (manifestStat && manifestStat.size <= 64 * 1024) {
      try {
        const rawManifest = await fs.readFile(manifestPath, "utf-8");
        manifestData = processingManifestSchema.parse(JSON.parse(rawManifest));
      } catch {
        manifestData = null;
      }
    }

    const outcome = classifyParserOutcome({
      exitCode: parserExitCode,
      spawnError: parserSpawnError,
      manifestExists: !!manifestStat,
      manifestSize: manifestStat?.size,
      manifestData,
    });

    if (outcome.status === "FAILED") {
      const errorCode = outcome.errorCode || "PARSER_OUTPUT_INVALID";
      const failRes = await failActiveProcessingRun(
        job,
        errorCode,
        outcome.isRetryable
      );
      return buildFailedRunResult(job, errorCode, failRes);
    }

    // Narrow manifestData to ProcessingSuccessManifest
    if (!manifestData || manifestData.status !== "SUCCEEDED") {
      const failRes = await failActiveProcessingRun(
        job,
        "PARSER_OUTPUT_INVALID",
        false
      );
      return buildFailedRunResult(job, "PARSER_OUTPUT_INVALID", failRes);
    }

    const successManifest = manifestData;

    // Bound page count: must not exceed maxPagesPerDocument or be <= 0
    if (
      successManifest.page_count <= 0 ||
      successManifest.page_count > PROCESSING_LIMITS.maxPagesPerDocument
    ) {
      const failRes = await failActiveProcessingRun(
        job,
        "PARSER_OUTPUT_INVALID",
        false
      );
      return buildFailedRunResult(job, "PARSER_OUTPUT_INVALID", failRes);
    }

    // Check pages directory contents: exactly page_count files, no unexpected files
    const pagesDir = path.join(outputDir, "pages");
    let pageFiles: string[];
    try {
      pageFiles = await fs.readdir(pagesDir);
    } catch {
      pageFiles = [];
    }

    if (pageFiles.length !== successManifest.page_count) {
      const failRes = await failActiveProcessingRun(
        job,
        "PARSER_OUTPUT_INVALID",
        false
      );
      return buildFailedRunResult(job, "PARSER_OUTPUT_INVALID", failRes);
    }

    // 6. Trusted Provenance Verification: Read and validate each page result file
    const pagesList: PageProcessingResult[] = [];

    for (let p = 1; p <= successManifest.page_count; p++) {
      const pageFileName = `${String(p).padStart(4, "0")}.json`;
      const pageFilePath = path.join(pagesDir, pageFileName);

      // Bound page JSON size: maximum 1.5 MB per page
      const pageStat = await fs.stat(pageFilePath).catch(() => null);
      if (!pageStat || pageStat.size > 1.5 * 1024 * 1024) {
        const failRes = await failActiveProcessingRun(
          job,
          "PARSER_OUTPUT_INVALID",
          false
        );
        return buildFailedRunResult(job, "PARSER_OUTPUT_INVALID", failRes);
      }

      try {
        const rawPage = await fs.readFile(pageFilePath, "utf-8");
        const pageObj = pageProcessingResultSchema.parse(JSON.parse(rawPage));
        pagesList.push(pageObj);
      } catch {
        const failRes = await failActiveProcessingRun(
          job,
          "PARSER_OUTPUT_INVALID",
          false
        );
        return buildFailedRunResult(job, "PARSER_OUTPUT_INVALID", failRes);
      }
    }

    // 7. Verify Semantic Provenance Invariants
    const provenance = verifyParserProvenance({
      job,
      sourceSha256,
      manifest: successManifest,
      pages: pagesList,
    });

    if (!provenance.valid) {
      const failRes = await failActiveProcessingRun(
        job,
        "PARSER_OUTPUT_INVALID",
        false
      );
      return buildFailedRunResult(job, "PARSER_OUTPUT_INVALID", failRes);
    }

    // 8. Atomically persist results with active claim token and transition run to SUCCEEDED
    const { error: persistError } = await supabaseAdmin.rpc(
      "persist_processing_run_results_privileged",
      {
        p_run_id: job.run_id,
        p_claim_token: job.claim_token,
        p_manifest: successManifest,
        p_pages: pagesList,
      }
    );

    if (persistError) {
      const failRes = await failActiveProcessingRun(
        job,
        "WORKER_INTERNAL_ERROR",
        true
      );
      return buildFailedRunResult(job, "WORKER_INTERNAL_ERROR", failRes);
    }

    return {
      claimed: true,
      runId: job.run_id,
      documentId: job.document_id,
      status: "SUCCEEDED",
      pageCount: successManifest.page_count,
    };
  } finally {
    // Best-effort bounded cleanup on every exit path, with operational warning on residual failure
    await cleanupJobTempDir(jobTempDir, job.run_id);
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
