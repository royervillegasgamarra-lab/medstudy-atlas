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

  it("kill switch: throws AI_DISABLED when AI_GENERATION_ENABLED is false", async () => {
    const { serverEnv } = await import("@/config/server-env");
    const originalEnabled = serverEnv.AI_GENERATION_ENABLED;
    try {
      (serverEnv as Record<string, unknown>).AI_GENERATION_ENABLED = false;
      expect(() => getAIProvider()).toThrow(AIProviderError);
      try {
        getAIProvider();
      } catch (err) {
        expect((err as AIProviderError).code).toBe("AI_DISABLED");
        expect((err as AIProviderError).retryable).toBe(false);
      }
    } finally {
      (serverEnv as Record<string, unknown>).AI_GENERATION_ENABLED =
        originalEnabled;
    }
  });

  it("mock gating: unconditionally rejects Mock provider in production environment even with allow flags", async () => {
    const { serverEnv } = await import("@/config/server-env");
    const originalNodeEnv = process.env.NODE_ENV;
    const originalProvider = serverEnv.AI_PROVIDER;
    const originalEnabled = serverEnv.AI_GENERATION_ENABLED;
    try {
      (process.env as Record<string, string | undefined>).NODE_ENV =
        "production";
      (serverEnv as Record<string, unknown>).AI_PROVIDER = "mock";
      (serverEnv as Record<string, unknown>).AI_GENERATION_ENABLED = true;

      // In production, getAIProvider must reject mock provider unconditionally
      expect(() => getAIProvider()).toThrow(AIProviderError);
      try {
        getAIProvider();
      } catch (err) {
        expect((err as AIProviderError).code).toBe("AI_NOT_CONFIGURED");
        expect((err as AIProviderError).retryable).toBe(false);
      }

      // Overriding options must NOT bypass production denial
      expect(() => getAIProvider({ allowMockInNonTest: true })).toThrow(
        AIProviderError
      );
      try {
        getAIProvider({ allowMockInNonTest: true });
      } catch (err) {
        expect((err as AIProviderError).code).toBe("AI_NOT_CONFIGURED");
      }

      // Passing MockAIProvider via forceProvider in production must also be rejected
      const mockInstance = new MockAIProvider();
      expect(() => getAIProvider({ forceProvider: mockInstance })).toThrow(
        AIProviderError
      );
      expect(mockInstance.callCount).toBe(0);
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV =
        originalNodeEnv;
      (serverEnv as Record<string, unknown>).AI_PROVIDER = originalProvider;
      (serverEnv as Record<string, unknown>).AI_GENERATION_ENABLED =
        originalEnabled;
    }
  });

  it("mock gating: allows Mock provider in non-production when explicitly allowed for testing", async () => {
    const { serverEnv } = await import("@/config/server-env");
    const originalNodeEnv = process.env.NODE_ENV;
    const originalProvider = serverEnv.AI_PROVIDER;
    const originalAllowMock = process.env.ALLOW_MOCK_AI;
    try {
      (process.env as Record<string, string | undefined>).NODE_ENV =
        "development";
      (serverEnv as Record<string, unknown>).AI_PROVIDER = "mock";
      delete process.env.ALLOW_MOCK_AI;

      // Denied by default in development without option or flag
      expect(() => getAIProvider()).toThrow(AIProviderError);

      // Allowed when explicit allowMockInNonTest option is provided
      const allowed = getAIProvider({ allowMockInNonTest: true });
      expect(allowed).toBeInstanceOf(MockAIProvider);

      // Allowed when ALLOW_MOCK_AI="true" is set in development
      process.env.ALLOW_MOCK_AI = "true";
      const allowedByEnv = getAIProvider();
      expect(allowedByEnv).toBeInstanceOf(MockAIProvider);
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV =
        originalNodeEnv;
      (serverEnv as Record<string, unknown>).AI_PROVIDER = originalProvider;
      if (originalAllowMock !== undefined) {
        process.env.ALLOW_MOCK_AI = originalAllowMock;
      } else {
        delete process.env.ALLOW_MOCK_AI;
      }
    }
  });

  describe("AI Provider Endpoint Fail-Closed Validation", () => {
    it("rejects non-mock provider when model is empty", async () => {
      const { validateAIProviderEndpoint } =
        await import("@/modules/ai/provider-factory");
      expect(() =>
        validateAIProviderEndpoint({
          provider: "openai",
          model: "",
          apiKey: "test-key",
        })
      ).toThrow(AIProviderError);
    });

    it("rejects non-mock provider when API key is missing", async () => {
      const { validateAIProviderEndpoint } =
        await import("@/modules/ai/provider-factory");
      expect(() =>
        validateAIProviderEndpoint({
          provider: "openai",
          model: "gpt-4o",
          apiKey: "",
        })
      ).toThrow(AIProviderError);
    });

    it("rejects arbitrary provider without explicit baseURL (no silent fallback to OpenAI)", async () => {
      const { validateAIProviderEndpoint } =
        await import("@/modules/ai/provider-factory");
      expect(() =>
        validateAIProviderEndpoint({
          provider: "deepseek",
          model: "deepseek-chat",
          apiKey: "ds-key",
        })
      ).toThrow(AIProviderError);

      try {
        validateAIProviderEndpoint({
          provider: "deepseek",
          model: "deepseek-chat",
          apiKey: "ds-key",
        });
      } catch (err) {
        expect((err as AIProviderError).code).toBe("AI_NOT_CONFIGURED");
        expect((err as AIProviderError).message).toContain(
          'AI_BASE_URL is required for provider "deepseek"'
        );
      }
    });

    it("allows omitted baseURL only for provider=openai", async () => {
      const { validateAIProviderEndpoint } =
        await import("@/modules/ai/provider-factory");
      const res = validateAIProviderEndpoint({
        provider: "openai",
        model: "gpt-4o-mini",
        apiKey: "sk-valid-key",
      });
      expect(res.resolvedBaseURL).toBe("https://api.openai.com/v1");
    });

    it("rejects malformed baseURL", async () => {
      const { validateAIProviderEndpoint } =
        await import("@/modules/ai/provider-factory");
      expect(() =>
        validateAIProviderEndpoint({
          provider: "custom",
          model: "custom-model",
          apiKey: "key",
          baseURL: "not-a-url",
        })
      ).toThrow(/Invalid AI_BASE_URL/);
    });

    it("rejects non-http(s) protocols", async () => {
      const { validateAIProviderEndpoint } =
        await import("@/modules/ai/provider-factory");
      expect(() =>
        validateAIProviderEndpoint({
          provider: "custom",
          model: "custom-model",
          apiKey: "key",
          baseURL: "ftp://api.example.com/v1",
        })
      ).toThrow(/Invalid AI_BASE_URL protocol/);
    });

    it("rejects plain HTTP endpoints in production", async () => {
      const { validateAIProviderEndpoint } =
        await import("@/modules/ai/provider-factory");
      expect(() =>
        validateAIProviderEndpoint({
          provider: "custom",
          model: "custom-model",
          apiKey: "key",
          baseURL: "http://remote-api.internal/v1",
          nodeEnv: "production",
        })
      ).toThrow(/Production AI provider endpoints require HTTPS/);
    });

    it("rejects non-local plain HTTP endpoints even in development", async () => {
      const { validateAIProviderEndpoint } =
        await import("@/modules/ai/provider-factory");
      expect(() =>
        validateAIProviderEndpoint({
          provider: "custom",
          model: "custom-model",
          apiKey: "key",
          baseURL: "http://remote-server.com/v1",
          nodeEnv: "development",
        })
      ).toThrow(/Non-local HTTP AI endpoint/);
    });

    it("allows local plain HTTP endpoints in development (e.g. localhost/127.0.0.1)", async () => {
      const { validateAIProviderEndpoint } =
        await import("@/modules/ai/provider-factory");
      const res = validateAIProviderEndpoint({
        provider: "ollama",
        model: "llama3",
        apiKey: "ollama-key",
        baseURL: "http://localhost:11434/v1",
        nodeEnv: "development",
      });
      expect(res.resolvedBaseURL).toBe("http://localhost:11434/v1");
    });
  });

  describe("AI Provider Timeout & Token Bounds Contract", () => {
    it("enforces AbortSignal timeout and maps to AI_TIMEOUT immediately without waiting", async () => {
      const mock = new MockAIProvider();
      const abortedController = new AbortController();
      abortedController.abort();

      const testSchema = z.object({ value: z.string() });

      await expect(
        mock.generateStructured({
          schema: testSchema,
          schemaName: "TestSchema",
          systemPrompt: "Sys",
          userPrompt: "User",
          abortSignal: abortedController.signal,
        })
      ).rejects.toMatchObject({
        code: "AI_TIMEOUT",
        retryable: true,
      });
    });

    it("records bounded maxTokens on candidate and verification requests", async () => {
      const { STUDY_PACK_WORKER_LIMITS } =
        await import("@/config/study-pack-limits");
      expect(STUDY_PACK_WORKER_LIMITS.maxCandidateTokens).toBe(4096);
      expect(STUDY_PACK_WORKER_LIMITS.maxVerifierTokens).toBe(2048);
      expect(STUDY_PACK_WORKER_LIMITS.providerTimeoutSeconds).toBe(60);
    });
  });
});

describe("Study Pack Candidate & Verification Schemas", () => {
  it("rejects candidate payloads exceeding length and count bounds", async () => {
    const { studyPackCandidateSchema } =
      await import("@/modules/study-packs/types");

    // Over-length paragraph (> 1000 chars)
    const longParagraph = "a".repeat(1001);
    const candidateInvalid = {
      summaryParagraphs: [
        {
          paragraph: longParagraph,
          evidenceChunkIds: ["00000000-0000-0000-0000-000000000001"],
        },
      ],
      learningObjectives: [
        {
          objective: "Valid objective",
          evidenceChunkIds: ["00000000-0000-0000-0000-000000000001"],
        },
      ],
      keyConcepts: [
        {
          title: "Concept",
          explanation: "Valid explanation that is sufficiently long",
          evidenceChunkIds: ["00000000-0000-0000-0000-000000000001"],
        },
      ],
      highYieldPoints: [
        {
          point: "Valid high yield point",
          evidenceChunkIds: ["00000000-0000-0000-0000-000000000001"],
        },
      ],
      keyTerms: [
        {
          term: "Term",
          definition: "Valid definition",
          evidenceChunkIds: ["00000000-0000-0000-0000-000000000001"],
        },
      ],
    };

    const res = studyPackCandidateSchema.safeParse(candidateInvalid);
    expect(res.success).toBe(false);
  });

  it("rejects verification evaluations exceeding explanation length limit (500 chars)", async () => {
    const { studyPackVerificationSchema } =
      await import("@/modules/study-packs/types");

    const res = studyPackVerificationSchema.safeParse({
      evaluations: [
        {
          itemKey: "summary-0",
          verdict: "SUPPORTED",
          rationale: "e".repeat(501),
        },
      ],
    });
    expect(res.success).toBe(false);
  });
});
