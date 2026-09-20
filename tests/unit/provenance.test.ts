import { describe, it, expect } from "vitest";
import * as crypto from "crypto";
import {
  verifyParserProvenance,
  type WorkerJobClaim,
} from "@/workers/documents-worker";
import type {
  ProcessingManifest,
  PageProcessingResult,
} from "@/modules/documents/processing-types";

describe("Trusted Node Orchestrator Semantic Provenance Verification (Unit)", () => {
  const mockJob: WorkerJobClaim = {
    run_id: "00000000-0000-0000-0000-000000000001",
    document_id: "00000000-0000-0000-0000-000000000002",
    user_id: "00000000-0000-0000-0000-000000000003",
    pipeline_version: "1.0.0",
    attempt_count: 1,
    claim_token: "00000000-0000-0000-0000-000000000004",
    storage_bucket: "documents",
    storage_key: "mock/source.pdf",
    size_bytes: 1024,
    original_filename: "test.pdf",
  };

  const trueSourceSha = "correct_source_sha256_hash";
  const validPageText = "Valid medical content text for page 1";
  const validTextSha = crypto
    .createHash("sha256")
    .update(validPageText, "utf8")
    .digest("hex");

  const validManifest: ProcessingManifest = {
    pipeline_version: "1.0.0",
    source_sha256: trueSourceSha,
    page_count: 1,
    structural_warning_count: 0,
    native_text_page_count: 1,
    ocr_page_count: 0,
    no_text_page_count: 0,
    processing_duration_ms: 100,
    status: "SUCCEEDED",
  };

  const validPage: PageProcessingResult = {
    page_number: 1,
    classification: "TEXT_BASED",
    extraction_method: "NATIVE",
    text_content: validPageText,
    char_count: [...validPageText].length,
    native_char_count: [...validPageText].length,
    ocr_char_count: 0,
    ocr_confidence: null,
    width_points: 612,
    height_points: 792,
    rotation_degrees: 0,
    text_sha256: validTextSha,
  };

  it("passes when all provenance invariants are satisfied", () => {
    const res = verifyParserProvenance({
      job: mockJob,
      sourceSha256: trueSourceSha,
      manifest: validManifest,
      pages: [validPage],
    });
    expect(res.valid).toBe(true);
    expect(res.error).toBeUndefined();
  });

  it("rejects forged source_sha256", () => {
    const res = verifyParserProvenance({
      job: mockJob,
      sourceSha256: trueSourceSha,
      manifest: {
        ...validManifest,
        source_sha256: "forged_source_sha256",
      },
      pages: [validPage],
    });
    expect(res.valid).toBe(false);
    expect(res.error).toContain("Source SHA-256 mismatch");
  });

  it("rejects forged text_sha256 on a page", () => {
    const res = verifyParserProvenance({
      job: mockJob,
      sourceSha256: trueSourceSha,
      manifest: validManifest,
      pages: [
        {
          ...validPage,
          text_sha256: "forged_page_text_sha256",
        },
      ],
    });
    expect(res.valid).toBe(false);
    expect(res.error).toContain("Text SHA-256 mismatch");
  });

  it("rejects forged character count", () => {
    const res = verifyParserProvenance({
      job: mockJob,
      sourceSha256: trueSourceSha,
      manifest: validManifest,
      pages: [
        {
          ...validPage,
          char_count: 9999, // Mismatch with actual character count
        },
      ],
    });
    expect(res.valid).toBe(false);
    expect(res.error).toContain("Character count mismatch");
  });

  it("counts Unicode surrogate pairs deterministically matching Python len()", () => {
    const emojiText = "Hospital 🏥 Cardiología 🩺";
    // In JavaScript string.length, each surrogate pair counts as 2, but [...emojiText].length counts as 1
    const unicodeLength = [...emojiText].length;
    const textSha = crypto
      .createHash("sha256")
      .update(emojiText, "utf8")
      .digest("hex");

    const emojiPage: PageProcessingResult = {
      ...validPage,
      text_content: emojiText,
      char_count: unicodeLength,
      native_char_count: unicodeLength,
      text_sha256: textSha,
    };

    const res = verifyParserProvenance({
      job: mockJob,
      sourceSha256: trueSourceSha,
      manifest: validManifest,
      pages: [emojiPage],
    });
    expect(res.valid).toBe(true);
  });

  it("rejects forged aggregate counters", () => {
    const res = verifyParserProvenance({
      job: mockJob,
      sourceSha256: trueSourceSha,
      manifest: {
        ...validManifest,
        native_text_page_count: 0, // In reality 1
        ocr_page_count: 1, // In reality 0
      },
      pages: [validPage],
    });
    expect(res.valid).toBe(false);
    expect(res.error).toContain("Aggregate page counters mismatch");
  });

  it("rejects forged pipeline_version", () => {
    const res = verifyParserProvenance({
      job: mockJob,
      sourceSha256: trueSourceSha,
      manifest: {
        ...validManifest,
        pipeline_version: "2.0.0-unauthorized",
      },
      pages: [validPage],
    });
    expect(res.valid).toBe(false);
    expect(res.error).toContain("Pipeline version mismatch");
  });

  it("rejects impossible classification and extraction method combinations", () => {
    const impossiblePage: PageProcessingResult = {
      ...validPage,
      classification: "TEXT_BASED",
      extraction_method: "OCR", // Invalid combo: TEXT_BASED must be NATIVE
    };

    const res = verifyParserProvenance({
      job: mockJob,
      sourceSha256: trueSourceSha,
      manifest: validManifest,
      pages: [impossiblePage],
    });
    expect(res.valid).toBe(false);
    expect(res.error).toContain("Impossible classification/method combo");
  });
});
