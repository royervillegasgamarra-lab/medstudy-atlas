/**
 * Centralized Study Pack Limits, Configuration, Versioning & Cost Constraints.
 * Phase 1E: Deterministic Chunking, Evidence Layer & Study Pack Generation.
 */

export const CHUNKING_VERSION = "chunk-v1" as const;
export const STUDY_PACK_GENERATION_VERSION = "sp-gen-v1" as const;
export const STUDY_PACK_PROMPT_VERSION = "sp-prompt-v1" as const;

export interface ChunkingLimits {
  targetChunkChars: number;
  maxChunkChars: number;
  overlapChars: number;
  minChunkChars: number;
}

export interface StudyPackBudgetLimits {
  maxEvidenceChars: number;
  maxEvidenceChunks: number;
  maxSummaryParagraphs: number;
  minSummaryParagraphs: number;
  maxLearningObjectives: number;
  minLearningObjectives: number;
  maxKeyConcepts: number;
  minKeyConcepts: number;
  maxHighYieldPoints: number;
  minHighYieldPoints: number;
  maxKeyTerms: number;
  minKeyTerms: number;
  minCitationsPerItem: number;
  maxCitationsPerItem: number;
  maxSummaryParagraphChars: number;
  maxLearningObjectiveChars: number;
  maxKeyConceptTitleChars: number;
  maxKeyConceptExplanationChars: number;
  maxHighYieldPointChars: number;
  maxKeyTermChars: number;
  maxKeyTermDefinitionChars: number;
  maxVerificationExplanationChars: number;
}

export interface StudyPackWorkerLimits {
  maxRetries: number;
  defaultLeaseSeconds: number;
  workerLeaseSeconds: number;
  minLeaseSeconds: number;
  maxLeaseSeconds: number;
  providerTimeoutSeconds: number;
  maxCandidateTokens: number;
  maxVerifierTokens: number;
}

export const CHUNKING_LIMITS: ChunkingLimits = {
  targetChunkChars: 1800,
  maxChunkChars: 2800,
  overlapChars: 200,
  minChunkChars: 250,
};

export const STUDY_PACK_BUDGET_LIMITS: StudyPackBudgetLimits = {
  maxEvidenceChars: 100_000,
  maxEvidenceChunks: 80,
  maxSummaryParagraphs: 5,
  minSummaryParagraphs: 1,
  maxLearningObjectives: 10,
  minLearningObjectives: 1,
  maxKeyConcepts: 15,
  minKeyConcepts: 1,
  maxHighYieldPoints: 15,
  minHighYieldPoints: 1,
  maxKeyTerms: 25,
  minKeyTerms: 1,
  minCitationsPerItem: 1,
  maxCitationsPerItem: 5,
  maxSummaryParagraphChars: 1000,
  maxLearningObjectiveChars: 300,
  maxKeyConceptTitleChars: 150,
  maxKeyConceptExplanationChars: 1000,
  maxHighYieldPointChars: 500,
  maxKeyTermChars: 100,
  maxKeyTermDefinitionChars: 500,
  maxVerificationExplanationChars: 500,
};

export const STUDY_PACK_WORKER_LIMITS: StudyPackWorkerLimits = {
  maxRetries: 3,
  defaultLeaseSeconds: 300,
  workerLeaseSeconds: 300,
  minLeaseSeconds: 30,
  maxLeaseSeconds: 1800,
  providerTimeoutSeconds: 60,
  maxCandidateTokens: 4096,
  maxVerifierTokens: 2048,
};

/**
 * Versioned pricing snapshot (USD per 1,000,000 tokens).
 * Raw token counts are always stored in ai_usages so historical costs can be audited.
 */
export interface ModelPricing {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  cachedUsdPerMillion: number;
}

export const MODEL_PRICING_SNAPSHOT: Record<string, ModelPricing> = {
  "mock-model": {
    inputUsdPerMillion: 0,
    outputUsdPerMillion: 0,
    cachedUsdPerMillion: 0,
  },
  "gpt-4o": {
    inputUsdPerMillion: 2.5,
    outputUsdPerMillion: 10.0,
    cachedUsdPerMillion: 1.25,
  },
  "gpt-4o-mini": {
    inputUsdPerMillion: 0.15,
    outputUsdPerMillion: 0.6,
    cachedUsdPerMillion: 0.075,
  },
  "deepseek-chat": {
    inputUsdPerMillion: 0.14,
    outputUsdPerMillion: 0.28,
    cachedUsdPerMillion: 0.014,
  },
  "deepseek-flash": {
    inputUsdPerMillion: 0.14,
    outputUsdPerMillion: 0.28,
    cachedUsdPerMillion: 0.014,
  },
  "gemini-1.5-flash": {
    inputUsdPerMillion: 0.075,
    outputUsdPerMillion: 0.3,
    cachedUsdPerMillion: 0.01875,
  },
  default: {
    inputUsdPerMillion: 0.2,
    outputUsdPerMillion: 0.8,
    cachedUsdPerMillion: 0.05,
  },
};
