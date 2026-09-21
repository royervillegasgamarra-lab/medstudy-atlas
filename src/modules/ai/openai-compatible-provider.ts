import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateObject } from "ai";
import type {
  AIProvider,
  AIStructuredRequest,
  AIStructuredResult,
  AICompletionTelemetry,
  AIRequestContext,
  AIErrorCode,
} from "./types";
import { AIProviderError } from "./types";
import { calculateEstimatedCostUsd } from "./pricing";
import { recordAITelemetry } from "./telemetry";

export interface OpenAICompatibleConfig {
  providerName?: string;
  model: string;
  apiKey: string;
  baseURL?: string;
}

export class OpenAICompatibleProvider implements AIProvider {
  public readonly name: string;
  public readonly model: string;
  private readonly client: ReturnType<typeof createOpenAICompatible>;

  constructor(config: OpenAICompatibleConfig) {
    this.name = config.providerName || "openai-compatible";
    this.model = config.model;
    this.client = createOpenAICompatible({
      name: this.name,
      apiKey: config.apiKey,
      baseURL: config.baseURL || "https://api.openai.com/v1",
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
      const errorObj = err as {
        name?: string;
        status?: number;
        statusCode?: number;
        message?: string;
      };
      const status = errorObj?.status || errorObj?.statusCode;
      const message = errorObj?.message || String(err);
      const isAborted =
        request.abortSignal?.aborted ||
        errorObj?.name === "AbortError" ||
        errorObj?.name === "TimeoutError" ||
        message.toLowerCase().includes("abort") ||
        message.toLowerCase().includes("timeout") ||
        message.includes("ETIMEDOUT") ||
        message.includes("ESOCKETTIMEDOUT");

      let code: AIErrorCode = "AI_UNKNOWN_ERROR";
      let retryable = false;

      if (isAborted) {
        code = "AI_TIMEOUT";
        retryable = true;
      } else if (status === 401 || status === 403) {
        code = "AI_PROVIDER_AUTH_ERROR";
        retryable = false;
      } else if (status === 429) {
        code = "AI_RATE_LIMITED";
        retryable = true;
      } else if (status && status >= 500) {
        code = "AI_PROVIDER_UNAVAILABLE";
        retryable = true;
      } else if (message.includes("schema") || message.includes("validation")) {
        code = "AI_SCHEMA_INVALID";
        retryable = true;
      }

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
