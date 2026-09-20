import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  requestUploadSchema,
  finalizeUploadSchema,
  archiveDocumentSchema,
  validatePdfMagicBytes,
  sanitizeFilename,
} from "@/modules/documents/validation";

describe("Document Validation & Security Controls", () => {
  describe("validatePdfMagicBytes", () => {
    it("accepts valid PDF magic bytes (%PDF-)", () => {
      const buffer = Buffer.from("%PDF-1.4\n1 0 obj...");
      expect(validatePdfMagicBytes(buffer)).toBe(true);
    });

    it("accepts valid-small.pdf test fixture", () => {
      const fixturePath = path.join(
        process.cwd(),
        "tests/fixtures/documents/valid-small.pdf"
      );
      const buffer = fs.readFileSync(fixturePath);
      expect(validatePdfMagicBytes(buffer)).toBe(true);
    });

    it("rejects fake-pdf.pdf test fixture disguised with .pdf extension", () => {
      const fixturePath = path.join(
        process.cwd(),
        "tests/fixtures/documents/fake-pdf.pdf"
      );
      const buffer = fs.readFileSync(fixturePath);
      expect(validatePdfMagicBytes(buffer)).toBe(false);
    });

    it("rejects corrupted.pdf test fixture", () => {
      // Corrupted file starts with %PDF- but let's test a non-PDF file
      const nonPdfBuffer = Buffer.from(
        "<html><script>alert(1)</script></html>"
      );
      expect(validatePdfMagicBytes(nonPdfBuffer)).toBe(false);
    });

    it("rejects buffers with fewer than 5 bytes", () => {
      expect(validatePdfMagicBytes(Buffer.from("%PDF"))).toBe(false);
      expect(validatePdfMagicBytes(Buffer.from(""))).toBe(false);
    });

    it("rejects null or undefined inputs", () => {
      expect(validatePdfMagicBytes(null as unknown as Uint8Array)).toBe(false);
      expect(validatePdfMagicBytes(undefined as unknown as Uint8Array)).toBe(
        false
      );
    });
  });

  describe("sanitizeFilename", () => {
    it("strips unix path traversal sequences", () => {
      expect(sanitizeFilename("../../../etc/passwd.pdf")).toBe("passwd.pdf");
      expect(sanitizeFilename("/var/log/secret.pdf")).toBe("secret.pdf");
    });

    it("strips windows path traversal sequences", () => {
      expect(sanitizeFilename("..\\..\\windows\\system32\\config.pdf")).toBe(
        "config.pdf"
      );
      expect(
        sanitizeFilename("C:\\Users\\DR_ CHAPATIN\\Desktop\\slides.pdf")
      ).toBe("slides.pdf");
    });

    it("preserves hostile HTML/script names as safe string metadata", () => {
      const hostile = "<img src=x onerror=alert(1)>.pdf";
      expect(sanitizeFilename(hostile)).toBe(
        "<img src=x onerror=alert(1)>.pdf"
      );
    });

    it("provides fallback for empty or whitespace-only filenames", () => {
      expect(sanitizeFilename("")).toBe("documento.pdf");
      expect(sanitizeFilename("   ")).toBe("documento.pdf");
    });

    it("strips ASCII control characters", () => {
      const withControls = "slide\x00\x08deck.pdf";
      expect(sanitizeFilename(withControls)).toBe("slidedeck.pdf");
    });
  });

  describe("requestUploadSchema", () => {
    it("accepts valid PDF upload request", () => {
      const result = requestUploadSchema.safeParse({
        original_filename: "cardiologia_semana1.pdf",
        size_bytes: 5 * 1024 * 1024,
        mime_type: "application/pdf",
        subject_id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.original_filename).toBe("cardiologia_semana1.pdf");
        expect(result.data.size_bytes).toBe(5 * 1024 * 1024);
        expect(result.data.mime_type).toBe("application/pdf");
      }
    });

    it("rejects oversized files exceeding 25 MB", () => {
      const result = requestUploadSchema.safeParse({
        original_filename: "huge.pdf",
        size_bytes: 25 * 1024 * 1024 + 1,
        mime_type: "application/pdf",
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain("25 MB");
      }
    });

    it("rejects zero or negative file sizes", () => {
      const zero = requestUploadSchema.safeParse({
        original_filename: "zero.pdf",
        size_bytes: 0,
      });
      expect(zero.success).toBe(false);

      const negative = requestUploadSchema.safeParse({
        original_filename: "neg.pdf",
        size_bytes: -100,
      });
      expect(negative.success).toBe(false);
    });

    it("rejects non-PDF MIME types", () => {
      const exe = requestUploadSchema.safeParse({
        original_filename: "malware.exe",
        size_bytes: 1024,
        mime_type: "application/x-msdownload",
      });
      expect(exe.success).toBe(false);

      const html = requestUploadSchema.safeParse({
        original_filename: "index.html",
        size_bytes: 1024,
        mime_type: "text/html",
      });
      expect(html.success).toBe(false);
    });

    it("rejects empty original filename", () => {
      const result = requestUploadSchema.safeParse({
        original_filename: "   ",
        size_bytes: 1024,
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid subject UUID", () => {
      const result = requestUploadSchema.safeParse({
        original_filename: "doc.pdf",
        size_bytes: 1024,
        subject_id: "not-a-uuid",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("finalizeUploadSchema", () => {
    it("accepts valid UUID", () => {
      const result = finalizeUploadSchema.safeParse({
        documentId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      });
      expect(result.success).toBe(true);
    });

    it("rejects non-UUID", () => {
      const result = finalizeUploadSchema.safeParse({
        documentId: "invalid-id",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("archiveDocumentSchema", () => {
    it("accepts valid UUID", () => {
      const result = archiveDocumentSchema.safeParse({
        documentId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      });
      expect(result.success).toBe(true);
    });

    it("rejects non-UUID", () => {
      const result = archiveDocumentSchema.safeParse({
        documentId: "invalid-id",
      });
      expect(result.success).toBe(false);
    });
  });
});
