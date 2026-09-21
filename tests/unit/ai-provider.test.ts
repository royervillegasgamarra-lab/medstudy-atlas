import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import { MockAIProvider } from "@/modules/ai/mock-provider";
import { calculateEstimatedCostUsd } from "@/modules/ai/pricing";
import { recordAITelemetry } from "@/modules/ai/telemetry";
import { AIProviderError } from "@/modules/ai/types";
import {
  getAIProvider,
  getMockAIProvider,
  resetMockAIProvider,
} from "@/modules/ai/provider-factory";

describe("MockAIProvider", () => {
  let mock: MockAIProvider;

  const testSchema = z.object({
    message: z.string(),
    code: z.number(),
  });

  beforeEach(() => {
    mock = new MockAIProvider();
  });

  it("returns queued data payload matching schema", async () => {
    mock.enqueueData({ message: "Hola Mundo", code: 200 });

    const result = await mock.generateStructured({
      schema: testSchema,
      schemaName: "TestSchema",
      systemPrompt: "System prompt",
      userPrompt: "User prompt",
    });

    expect(result.data).toEqual({ message: "Hola Mundo", code: 200 });
    expect(result.telemetry.status).toBe("SUCCESS");
    expect(result.telemetry.provider).toBe("mock-provider");
    expect(mock.callCount).toBe(1);
  });

  it("throws AI_SCHEMA_INVALID if queued data violates schema", async () => {
    mock.enqueueData({ message: "Falta el campo code" });

    await expect(
      mock.generateStructured({
        schema: testSchema,
        schemaName: "TestSchema",
        systemPrompt: "System prompt",
        userPrompt: "User prompt",
      })
    ).rejects.toThrow(AIProviderError);
  });

  it("parses queued raw JSON text correctly", async () => {
    mock.enqueueRaw(JSON.stringify({ message: "Raw valid", code: 42 }));

    const result = await mock.generateStructured({
      schema: testSchema,
      schemaName: "TestSchema",
      systemPrompt: "System",
      userPrompt: "User",
    });

    expect(result.data).toEqual({ message: "Raw valid", code: 42 });
  });

  it("throws AI_SCHEMA_INVALID when raw text is unparseable JSON", async () => {
    mock.enqueueRaw("INVALID_JSON_CONTENT{{{");

    await expect(
      mock.generateStructured({
        schema: testSchema,
        schemaName: "TestSchema",
        systemPrompt: "System",
        userPrompt: "User",
      })
    ).rejects.toThrow(/Failed to parse JSON response/);
  });

  it("throws queued error with correct retryable flag and telemetry", async () => {
    mock.enqueueError("AI_RATE_LIMITED", "Too many requests to provider", true);

    try {
      await mock.generateStructured({
        schema: testSchema,
        schemaName: "TestSchema",
        systemPrompt: "System",
        userPrompt: "User",
      });
      expect.fail("Should have thrown AIProviderError");
    } catch (err) {
      expect(err).toBeInstanceOf(AIProviderError);
      const aiErr = err as AIProviderError;
      expect(aiErr.code).toBe("AI_RATE_LIMITED");
      expect(aiErr.retryable).toBe(true);
      expect(aiErr.telemetry?.status).toBe("RATE_LIMITED");
    }
  });

  it("clears queue and resets call counts", () => {
    mock.enqueueData({ message: "A", code: 1 });
    mock.clearQueue();
    expect(mock.callCount).toBe(0);
  });
});

describe("AI Pricing Calculator", () => {
  it("calculates costs correctly for gpt-4o", () => {
    // 1,000 input tokens at $2.50 / 1M = $0.0025
    // 1,000 output tokens at $10.00 / 1M = $0.0100
    // Total = $0.0125
    const cost = calculateEstimatedCostUsd("gpt-4o", 1000, 1000, 0);
    expect(cost).toBeCloseTo(0.0125, 6);
  });

  it("calculates costs correctly for gpt-4o-mini", () => {
    // 10,000 input at $0.15 / 1M = $0.0015
    // 1,000 output at $0.60 / 1M = $0.0006
    // Total = $0.0021
    const cost = calculateEstimatedCostUsd("gpt-4o-mini", 10000, 1000, 0);
    expect(cost).toBeCloseTo(0.0021, 6);
  });

  it("applies cached token discounts when available", () => {
    const costNoCache = calculateEstimatedCostUsd("gpt-4o", 10000, 1000, 0);
    const costWithCache = calculateEstimatedCostUsd(
      "gpt-4o",
      10000,
      1000,
      5000
    );
    expect(costWithCache).toBeLessThan(costNoCache);
  });

  it("uses default fallback pricing for unrecognized models", () => {
    const cost = calculateEstimatedCostUsd(
      "custom-medical-llm-v1",
      1000,
      1000,
      0
    );
    expect(cost).toBeGreaterThan(0);
  });
});

describe("AI Telemetry & Factory", () => {
  it("skips telemetry recording when userId is not provided", async () => {
    const res = await recordAITelemetry({
      provider: "mock",
      model: "mock",
      inputTokens: 10,
      outputTokens: 10,
      cachedTokens: 0,
      estimatedCostUsd: 0,
      latencyMs: 10,
      status: "SUCCESS",
    });
    expect(res).toBeNull();
  });

  it("skips telemetry recording when feature is BENCHMARK", async () => {
    const res = await recordAITelemetry(
      {
        provider: "mock",
        model: "mock",
        inputTokens: 10,
        outputTokens: 10,
        cachedTokens: 0,
        estimatedCostUsd: 0,
        latencyMs: 10,
        status: "SUCCESS",
      },
      {
        userId: "user-123",
        feature: "BENCHMARK",
      }
    );
    expect(res).toBeNull();
  });

  it("provider factory returns MockAIProvider in test environment", () => {
    const provider = getAIProvider();
    expect(provider).toBeInstanceOf(MockAIProvider);
    expect(provider.name).toBe("mock-provider");
  });

  it("resetMockAIProvider resets shared instance", () => {
    const p1 = getMockAIProvider();
    p1.enqueueData({ foo: "bar" });
    resetMockAIProvider();
    // After reset, queue is cleared
    expect(p1.callCount).toBe(0);
  });
});
