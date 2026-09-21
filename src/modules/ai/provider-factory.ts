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

  // Tests always use MockAIProvider
  if (process.env.NODE_ENV === "test" || serverEnv.AI_PROVIDER === "mock") {
    return getMockAIProvider();
  }

  // Safety kill-switch check
  if (!serverEnv.AI_GENERATION_ENABLED) {
    throw new AIProviderError(
      "AI_DISABLED",
      "AI generation is currently disabled by server configuration.",
      false
    );
  }

  // Mandatory credential check
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
