import { describe, it, expect } from "vitest";
import {
  APP_CONFIG,
  BUSINESS_ASSUMPTIONS,
  UPLOAD_LIMITS,
  LEARNING_ASSUMPTIONS,
} from "@/config/app";

describe("Application Configuration & Configurable Assumptions", () => {
  it("defines standard application metadata", () => {
    expect(APP_CONFIG.name).toBe("MedStudy Atlas");
    expect(APP_CONFIG.tagline).toBe("Adaptive medical learning workspace");
    expect(APP_CONFIG.version).toBe("0.1.0");
    expect(APP_CONFIG.phase).toContain("Phase 1C");
  });

  it("maintains verified business assumptions", () => {
    expect(BUSINESS_ASSUMPTIONS.targetMonthlyPricePEN).toBe(10.0);
    expect(BUSINESS_ASSUMPTIONS.targetGrossMargin).toBe(0.7);
  });

  it("specifies safe upload limits and document quotas", () => {
    expect(UPLOAD_LIMITS.maxFileSizeBytes).toBe(25 * 1024 * 1024);
    expect(UPLOAD_LIMITS.maxActiveDocumentsPerUser).toBe(10);
    expect(UPLOAD_LIMITS.maxTotalDocumentBytesPerUser).toBe(100 * 1024 * 1024);
    expect(UPLOAD_LIMITS.maxPagesFree).toBe(40);
    expect(UPLOAD_LIMITS.maxPagesPro).toBe(100);
    expect(UPLOAD_LIMITS.allowedMimeTypes).toContain("application/pdf");
    expect(UPLOAD_LIMITS.signedUrlTtlSeconds).toBe(300);
    expect(UPLOAD_LIMITS.pdfMagicBytes).toBe("%PDF-");
  });

  it("specifies cognitive learning assumptions", () => {
    expect(LEARNING_ASSUMPTIONS.defaultDailyStudyMinutes).toBe(45);
    expect(LEARNING_ASSUMPTIONS.minDailyStudyMinutes).toBe(30);
    expect(LEARNING_ASSUMPTIONS.maxDailyStudyMinutes).toBe(60);
    expect(LEARNING_ASSUMPTIONS.defaultRetentionRate).toBe(0.9);
  });
});

describe("AI & Study Pack Worker Configuration Invariants", () => {
  it("enforces worker lease invariant against provider timeouts", async () => {
    const { STUDY_PACK_WORKER_LIMITS } =
      await import("@/config/study-pack-limits");
    // Lease duration must comfortably exceed 2 consecutive provider timeouts plus processing margin
    const minRequiredLease =
      STUDY_PACK_WORKER_LIMITS.providerTimeoutSeconds * 2 + 30;
    expect(STUDY_PACK_WORKER_LIMITS.workerLeaseSeconds).toBeGreaterThanOrEqual(
      minRequiredLease
    );
    expect(STUDY_PACK_WORKER_LIMITS.workerLeaseSeconds).toBeLessThanOrEqual(
      STUDY_PACK_WORKER_LIMITS.maxLeaseSeconds
    );
    expect(STUDY_PACK_WORKER_LIMITS.maxRetries).toBe(3);
  });

  it("safely parses AI_GENERATION_ENABLED without truthy coercion", async () => {
    const { parseAIGenerationEnabled } = await import("@/config/server-env");

    // Explicit true values
    expect(parseAIGenerationEnabled("true")).toBe(true);
    expect(parseAIGenerationEnabled(true)).toBe(true);

    // Explicit false / falsy defaults
    expect(parseAIGenerationEnabled("false")).toBe(false);
    expect(parseAIGenerationEnabled(false)).toBe(false);
    expect(parseAIGenerationEnabled("")).toBe(false);
    expect(parseAIGenerationEnabled(undefined)).toBe(false);
    expect(parseAIGenerationEnabled(null)).toBe(false);

    // Invalid non-boolean representations throw configuration error
    expect(() => parseAIGenerationEnabled("1")).toThrow(
      /Invalid AI_GENERATION_ENABLED value/
    );
    expect(() => parseAIGenerationEnabled("0")).toThrow(
      /Invalid AI_GENERATION_ENABLED value/
    );
    expect(() => parseAIGenerationEnabled("yes")).toThrow(
      /Invalid AI_GENERATION_ENABLED value/
    );
    expect(() => parseAIGenerationEnabled("no")).toThrow(
      /Invalid AI_GENERATION_ENABLED value/
    );
    expect(() => parseAIGenerationEnabled("TRUE")).toThrow(
      /Invalid AI_GENERATION_ENABLED value/
    );
  });
});
