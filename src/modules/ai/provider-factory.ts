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
 * Returns the active AIProvider according to runtime configuration.
 * Automated tests always receive MockAIProvider with $0.00 spend.
 */
export function getAIProvider(options?: ProviderFactoryOptions): AIProvider {
  if (options?.forceProvider) {
    return options.forceProvider;
  }

  // 1. Safety kill-switch check MUST come first
  if (!serverEnv.AI_GENERATION_ENABLED) {
    throw new AIProviderError(
      "AI_DISABLED",
      "AI generation is currently disabled by server configuration.",
      false
    );
  }

  // 2. Mock provider is ONLY allowed in test environments OR when explicitly allowed
  const isTest = process.env.NODE_ENV === "test";
  const allowMock = isTest || options?.allowMockInNonTest === true;

  if (serverEnv.AI_PROVIDER === "mock") {
    if (!allowMock) {
      throw new AIProviderError(
        "AI_NOT_CONFIGURED",
        "Mock AI provider is only permitted in test environments or when explicitly allowed.",
        false
      );
    }
    return getMockAIProvider();
  }

  // In test environment, default to mock provider if no provider is configured
  if (
    isTest &&
    (!serverEnv.AI_PROVIDER || serverEnv.AI_PROVIDER.trim() === "")
  ) {
    return getMockAIProvider();
  }

  // 3. Outside tests, provider must not be empty/none
  if (!serverEnv.AI_PROVIDER || serverEnv.AI_PROVIDER.trim() === "") {
    throw new AIProviderError(
      "AI_NOT_CONFIGURED",
      "No AI provider configured. Study Pack generation is unavailable.",
      false
    );
  }

  // 4. Mandatory credential check
  if (!serverEnv.AI_API_KEY || serverEnv.AI_API_KEY.trim() === "") {
    throw new AIProviderError(
      "AI_NOT_CONFIGURED",
      "AI provider API key is not configured. Study Pack generation is unavailable.",
      false
    );
  }

  return new OpenAICompatibleProvider({
    providerName: serverEnv.AI_PROVIDER,
    model: serverEnv.AI_MODEL,
    apiKey: serverEnv.AI_API_KEY,
    baseURL: serverEnv.AI_BASE_URL,
  });
}
