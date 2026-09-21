import { z } from "zod";
import { STUDY_PACK_BUDGET_LIMITS } from "@/config/study-pack-limits";

export const STUDY_PACK_ERROR_CODES = [
  "SOURCE_NOT_READY",
  "PROCESSING_NOT_SUCCEEDED",
  "CHUNKS_NOT_READY",
  "CHUNK_PROVENANCE_INVALID",
  "AI_NOT_CONFIGURED",
  "AI_DISABLED",
  "AI_RATE_LIMITED",
  "AI_TIMEOUT",
  "AI_PROVIDER_UNAVAILABLE",
  "AI_PROVIDER_AUTH_ERROR",
  "STUDY_PACK_INPUT_LIMIT",
  "STUDY_PACK_SCHEMA_INVALID",
  "STUDY_PACK_CITATION_INVALID",
  "STUDY_PACK_EVIDENCE_QA_FAILED",
  "STUDY_PACK_VERSION_UNSUPPORTED",
  "STUDY_PACK_RETRY_LIMIT",
  "STUDY_PACK_LEASE_EXPIRED",
  "DOCUMENT_ARCHIVED",
  "WORKER_INTERNAL_ERROR",
] as const;

export type StudyPackErrorCode = (typeof STUDY_PACK_ERROR_CODES)[number];

export function isStudyPackErrorRetryable(code: StudyPackErrorCode): boolean {
  switch (code) {
    case "AI_RATE_LIMITED":
    case "AI_TIMEOUT":
    case "AI_PROVIDER_UNAVAILABLE":
    case "AI_DISABLED":
    case "AI_NOT_CONFIGURED":
    case "STUDY_PACK_SCHEMA_INVALID":
    case "STUDY_PACK_CITATION_INVALID":
    case "STUDY_PACK_LEASE_EXPIRED":
      return true;
    default:
      return false;
  }
}

export type StudyPackItemType =
  | "SUMMARY"
  | "LEARNING_OBJECTIVE"
  | "KEY_CONCEPT"
  | "HIGH_YIELD_POINT"
  | "KEY_TERM";

// Candidate Generation Schema (CALL 1)
export const studyPackCandidateItemSchema = z.object({
  paragraph: z
    .string()
    .trim()
    .min(5)
    .max(STUDY_PACK_BUDGET_LIMITS.maxSummaryParagraphChars),
  evidenceChunkIds: z
    .array(z.string().uuid())
    .min(1)
    .max(STUDY_PACK_BUDGET_LIMITS.maxCitationsPerItem),
});

export const studyPackCandidateSchema = z.object({
  summaryParagraphs: z
    .array(
      z.object({
        paragraph: z
          .string()
          .trim()
          .min(10)
          .max(STUDY_PACK_BUDGET_LIMITS.maxSummaryParagraphChars),
        evidenceChunkIds: z
          .array(z.string().uuid())
          .min(1)
          .max(STUDY_PACK_BUDGET_LIMITS.maxCitationsPerItem),
      })
    )
    .min(1)
    .max(STUDY_PACK_BUDGET_LIMITS.maxSummaryParagraphs),
  learningObjectives: z
    .array(
      z.object({
        objective: z
          .string()
          .trim()
          .min(5)
          .max(STUDY_PACK_BUDGET_LIMITS.maxLearningObjectiveChars),
        evidenceChunkIds: z
          .array(z.string().uuid())
          .min(1)
          .max(STUDY_PACK_BUDGET_LIMITS.maxCitationsPerItem),
      })
    )
    .min(1)
    .max(STUDY_PACK_BUDGET_LIMITS.maxLearningObjectives),
  keyConcepts: z
    .array(
      z.object({
        title: z
          .string()
          .trim()
          .min(2)
          .max(STUDY_PACK_BUDGET_LIMITS.maxKeyConceptTitleChars),
        explanation: z
          .string()
          .trim()
          .min(10)
          .max(STUDY_PACK_BUDGET_LIMITS.maxKeyConceptExplanationChars),
        evidenceChunkIds: z
          .array(z.string().uuid())
          .min(1)
          .max(STUDY_PACK_BUDGET_LIMITS.maxCitationsPerItem),
      })
    )
    .min(1)
    .max(STUDY_PACK_BUDGET_LIMITS.maxKeyConcepts),
  highYieldPoints: z
    .array(
      z.object({
        point: z
          .string()
          .trim()
          .min(5)
          .max(STUDY_PACK_BUDGET_LIMITS.maxHighYieldPointChars),
        evidenceChunkIds: z
          .array(z.string().uuid())
          .min(1)
          .max(STUDY_PACK_BUDGET_LIMITS.maxCitationsPerItem),
      })
    )
    .min(1)
    .max(STUDY_PACK_BUDGET_LIMITS.maxHighYieldPoints),
  keyTerms: z
    .array(
      z.object({
        term: z
          .string()
          .trim()
          .min(2)
          .max(STUDY_PACK_BUDGET_LIMITS.maxKeyTermChars),
        definition: z
          .string()
          .trim()
          .min(5)
          .max(STUDY_PACK_BUDGET_LIMITS.maxKeyTermDefinitionChars),
        evidenceChunkIds: z
          .array(z.string().uuid())
          .min(1)
          .max(STUDY_PACK_BUDGET_LIMITS.maxCitationsPerItem),
      })
    )
    .min(1)
    .max(STUDY_PACK_BUDGET_LIMITS.maxKeyTerms),
});

export type StudyPackCandidate = z.infer<typeof studyPackCandidateSchema>;

// Evidence Verification Schema (CALL 2)
export const studyPackVerificationSchema = z.object({
  evaluations: z
    .array(
      z.object({
        itemKey: z.string().min(1).max(100),
        verdict: z.enum(["SUPPORTED", "UNSUPPORTED"]),
        rationale: z
          .string()
          .max(STUDY_PACK_BUDGET_LIMITS.maxVerificationExplanationChars),
      })
    )
    .max(100),
});

export type StudyPackVerification = z.infer<typeof studyPackVerificationSchema>;

// Domain Entities
export interface StudyPackItemCitationView {
  chunkId: string;
  pageNumber: number;
}

export interface StudyPackItemView {
  id: string;
  itemType: StudyPackItemType;
  ordinal: number;
  payload: Record<string, unknown>;
  citations: StudyPackItemCitationView[];
}

export interface StudyPackView {
  id: string;
  documentId: string;
  status:
    "PENDING" | "GENERATING" | "READY" | "FAILED_RETRYABLE" | "FAILED_FINAL";
  errorCode: StudyPackErrorCode | null;
  chunkingVersion: string;
  generationVersion: string;
  promptVersion: string;
  sourcePageCount: number;
  evidencePageCount: number;
  sourceChunkCount: number;
  evidenceChunkCount: number;
  evidenceCharCount: number;
  items: StudyPackItemView[];
  createdAt: string;
}
