import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateObject } from "ai";
import type {
  AIProvider,
  AIStructuredRequest,
  AIStructuredResult,
  AICompletionTelemetry,
  AIRequestContext,
} from "./types";
import { AIProviderError } from "./types";
import { calculateEstimatedCostUsd } from "./pricing";
import { recordAITelemetry } from "./telemetry";

import { validateAIProviderEndpoint } from "./provider-factory";
import { classifyAIError } from "./error-classifier";

export interface OpenAICompatibleConfig {
  providerName?: string;
  model: string;
  apiKey: string;
  baseURL?: string;
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

export class OpenAICompatibleProvider implements AIProvider {
  public readonly name: string;
  public readonly model: string;
  private readonly client: ReturnType<typeof createOpenAICompatible>;

  constructor(config: OpenAICompatibleConfig) {
    const { resolvedBaseURL } = validateAIProviderEndpoint({
      provider: config.providerName || "openai-compatible",
      model: config.model,
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      nodeEnv: process.env.NODE_ENV,
    });

    this.name = config.providerName || "openai-compatible";
    this.model = config.model;
    this.client = createOpenAICompatible({
      name: this.name,
      apiKey: config.apiKey,
      baseURL: resolvedBaseURL,
      fetch: config.fetch as Parameters<
        typeof createOpenAICompatible
      >[0]["fetch"],
    });
  }

  public async generateStructured<T>(
    request: AIStructuredRequest<T>,
    context?: AIRequestContext
  ): Promise<AIStructuredResult<T>> {
    const startTime = Date.now();

    try {
      const modelInstance = this.client(this.model);

      const result = await generateObject({
        model: modelInstance,
        schema: request.schema,
        schemaName: request.schemaName,
        system: request.systemPrompt,
        prompt: request.userPrompt,
        temperature: request.temperature ?? 0.1,
        maxTokens: request.maxTokens,
        abortSignal: request.abortSignal,
        maxRetries: request.maxRetries,
      });

      const latencyMs = Date.now() - startTime;
      const usage = result.usage as
        | {
            inputTokens?: number;
            outputTokens?: number;
            cachedTokens?: number;
            promptTokens?: number;
            completionTokens?: number;
          }
        | undefined;
      const inputTokens = usage?.inputTokens ?? usage?.promptTokens ?? 0;
      const outputTokens = usage?.outputTokens ?? usage?.completionTokens ?? 0;
      const cachedTokens = usage?.cachedTokens ?? 0;
      const estimatedCostUsd = calculateEstimatedCostUsd(
        this.model,
        inputTokens,
        outputTokens,
        cachedTokens
      );

      const telemetry: AICompletionTelemetry = {
        provider: this.name,
        model: this.model,
        inputTokens,
        outputTokens,
        cachedTokens,
        estimatedCostUsd,
        latencyMs,
        status: "SUCCESS",
      };

      if (context) {
        await recordAITelemetry(telemetry, context);
      }

      return {
        data: result.object,
        telemetry,
        rawText: JSON.stringify(result.object),
      };
    } catch (err: unknown) {
      const latencyMs = Date.now() - startTime;
      const { code, retryable, message } = classifyAIError(err, {
        abortSignal: request.abortSignal,
      });

      const telemetry: AICompletionTelemetry = {
        provider: this.name,
        model: this.model,
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        estimatedCostUsd: 0,
        latencyMs,
        status: code === "AI_RATE_LIMITED" ? "RATE_LIMITED" : "FAILED",
      };

      if (context) {
        await recordAITelemetry(telemetry, context);
      }

      throw new AIProviderError(code, message, retryable, telemetry);
    }
  }
}
