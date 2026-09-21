import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import { MockAIProvider } from "@/modules/ai/mock-provider";
import { calculateEstimatedCostUsd } from "@/modules/ai/pricing";
import { recordAITelemetry } from "@/modules/ai/telemetry";
import {
  AIProviderError,
  type AIProvider,
  type AIStructuredRequest,
  type AIStructuredResult,
} from "@/modules/ai/types";
import type { CanonicalChunk } from "@/modules/study-packs/chunking";
import {
  getAIProvider,
  getMockAIProvider,
  resetMockAIProvider,
} from "@/modules/ai/provider-factory";
import { classifyAIError } from "@/modules/ai/error-classifier";
import { OpenAICompatibleProvider } from "@/modules/ai/openai-compatible-provider";
import { resolveBenchmarkExecutionPlan } from "@/benchmarks/study-pack-benchmark";
import { serverEnv } from "@/config/server-env";

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

describe("AI Error Classifier & Transport Resilience (Item 1)", () => {
  it("classifies HTTP 503 as AI_PROVIDER_UNAVAILABLE with retryable: true", () => {
    const error503 = { status: 503, message: "Service Unavailable" };
    const res = classifyAIError(error503);
    expect(res.code).toBe("AI_PROVIDER_UNAVAILABLE");
    expect(res.retryable).toBe(true);
  });

  it("classifies ECONNRESET transport failure as AI_PROVIDER_UNAVAILABLE with retryable: true", () => {
    const errConnReset = new Error("fetch failed");
    (
      errConnReset as unknown as {
        cause: { code: string; message: string };
      }
    ).cause = {
      code: "ECONNRESET",
      message: "read ECONNRESET",
    };
    const res = classifyAIError(errConnReset);
    expect(res.code).toBe("AI_PROVIDER_UNAVAILABLE");
    expect(res.retryable).toBe(true);
  });

  it("classifies ENOTFOUND DNS failure as AI_PROVIDER_UNAVAILABLE with retryable: true", () => {
    const errDns = new Error("getaddrinfo ENOTFOUND api.openai.com");
    (errDns as unknown as { code: string }).code = "ENOTFOUND";
    const res = classifyAIError(errDns);
    expect(res.code).toBe("AI_PROVIDER_UNAVAILABLE");
    expect(res.retryable).toBe(true);
  });

  it("classifies HTTP 401 as AI_PROVIDER_AUTH_ERROR with retryable: false (final)", () => {
    const error401 = { statusCode: 401, message: "Incorrect API key provided" };
    const res = classifyAIError(error401);
    expect(res.code).toBe("AI_PROVIDER_AUTH_ERROR");
    expect(res.retryable).toBe(false);
  });

  it("classifies HTTP 403 as AI_PROVIDER_AUTH_ERROR with retryable: false (final)", () => {
    const error403 = { status: 403, message: "Forbidden" };
    const res = classifyAIError(error403);
    expect(res.code).toBe("AI_PROVIDER_AUTH_ERROR");
    expect(res.retryable).toBe(false);
  });

  it("classifies HTTP 429 as AI_RATE_LIMITED with retryable: true", () => {
    const error429 = { status: 429, message: "Rate limit reached" };
    const res = classifyAIError(error429);
    expect(res.code).toBe("AI_RATE_LIMITED");
    expect(res.retryable).toBe(true);
  });

  it("classifies timeout / abort as AI_TIMEOUT with retryable: true", () => {
    const abortErr = new Error("The operation was aborted");
    abortErr.name = "AbortError";
    const res = classifyAIError(abortErr);
    expect(res.code).toBe("AI_TIMEOUT");
    expect(res.retryable).toBe(true);
  });

  it("classifies transport error as AI_PROVIDER_UNAVAILABLE with retryable: true via OpenAICompatibleProvider", async () => {
    const provider = new OpenAICompatibleProvider({
      model: "test-model",
      apiKey: "sk-test",
      baseURL: "http://127.0.0.1:54329/v1",
      fetch: async () => {
        const err = new TypeError("fetch failed");
        (err as unknown as { cause: { code: string } }).cause = {
          code: "ECONNRESET",
        };
        throw err;
      },
    });

    await expect(
      provider.generateStructured({
        schema: z.object({ title: z.string() }),
        schemaName: "Test",
        systemPrompt: "Sys",
        userPrompt: "User",
        maxRetries: 0,
      })
    ).rejects.toMatchObject({
      code: "AI_PROVIDER_UNAVAILABLE",
      retryable: true,
    });
  });
});

describe("Benchmark Execution Plan Opt-In (Item 2)", () => {
  it("defaults to Mode A Mock Smoke ($0.00 spend) even when real-looking provider and key are configured", () => {
    const plan = resolveBenchmarkExecutionPlan({
      argv: ["node", "study-pack-benchmark.ts"],
      env: { AI_BENCHMARK_LIVE: undefined },
      config: {
        AI_GENERATION_ENABLED: true,
        AI_PROVIDER: "openai",
        AI_MODEL: "gpt-4o",
        AI_API_KEY: "sk-live-secret-key-that-must-not-be-used",
      },
    });

    expect(plan.mode).toBe("MOCK");
    expect(plan.provider.name).toBe("mock-provider");
    expect(plan.reason).toContain("Mode A Mock Smoke");
  });

  it("throws error when --live is passed but AI configuration is disabled or missing", () => {
    expect(() =>
      resolveBenchmarkExecutionPlan({
        argv: ["node", "study-pack-benchmark.ts", "--live"],
        env: {},
        config: {
          AI_GENERATION_ENABLED: false,
          AI_PROVIDER: "mock",
          AI_MODEL: "mock-model",
        },
      })
    ).toThrow(/Explicit live benchmark was requested/);
  });

  it("selects Mode B Live Benchmark only when explicitly requested via --live or AI_BENCHMARK_LIVE=true with valid config", () => {
    const origEnv = process.env.NODE_ENV;
    try {
      (process.env as Record<string, string | undefined>).NODE_ENV =
        "development";
      const plan = resolveBenchmarkExecutionPlan({
        argv: ["node", "study-pack-benchmark.ts", "--live"],
        env: { AI_BENCHMARK_LIVE: "true" },
        config: {
          AI_GENERATION_ENABLED: true,
          AI_PROVIDER: "openai-compatible",
          AI_MODEL: "custom-model",
          AI_API_KEY: "sk-test",
        },
      });

      expect(plan.mode).toBe("LIVE");
      expect(plan.reason).toContain("Mode B Live Model Benchmark");
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = origEnv;
    }
  });
});

describe("Kill Switch on Injected Providers in Product Runtime (Item 4)", () => {
  it("enforces kill switch in production even when an AI provider is injected: throws AI_DISABLED and calls provider 0 times", async () => {
    const origNodeEnv = process.env.NODE_ENV;
    const origEnabled = serverEnv.AI_GENERATION_ENABLED;

    try {
      (process.env as Record<string, string | undefined>).NODE_ENV =
        "production";
      (serverEnv as Record<string, unknown>).AI_GENERATION_ENABLED = false;

      let calls = 0;
      const fakeProvider: AIProvider = {
        name: "injected-custom-provider",
        model: "custom-model",
        generateStructured: async <T>() => {
          calls++;
          return {} as unknown as AIStructuredResult<T>;
        },
      };

      // getAIProvider with forceProvider must throw AI_DISABLED when AI_GENERATION_ENABLED=false
      expect(() => getAIProvider({ forceProvider: fakeProvider })).toThrow(
        AIProviderError
      );

      try {
        getAIProvider({ forceProvider: fakeProvider });
      } catch (e: unknown) {
        expect((e as AIProviderError).code).toBe("AI_DISABLED");
      }

      expect(calls).toBe(0);
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV =
        origNodeEnv;
      (serverEnv as Record<string, unknown>).AI_GENERATION_ENABLED =
        origEnabled;
    }
  });
});

describe("CALL 1 / CALL 2 Request Bounds in generateStudyPackContent (Item 5)", () => {
  it("passes exact bounds: maxTokens=4096 on candidate (CALL 1) and maxTokens=2048 on verifier (CALL 2) with non-null AbortSignal", async () => {
    const { generateStudyPackContent } =
      await import("@/modules/study-packs/service");

    const recordedRequests: Array<AIStructuredRequest<unknown>> = [];

    const instrumentedProvider: AIProvider = {
      name: "instrumented-provider",
      model: "instrumented-model",
      generateStructured: async <T>(req: AIStructuredRequest<T>) => {
        recordedRequests.push(req as AIStructuredRequest<unknown>);

        if (req.schemaName === "StudyPackCandidate") {
          const candidateData = {
            summaryParagraphs: [
              {
                paragraph:
                  "El nódulo sinusal es el marcapasos primario del corazón.",
                evidenceChunkIds: ["c-1"],
              },
            ],
            learningObjectives: [
              {
                objective: "Identificar el marcapasos primario.",
                evidenceChunkIds: ["c-1"],
              },
            ],
            keyConcepts: [
              {
                title: "Nódulo Sinusal",
                explanation:
                  "Estructura especializada que genera los impulsos eléctricos cardiacos.",
                evidenceChunkIds: ["c-1"],
              },
            ],
            highYieldPoints: [
              {
                point: "Frecuencia intrínseca 60-100 lpm.",
                evidenceChunkIds: ["c-1"],
              },
            ],
            keyTerms: [
              {
                term: "Automatismo",
                definition:
                  "Capacidad de despolarizarse espontáneamente sin estímulo externo.",
                evidenceChunkIds: ["c-1"],
              },
            ],
          };
          return {
            data: candidateData as unknown as T,
            telemetry: {
              provider: "instrumented-provider",
              model: "instrumented-model",
              inputTokens: 100,
              outputTokens: 50,
              cachedTokens: 0,
              estimatedCostUsd: 0.0001,
              latencyMs: 50,
              status: "SUCCESS" as const,
            },
          };
        }

        if (req.schemaName === "StudyPackVerification") {
          const parsed = JSON.parse(req.userPrompt) as {
            candidates: Array<{ itemKey: string }>;
          };
          const evaluations = parsed.candidates.map((c) => ({
            itemKey: c.itemKey,
            verdict: "SUPPORTED",
            rationale: "Directly in chunk c-1",
          }));
          const verificationData = { evaluations };
          return {
            data: verificationData as unknown as T,
            telemetry: {
              provider: "instrumented-provider",
              model: "instrumented-model",
              inputTokens: 120,
              outputTokens: 40,
              cachedTokens: 0,
              estimatedCostUsd: 0.0001,
              latencyMs: 40,
              status: "SUCCESS" as const,
            },
          };
        }

        throw new Error(`Unexpected schemaName: ${req.schemaName}`);
      },
    };

    const dummyChunks: CanonicalChunk[] = [
      {
        id: "c-1",
        document_id: "doc-1",
        user_id: "user-1",
        document_page_id: "page-1",
        processing_run_id: "run-1",
        page_number: 1,
        chunk_index: 0,
        content:
          "El nódulo sinusal es el marcapasos primario del corazón, localizado en la aurícula derecha. Posee automatismo intrínseco con una frecuencia de 60 a 100 lpm.",
        char_count: 147,
        start_char: 0,
        end_char: 147,
        content_sha256: "dummy-sha",
        chunking_version: "chunk-v1",
      },
    ];

    const result = await generateStudyPackContent({
      documentId: "doc-1",
      userId: "user-1",
      processingRunId: "run-1",
      studyPackId: "pack-1",
      chunks: dummyChunks,
      aiProvider: instrumentedProvider,
    });

    expect(result.items.length).toBe(5);
    expect(recordedRequests.length).toBe(2);

    // Assert CALL 1 (Candidate generation)
    const call1 = recordedRequests[0];
    expect(call1.schemaName).toBe("StudyPackCandidate");
    expect(call1.maxTokens).toBe(4096);
    expect(call1.abortSignal).toBeDefined();
    expect(call1.abortSignal).toBeInstanceOf(AbortSignal);
    expect(call1.abortSignal?.aborted).toBe(false);

    // Assert CALL 2 (Evidence verification)
    const call2 = recordedRequests[1];
    expect(call2.schemaName).toBe("StudyPackVerification");
    expect(call2.maxTokens).toBe(2048);
    expect(call2.abortSignal).toBeDefined();
    expect(call2.abortSignal).toBeInstanceOf(AbortSignal);
    expect(call2.abortSignal?.aborted).toBe(false);
  });
});
