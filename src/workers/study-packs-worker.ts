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

import * as crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { STUDY_PACK_WORKER_LIMITS } from "@/config/study-pack-limits";
import {
  createOrGetDocumentChunks,
  generateStudyPackContent,
  StudyPackServiceError,
} from "@/modules/study-packs/service";
import {
  isStudyPackErrorRetryable,
  type StudyPackErrorCode,
} from "@/modules/study-packs/types";
import { getAIProvider } from "@/modules/ai/provider-factory";
import { AIProviderError, type AIProvider } from "@/modules/ai/types";

export interface StudyPackJobClaim {
  study_pack_id: string;
  document_id: string;
  user_id: string;
  processing_run_id: string;
  chunking_version: string;
  generation_version: string;
  prompt_version: string;
  attempt_count: number;
  claim_token: string;
  original_filename: string;
}

export interface StudyPackWorkerRunResult {
  claimed: boolean;
  studyPackId?: string;
  documentId?: string;
  status?: "READY" | "FAILED";
  errorCode?: StudyPackErrorCode;
  transitionCommitted?: boolean;
  error?: string;
}

export interface ProcessStudyPackJobOptions {
  workerId?: string;
  leaseSeconds?: number;
  aiProvider?: AIProvider;
}

/**
 * Claims the next pending or crashed Study Pack job using FOR UPDATE SKIP LOCKED.
 */
export async function claimNextStudyPackJob(
  workerId: string,
  leaseSeconds = STUDY_PACK_WORKER_LIMITS.defaultLeaseSeconds
): Promise<StudyPackJobClaim | null> {
  const { data, error } = await supabaseAdmin.rpc("claim_next_study_pack", {
    p_worker_id: workerId,
    p_lease_seconds: leaseSeconds,
  });

  if (error) {
    console.error("[StudyPacksWorker] Claim RPC error:", error.message);
    return null;
  }

  if (!data || data.length === 0) {
    return null;
  }

  return data[0] as StudyPackJobClaim;
}

/**
 * Fails a study pack job safely via privileged RPC.
 */
export async function failStudyPackJob(
  studyPackId: string,
  claimToken: string,
  errorCode: StudyPackErrorCode,
  retryable: boolean
): Promise<{ transitionCommitted: boolean; fencedOrExpired?: boolean }> {
  try {
    const { error } = await supabaseAdmin.rpc("fail_study_pack_privileged", {
      p_study_pack_id: studyPackId,
      p_claim_token: claimToken,
      p_error_code: errorCode,
      p_retryable: retryable,
    });

    if (error) {
      if (error.code === "55000") {
        console.warn(
          "[StudyPacksWorker] Write authority revoked on fail (lease expired or token mismatch)."
        );
        return { transitionCommitted: false, fencedOrExpired: true };
      }
      console.error(
        "[StudyPacksWorker] Fail RPC returned error:",
        error.message
      );
      return { transitionCommitted: false };
    }

    return { transitionCommitted: true };
  } catch (err) {
    console.error("[StudyPacksWorker] Exception in failStudyPackJob:", err);
    return { transitionCommitted: false };
  }
}

/**
 * Processes a single claimed Study Pack generation job to completion.
 */
export async function processNextStudyPackJob(
  options: ProcessStudyPackJobOptions = {}
): Promise<StudyPackWorkerRunResult> {
  const workerId =
    options.workerId ??
    `study-worker-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  const leaseSeconds =
    options.leaseSeconds ?? STUDY_PACK_WORKER_LIMITS.defaultLeaseSeconds;

  const job = await claimNextStudyPackJob(workerId, leaseSeconds);
  if (!job) {
    return { claimed: false };
  }

  console.log(
    `[StudyPacksWorker] Claimed job ${job.study_pack_id} for document ${job.document_id} (Attempt ${job.attempt_count})`
  );

  const provider = options.aiProvider ?? getAIProvider();

  try {
    // 1. Ensure canonical chunks exist for the document
    const chunks = await createOrGetDocumentChunks(job.processing_run_id);
    if (!chunks || chunks.length === 0) {
      throw new StudyPackServiceError(
        "CHUNKS_NOT_READY",
        "Zero chunks created for document."
      );
    }

    // 2. Generate and verify Study Pack content
    const genResult = await generateStudyPackContent({
      documentId: job.document_id,
      userId: job.user_id,
      processingRunId: job.processing_run_id,
      studyPackId: job.study_pack_id,
      chunks,
      aiProvider: provider,
    });

    // 3. Persist results atomically via privileged RPC
    const { error: persistErr } = await supabaseAdmin.rpc(
      "persist_study_pack_results_privileged",
      {
        p_study_pack_id: job.study_pack_id,
        p_claim_token: job.claim_token,
        p_provider: provider.name,
        p_model: provider.model,
        p_input_tokens: genResult.inputTokens,
        p_output_tokens: genResult.outputTokens,
        p_cached_tokens: genResult.cachedTokens,
        p_estimated_cost_usd: genResult.estimatedCostUsd,
        p_source_page_count: genResult.sourcePageCount,
        p_source_chunk_count: genResult.sourceChunkCount,
        p_evidence_chunk_count: genResult.evidenceChunkCount,
        p_evidence_char_count: genResult.evidenceCharCount,
        p_items: genResult.items.map((i) => ({
          temp_key: i.tempKey,
          item_type: i.itemType,
          ordinal: i.ordinal,
          payload: i.payload,
        })) as unknown as import("@/types/database").Json,
        p_citations: genResult.citations.map((c) => ({
          item_temp_key: c.itemTempKey,
          document_chunk_id: c.documentChunkId,
          ordinal: c.ordinal,
        })) as unknown as import("@/types/database").Json,
      }
    );

    if (persistErr) {
      if (persistErr.code === "55000") {
        console.warn(
          "[StudyPacksWorker] Persist revoked: lease expired, claim token invalidated, or document archived."
        );
        return {
          claimed: true,
          studyPackId: job.study_pack_id,
          documentId: job.document_id,
          status: "FAILED",
          errorCode: "STUDY_PACK_LEASE_EXPIRED",
          transitionCommitted: false,
          error: persistErr.message,
        };
      }
      throw new StudyPackServiceError(
        "WORKER_INTERNAL_ERROR",
        `Persist failed: ${persistErr.message}`
      );
    }

    return {
      claimed: true,
      studyPackId: job.study_pack_id,
      documentId: job.document_id,
      status: "READY",
      transitionCommitted: true,
    };
  } catch (err: unknown) {
    let errorCode: StudyPackErrorCode = "WORKER_INTERNAL_ERROR";
    let retryable = false;

    if (err instanceof StudyPackServiceError) {
      errorCode = err.code;
      retryable = err.retryable || isStudyPackErrorRetryable(err.code);
    } else if (err instanceof AIProviderError) {
      if (err.code === "AI_RATE_LIMITED") errorCode = "AI_RATE_LIMITED";
      else if (err.code === "AI_TIMEOUT") errorCode = "AI_TIMEOUT";
      else if (err.code === "AI_PROVIDER_UNAVAILABLE")
        errorCode = "AI_PROVIDER_UNAVAILABLE";
      else if (err.code === "AI_PROVIDER_AUTH_ERROR")
        errorCode = "AI_PROVIDER_AUTH_ERROR";
      else if (err.code === "AI_DISABLED") errorCode = "AI_DISABLED";
      else if (err.code === "AI_NOT_CONFIGURED")
        errorCode = "AI_NOT_CONFIGURED";
      else errorCode = "WORKER_INTERNAL_ERROR";
      retryable = err.retryable;
    }

    console.error(`[StudyPacksWorker] Job failed with ${errorCode}:`, err);

    const failOutcome = await failStudyPackJob(
      job.study_pack_id,
      job.claim_token,
      errorCode,
      retryable
    );

    return {
      claimed: true,
      studyPackId: job.study_pack_id,
      documentId: job.document_id,
      status: "FAILED",
      errorCode,
      transitionCommitted: failOutcome.transitionCommitted,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Starts the Study Pack worker polling loop.
 */
export async function startStudyPacksWorker(
  options: {
    pollIntervalMs?: number;
    idlePollIntervalMs?: number;
    stopSignal?: AbortSignal;
    aiProvider?: AIProvider;
  } = {}
): Promise<void> {
  const pollInterval = options.pollIntervalMs ?? 1000;
  const idleInterval = options.idlePollIntervalMs ?? 5000;

  console.log(
    "[StudyPacksWorker] Worker started. Polling for study pack generation requests..."
  );

  while (!options.stopSignal?.aborted) {
    try {
      const result = await processNextStudyPackJob({
        aiProvider: options.aiProvider,
      });

      if (result.claimed) {
        console.log(
          `[StudyPacksWorker] Job ${result.studyPackId} finished with status ${result.status} (Error: ${result.errorCode ?? "none"})`
        );
        await new Promise((r) => setTimeout(r, pollInterval));
      } else {
        await new Promise((r) => setTimeout(r, idleInterval));
      }
    } catch (err) {
      console.error("[StudyPacksWorker] Unexpected error in worker loop:", err);
      await new Promise((r) => setTimeout(r, idleInterval));
    }
  }

  console.log("[StudyPacksWorker] Worker stopped.");
}

// Standalone CLI execution
if (require.main === module) {
  const isOnce = process.argv.includes("--once");

  if (isOnce) {
    processNextStudyPackJob()
      .then((res) => {
        console.log(JSON.stringify(res, null, 2));
        process.exit(res.status === "FAILED" ? 1 : 0);
      })
      .catch((err) => {
        console.error(err);
        process.exit(1);
      });
  } else {
    startStudyPacksWorker().catch((err) => {
      console.error(err);
      process.exit(1);
    });
  }
}
