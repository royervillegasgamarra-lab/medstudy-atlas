import { supabaseAdmin } from "@/lib/supabase/admin";
import type { AICompletionTelemetry, AIRequestContext } from "./types";

/**
 * Records AI usage telemetry in PostgreSQL ai_usages table using privileged RPC.
 * Guarantees zero sensitive prompt text, evidence text, or credentials are saved.
 */
export async function recordAITelemetry(
  telemetry: AICompletionTelemetry,
  context?: AIRequestContext
): Promise<string | null> {
  if (!context?.userId || context.feature === "BENCHMARK") {
    return null;
  }

  try {
    const { data, error } = await supabaseAdmin.rpc(
      "record_ai_usage_privileged",
      {
        p_user_id: context.userId,
        p_document_id: (context.documentId ?? null) as unknown as string,
        p_study_pack_id: (context.studyPackId ?? null) as unknown as string,
        p_feature: context.feature,
        p_provider: telemetry.provider,
        p_model: telemetry.model,
        p_input_tokens: telemetry.inputTokens,
        p_output_tokens: telemetry.outputTokens,
        p_cached_tokens: telemetry.cachedTokens,
        p_estimated_cost_usd: telemetry.estimatedCostUsd,
        p_latency_ms: telemetry.latencyMs,
        p_status: telemetry.status,
      }
    );

    if (error) {
      console.warn("Failed to record AI telemetry:", error.message);
      return null;
    }

    return (data as string) || null;
  } catch (err) {
    console.warn("Exception recording AI telemetry:", err);
    return null;
  }
}
