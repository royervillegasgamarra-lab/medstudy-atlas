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

export type MockAction =
  | {
      type: "data";
      payload: unknown;
      telemetry?: Partial<AICompletionTelemetry>;
    }
  | { type: "raw"; rawText: string; telemetry?: Partial<AICompletionTelemetry> }
  | {
      type: "error";
      code: AIErrorCode;
      message: string;
      retryable: boolean;
      telemetry?: Partial<AICompletionTelemetry>;
    };

export class MockAIProvider implements AIProvider {
  public readonly name = "mock-provider";
  public readonly model = "mock-model";

  private queue: MockAction[] = [];
  public callCount = 0;
  public lastRequest?: AIStructuredRequest<unknown>;

  public enqueueData<T>(
    data: T,
    telemetry?: Partial<AICompletionTelemetry>
  ): void {
    this.queue.push({ type: "data", payload: data, telemetry });
  }

  public enqueueRaw(
    rawText: string,
    telemetry?: Partial<AICompletionTelemetry>
  ): void {
    this.queue.push({ type: "raw", rawText, telemetry });
  }

  public enqueueError(
    code: AIErrorCode,
    message: string,
    retryable = false,
    telemetry?: Partial<AICompletionTelemetry>
  ): void {
    this.queue.push({ type: "error", code, message, retryable, telemetry });
  }

  public clearQueue(): void {
    this.queue = [];
    this.callCount = 0;
    this.lastRequest = undefined;
  }

  public async generateStructured<T>(
    request: AIStructuredRequest<T>,
    context?: AIRequestContext
  ): Promise<AIStructuredResult<T>> {
    this.callCount++;
    this.lastRequest = request as AIStructuredRequest<unknown>;

    if (request.abortSignal?.aborted) {
      throw new AIProviderError(
        "AI_TIMEOUT",
        "The operation was aborted or timed out.",
        true,
        {
          provider: this.name,
          model: this.model,
          inputTokens: 0,
          outputTokens: 0,
          cachedTokens: 0,
          estimatedCostUsd: 0,
          latencyMs: 0,
          status: "FAILED",
        }
      );
    }

    const startTime = Date.now();

    // Check if an action is queued
    if (this.queue.length > 0) {
      const action = this.queue.shift()!;
      const latencyMs = Date.now() - startTime;

      if (action.type === "error") {
        const telemetry: AICompletionTelemetry = {
          provider: this.name,
          model: this.model,
          inputTokens: action.telemetry?.inputTokens ?? 150,
          outputTokens: action.telemetry?.outputTokens ?? 0,
          cachedTokens: action.telemetry?.cachedTokens ?? 0,
          estimatedCostUsd: 0,
          latencyMs,
          status: action.code === "AI_RATE_LIMITED" ? "RATE_LIMITED" : "FAILED",
          ...action.telemetry,
        };

        if (context) {
          await recordAITelemetry(telemetry, context);
        }

        throw new AIProviderError(
          action.code,
          action.message,
          action.retryable,
          telemetry
        );
      }

      if (action.type === "raw") {
        let parsed: unknown;
        try {
          parsed = JSON.parse(action.rawText);
        } catch {
          const telemetry: AICompletionTelemetry = {
            provider: this.name,
            model: this.model,
            inputTokens: 200,
            outputTokens: 50,
            cachedTokens: 0,
            estimatedCostUsd: 0,
            latencyMs,
            status: "FAILED",
            ...action.telemetry,
          };
          if (context) {
            await recordAITelemetry(telemetry, context);
          }
          throw new AIProviderError(
            "AI_SCHEMA_INVALID",
            "Failed to parse JSON response",
            true,
            telemetry
          );
        }

        const parseResult = request.schema.safeParse(parsed);
        if (!parseResult.success) {
          const telemetry: AICompletionTelemetry = {
            provider: this.name,
            model: this.model,
            inputTokens: 200,
            outputTokens: 50,
            cachedTokens: 0,
            estimatedCostUsd: 0,
            latencyMs,
            status: "FAILED",
            ...action.telemetry,
          };
          if (context) {
            await recordAITelemetry(telemetry, context);
          }
          throw new AIProviderError(
            "AI_SCHEMA_INVALID",
            `Schema validation failed: ${parseResult.error.message}`,
            true,
            telemetry
          );
        }

        const telemetry: AICompletionTelemetry = {
          provider: this.name,
          model: this.model,
          inputTokens: action.telemetry?.inputTokens ?? 350,
          outputTokens: action.telemetry?.outputTokens ?? 150,
          cachedTokens: action.telemetry?.cachedTokens ?? 0,
          estimatedCostUsd: 0,
          latencyMs,
          status: "SUCCESS",
          ...action.telemetry,
        };

        if (context) {
          await recordAITelemetry(telemetry, context);
        }

        return {
          data: parseResult.data,
          telemetry,
          rawText: action.rawText,
        };
      }

      // type === "data"
      const parseResult = request.schema.safeParse(action.payload);
      if (!parseResult.success) {
        throw new AIProviderError(
          "AI_SCHEMA_INVALID",
          `Mock payload violates schema: ${parseResult.error.message}`,
          false
        );
      }

      const telemetry: AICompletionTelemetry = {
        provider: this.name,
        model: this.model,
        inputTokens: action.telemetry?.inputTokens ?? 300,
        outputTokens: action.telemetry?.outputTokens ?? 120,
        cachedTokens: action.telemetry?.cachedTokens ?? 0,
        estimatedCostUsd: 0,
        latencyMs,
        status: "SUCCESS",
        ...action.telemetry,
      };

      if (context) {
        await recordAITelemetry(telemetry, context);
      }

      return {
        data: parseResult.data,
        telemetry,
        rawText: JSON.stringify(action.payload),
      };
    }

    // Default synthetic generator when queue is empty
    const latencyMs = Math.max(5, Date.now() - startTime);

    // Extract any chunk IDs present in userPrompt
    const chunkIdMatches = request.userPrompt.match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
    );
    const availableChunkIds = chunkIdMatches
      ? Array.from(new Set(chunkIdMatches))
      : ["mock-chunk-1"];

    let defaultPayload: unknown;

    if (request.schemaName === "StudyPackCandidate") {
      defaultPayload = {
        summaryParagraphs: [
          {
            paragraph:
              "El material presenta aspectos fundamentales de la fisiopatología y manejo clínico.",
            evidenceChunkIds: [availableChunkIds[0]],
          },
        ],
        learningObjectives: [
          {
            objective:
              "Comprender los principios diagnósticos expuestos en el documento.",
            evidenceChunkIds: [availableChunkIds[0]],
          },
        ],
        keyConcepts: [
          {
            title: "Principio Rector",
            explanation:
              "Fundamentación fisiopatológica descrita en el texto fuente.",
            evidenceChunkIds: [availableChunkIds[0]],
          },
        ],
        highYieldPoints: [
          {
            point:
              "Punto de alto rendimiento clínico respaldado por la evidencia.",
            evidenceChunkIds: [availableChunkIds[0]],
          },
        ],
        keyTerms: [
          {
            term: "Término Clave",
            definition: "Definición grounded en el texto fuente del documento.",
            evidenceChunkIds: [availableChunkIds[0]],
          },
        ],
      };
    } else if (request.schemaName === "StudyPackVerification") {
      // Find item keys in the prompt
      const itemKeyMatches =
        request.userPrompt.match(/"itemKey":\s*"([^"]+)"/g) || [];
      const keys = itemKeyMatches.map((m) =>
        m.replace(/"itemKey":\s*"/, "").replace(/"/, "")
      );

      defaultPayload = {
        evaluations: (keys.length > 0
          ? keys
          : ["summary-0", "obj-0", "concept-0", "hy-0", "term-0"]
        ).map((key) => ({
          itemKey: key,
          verdict: "SUPPORTED",
          rationale: "Claim is directly verifiable in cited chunk text.",
        })),
      };
    } else {
      defaultPayload = {};
    }

    const parseResult = request.schema.safeParse(defaultPayload);
    if (!parseResult.success) {
      throw new AIProviderError(
        "AI_SCHEMA_INVALID",
        `Default mock payload does not match schema ${request.schemaName}: ${parseResult.error.message}`,
        false
      );
    }

    const inputTokens = Math.max(50, Math.floor(request.userPrompt.length / 4));
    const outputTokens = 120;
    const estimatedCostUsd = calculateEstimatedCostUsd(
      this.model,
      inputTokens,
      outputTokens,
      0
    );

    const telemetry: AICompletionTelemetry = {
      provider: this.name,
      model: this.model,
      inputTokens,
      outputTokens,
      cachedTokens: 0,
      estimatedCostUsd,
      latencyMs,
      status: "SUCCESS",
    };

    if (context) {
      await recordAITelemetry(telemetry, context);
    }

    return {
      data: parseResult.data,
      telemetry,
      rawText: JSON.stringify(defaultPayload),
    };
  }
}
