/**
 * Foundational domain types aligned with the accepted architecture.
 * These define core contracts without premature implementation.
 */

export type DocumentStatus = "PENDING" | "PROCESSING" | "READY" | "FAILED";

export type PageClassification =
  "TEXT_BASED" | "SCANNED" | "IMAGE_BASED" | "MIXED";

export type QAStatus = "PENDING" | "PASSED" | "FAILED";

export type EvidenceState =
  "SUPPORTED" | "PARTIALLY_SUPPORTED" | "INSUFFICIENT_EVIDENCE";

export type MisconceptionType =
  | "KNOWLEDGE_GAP"
  | "MISREAD_QUESTION"
  | "CONFUSED_CONCEPTS"
  | "REASONING_ERROR";

export type SubscriptionTier = "FREE" | "PRO";

export type SubscriptionStatus = "ACTIVE" | "PAST_DUE" | "CANCELED" | "TRIAL";

export interface HealthCheckResponse {
  status: "ok";
  timestamp: string;
  version: string;
}
