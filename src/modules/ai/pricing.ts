import { MODEL_PRICING_SNAPSHOT } from "@/config/study-pack-limits";

/**
 * Calculates estimated cost in USD based on token counts and model pricing snapshot.
 * Formula: (inputTokens * inputPrice + outputTokens * outputPrice + cachedTokens * cachedPrice) / 1,000,000
 */
export function calculateEstimatedCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedTokens = 0
): number {
  const pricing =
    MODEL_PRICING_SNAPSHOT[model] || MODEL_PRICING_SNAPSHOT["default"];

  const uncachedInput = Math.max(0, inputTokens - cachedTokens);
  const cost =
    (uncachedInput * pricing.inputUsdPerMillion +
      outputTokens * pricing.outputUsdPerMillion +
      cachedTokens * pricing.cachedUsdPerMillion) /
    1_000_000;

  // Round to 6 decimal places
  return Math.round(cost * 1_000_000) / 1_000_000;
}
