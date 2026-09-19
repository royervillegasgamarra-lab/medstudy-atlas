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
    expect(APP_CONFIG.phase).toContain("Phase 0C");
  });

  it("maintains verified business assumptions", () => {
    expect(BUSINESS_ASSUMPTIONS.targetMonthlyPricePEN).toBe(10.0);
    expect(BUSINESS_ASSUMPTIONS.targetGrossMargin).toBe(0.7);
  });

  it("specifies safe upload limits", () => {
    expect(UPLOAD_LIMITS.maxFileSizeBytes).toBe(25 * 1024 * 1024);
    expect(UPLOAD_LIMITS.maxPagesFree).toBe(40);
    expect(UPLOAD_LIMITS.maxPagesPro).toBe(100);
    expect(UPLOAD_LIMITS.allowedMimeTypes).toContain("application/pdf");
  });

  it("specifies cognitive learning assumptions", () => {
    expect(LEARNING_ASSUMPTIONS.defaultDailyStudyMinutes).toBe(45);
    expect(LEARNING_ASSUMPTIONS.minDailyStudyMinutes).toBe(30);
    expect(LEARNING_ASSUMPTIONS.maxDailyStudyMinutes).toBe(60);
    expect(LEARNING_ASSUMPTIONS.defaultRetentionRate).toBe(0.9);
  });
});
