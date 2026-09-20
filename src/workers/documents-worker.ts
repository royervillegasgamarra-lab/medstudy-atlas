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
 * Claims and processes a single document processing job.
 */
export async function processNextDocumentJob(
  workerId = `worker-${process.pid}`
): Promise<WorkerRunResult> {
  // 1. Claim next available processing run using PostgreSQL locking
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
      await supabaseAdmin.rpc("fail_processing_run_privileged", {
        p_run_id: job.run_id,
        p_error_code: "SOURCE_MISSING",
        p_retryable: true,
      });
      return {
        claimed: true,
        runId: job.run_id,
        documentId: job.document_id,
        status: "FAILED",
        errorCode: "SOURCE_MISSING",
      };
    }

    const buffer = Buffer.from(await blob.arrayBuffer());
    await fs.writeFile(sourcePdfPath, buffer);

    // Compute SHA-256 of downloaded PDF
    const sourceSha256 = crypto
      .createHash("sha256")
      .update(buffer)
      .digest("hex");

    // 4. Spawn secure parser child process
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

    // 5. Inspect parser output manifest
    const manifestPath = path.join(outputDir, "manifest.json");
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

    // 6. Validate each individual page result file
    const pagesList: PageProcessingResult[] = [];
    const pagesDir = path.join(outputDir, "pages");

    for (let p = 1; p <= manifestData.page_count; p++) {
      const pageFileName = `${String(p).padStart(4, "0")}.json`;
      const pageFilePath = path.join(pagesDir, pageFileName);

      try {
        const rawPage = await fs.readFile(pageFilePath, "utf-8");
        const pageObj = pageProcessingResultSchema.parse(JSON.parse(rawPage));

        if (pageObj.page_number !== p) {
          throw new Error(
            `Page number mismatch: expected ${p}, got ${pageObj.page_number}`
          );
        }

        pagesList.push(pageObj);
      } catch {
        await supabaseAdmin.rpc("fail_processing_run_privileged", {
          p_run_id: job.run_id,
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

    // 7. Atomically persist results and transition run to SUCCEEDED
    const { error: persistError } = await supabaseAdmin.rpc(
      "persist_processing_run_results_privileged",
      {
        p_run_id: job.run_id,
        p_manifest: manifestData,
        p_pages: pagesList,
      }
    );

    if (persistError) {
      await supabaseAdmin.rpc("fail_processing_run_privileged", {
        p_run_id: job.run_id,
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
    // Guaranteed cleanup of temporary working directory
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
