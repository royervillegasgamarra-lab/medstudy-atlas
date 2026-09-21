import { z } from "zod";

export type AIErrorCode =
  | "AI_NOT_CONFIGURED"
  | "AI_DISABLED"
  | "AI_RATE_LIMITED"
  | "AI_TIMEOUT"
  | "AI_PROVIDER_UNAVAILABLE"
  | "AI_PROVIDER_AUTH_ERROR"
  | "AI_SCHEMA_INVALID"
  | "AI_UNKNOWN_ERROR";

export interface AICompletionTelemetry {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  estimatedCostUsd: number;
  latencyMs: number;
  status: "SUCCESS" | "FAILED" | "RATE_LIMITED";
}

export interface AIStructuredRequest<T> {
  schema: z.ZodType<T>;
  schemaName: string;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AIStructuredResult<T> {
  data: T;
  telemetry: AICompletionTelemetry;
  rawText?: string;
}

export interface AIRequestContext {
  userId?: string;
  documentId?: string;
  studyPackId?: string;
  feature: "STUDY_PACK_GEN" | "STUDY_PACK_VERIFY" | "BENCHMARK";
}

export interface AIProvider {
  readonly name: string;
  readonly model: string;
  generateStructured<T>(
    request: AIStructuredRequest<T>,
    context?: AIRequestContext
  ): Promise<AIStructuredResult<T>>;
}

export class AIProviderError extends Error {
  constructor(
    public readonly code: AIErrorCode,
    message: string,
    public readonly retryable: boolean,
    public readonly telemetry?: Partial<AICompletionTelemetry>
  ) {
    super(message);
    this.name = "AIProviderError";
  }
}
