import { serverEnv } from "@/config/server-env";
import type { AIProvider } from "./types";
import { AIProviderError } from "./types";
import { MockAIProvider } from "./mock-provider";
import { OpenAICompatibleProvider } from "./openai-compatible-provider";

let sharedMockProvider: MockAIProvider | null = null;

export function getMockAIProvider(): MockAIProvider {
  if (!sharedMockProvider) {
    sharedMockProvider = new MockAIProvider();
  }
  return sharedMockProvider;
}

export function resetMockAIProvider(): void {
  if (sharedMockProvider) {
    sharedMockProvider.clearQueue();
  }
}

export interface ProviderFactoryOptions {
  allowMockInNonTest?: boolean;
  forceProvider?: AIProvider;
}

/**
 * Validates AI provider configuration fail-closed BEFORE any client or network call is created.
 */
export function validateAIProviderEndpoint(params: {
  provider: string;
  model: string;
  apiKey?: string;
  baseURL?: string;
  nodeEnv?: string;
}): { resolvedBaseURL: string } {
  const { provider, model, apiKey, baseURL, nodeEnv } = params;
  const isProduction = (nodeEnv ?? process.env.NODE_ENV) === "production";

  if (!model || model.trim() === "") {
    throw new AIProviderError(
      "AI_NOT_CONFIGURED",
      "AI_MODEL must be configured and non-empty for non-mock provider.",
      false
    );
  }

  if (!apiKey || apiKey.trim() === "") {
    throw new AIProviderError(
      "AI_NOT_CONFIGURED",
      "AI provider API key is not configured. Study Pack generation is unavailable.",
      false
    );
  }

  const normalizedProvider = provider.trim().toLowerCase();
  let effectiveBaseURL = baseURL?.trim();

  if (!effectiveBaseURL) {
    if (normalizedProvider === "openai") {
      effectiveBaseURL = "https://api.openai.com/v1";
    } else {
      throw new AIProviderError(
        "AI_NOT_CONFIGURED",
        `AI_BASE_URL is required for provider "${provider}". Silently routing non-OpenAI providers to OpenAI is prohibited.`,
        false
      );
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(effectiveBaseURL);
  } catch {
    throw new AIProviderError(
      "AI_NOT_CONFIGURED",
      `Invalid AI_BASE_URL: "${effectiveBaseURL}". Must be a valid absolute URL.`,
      false
    );
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new AIProviderError(
      "AI_NOT_CONFIGURED",
      `Invalid AI_BASE_URL protocol: "${parsed.protocol}". Only HTTP and HTTPS are permitted.`,
      false
    );
  }

  if (parsed.protocol === "http:") {
    if (isProduction) {
      throw new AIProviderError(
        "AI_NOT_CONFIGURED",
        "Production AI provider endpoints require HTTPS. HTTP is prohibited.",
        false
      );
    }
    const isLocalhost =
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "::1";
    if (!isLocalhost) {
      throw new AIProviderError(
        "AI_NOT_CONFIGURED",
        `Non-local HTTP AI endpoint "${effectiveBaseURL}" is prohibited. Use HTTPS.`,
        false
      );
    }
  }

  return { resolvedBaseURL: effectiveBaseURL };
}

/**
 * Performs a zero-network check of AI configuration availability.
 * Throws AIProviderError if AI is disabled or invalidly configured.
 */
export function assertAIGenerationAvailable(
  options?: ProviderFactoryOptions
): void {
  // 1. Safety kill-switch check MUST come first
  if (!serverEnv.AI_GENERATION_ENABLED) {
    throw new AIProviderError(
      "AI_DISABLED",
      "AI generation is currently disabled by server configuration.",
      false
    );
  }

  // 2. Mock provider check
  if (serverEnv.AI_PROVIDER === "mock") {
    // In production, mock provider is unconditionally and irrevocably prohibited
    if (process.env.NODE_ENV === "production") {
      throw new AIProviderError(
        "AI_NOT_CONFIGURED",
        "Mock AI provider is strictly prohibited in production environment.",
        false
      );
    }

    const isTest = process.env.NODE_ENV === "test";
    const allowMock =
      isTest ||
      options?.allowMockInNonTest === true ||
      process.env.ALLOW_MOCK_AI === "true";
    if (!allowMock) {
      throw new AIProviderError(
        "AI_NOT_CONFIGURED",
        "Mock AI provider is only permitted in test environments or when explicitly injected for local testing.",
        false
      );
    }
    return;
  }

  // In test environment, default to mock provider if no provider is configured
  const isTest = process.env.NODE_ENV === "test";
  if (
    isTest &&
    (!serverEnv.AI_PROVIDER || serverEnv.AI_PROVIDER.trim() === "")
  ) {
    return;
  }

  // 3. Outside tests, provider must not be empty/none
  if (!serverEnv.AI_PROVIDER || serverEnv.AI_PROVIDER.trim() === "") {
    throw new AIProviderError(
      "AI_NOT_CONFIGURED",
      "No AI provider configured. Study Pack generation is unavailable.",
      false
    );
  }

  // 4. Validate endpoint and credentials
  validateAIProviderEndpoint({
    provider: serverEnv.AI_PROVIDER,
    model: serverEnv.AI_MODEL,
    apiKey: serverEnv.AI_API_KEY,
    baseURL: serverEnv.AI_BASE_URL,
    nodeEnv: process.env.NODE_ENV,
  });
}

/**
 * Returns the active AIProvider according to runtime configuration.
 * Automated tests receive MockAIProvider with $0.00 spend.
 */
export function getAIProvider(options?: ProviderFactoryOptions): AIProvider {
  if (process.env.NODE_ENV !== "test") {
    assertAIGenerationAvailable(options);
  }

  if (options?.forceProvider) {
    if (
      process.env.NODE_ENV === "production" &&
      options.forceProvider.name === "mock-provider"
    ) {
      throw new AIProviderError(
        "AI_NOT_CONFIGURED",
        "Mock AI provider is strictly prohibited in production environment.",
        false
      );
    }
    return options.forceProvider;
  }

  if (process.env.NODE_ENV === "test") {
    assertAIGenerationAvailable(options);
  }

  if (
    serverEnv.AI_PROVIDER === "mock" ||
    (process.env.NODE_ENV === "test" &&
      (!serverEnv.AI_PROVIDER || serverEnv.AI_PROVIDER.trim() === ""))
  ) {
    return getMockAIProvider();
  }

  const { resolvedBaseURL } = validateAIProviderEndpoint({
    provider: serverEnv.AI_PROVIDER,
    model: serverEnv.AI_MODEL,
    apiKey: serverEnv.AI_API_KEY,
    baseURL: serverEnv.AI_BASE_URL,
    nodeEnv: process.env.NODE_ENV,
  });

  return new OpenAICompatibleProvider({
    providerName: serverEnv.AI_PROVIDER,
    model: serverEnv.AI_MODEL,
    apiKey: serverEnv.AI_API_KEY!,
    baseURL: resolvedBaseURL,
  });
}
