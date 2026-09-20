import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs/promises";
import * as os from "os";
import {
  createSafeParserEnvironment,
  resolvePythonExecutable,
  resolveQpdfExecutable,
  resolveTesseractExecutable,
} from "@/workers/documents-worker";
import {
  processingManifestSchema,
  pageProcessingResultSchema,
  type ProcessingManifest,
  type PageProcessingResult,
} from "@/modules/documents/processing-types";

describe("Document Parser Subprocess & Schemas", () => {
  const pythonExe = resolvePythonExecutable();
  const parserScript = path.resolve(
    process.cwd(),
    "src/parsers/document_parser.py"
  );
  const qpdfExe = resolveQpdfExecutable();
  const tesseractExe = resolveTesseractExecutable();
  const fixturesDir = path.resolve(
    process.cwd(),
    "tests/fixtures/documents"
  );

  let testTempDir: string;

  beforeAll(async () => {
    testTempDir = path.join(os.tmpdir(), `parser-unit-test-${Date.now()}`);
    await fs.mkdir(testTempDir, { recursive: true });
  });

  afterAll(async () => {
    try {
      await fs.rm(testTempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe("createSafeParserEnvironment", () => {
    it("strips sensitive tokens, database URLs, and Supabase keys", () => {
      const originalEnv = { ...process.env };
      try {
        process.env.SUPABASE_SECRET_KEY = "sb_secret_super_confidential";
        process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_service_role_secret";
        process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db";
        process.env.OPENAI_API_KEY = "sk-secret-ai-token";
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key-12345";
        process.env.CUSTOM_SECRET_AUTH_TOKEN = "jwt-secret-xyz";

        const safeEnv = createSafeParserEnvironment();

        expect(safeEnv.SUPABASE_SECRET_KEY).toBeUndefined();
        expect(safeEnv.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
        expect(safeEnv.DATABASE_URL).toBeUndefined();
        expect(safeEnv.OPENAI_API_KEY).toBeUndefined();
        expect(safeEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBeUndefined();
        expect(safeEnv.CUSTOM_SECRET_AUTH_TOKEN).toBeUndefined();

        // Preserves necessary operating system variables
        expect(safeEnv.PATH).toBeDefined();
      } finally {
        process.env = originalEnv;
      }
    });
  });

  describe("Zod Manifest & Page Result Schemas", () => {
    it("validates compliant manifest object", () => {
      const validManifest: ProcessingManifest = {
        pipeline_version: "1.0.0",
        source_sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        page_count: 2,
        structural_warning_count: 0,
        native_text_page_count: 2,
        ocr_page_count: 0,
        no_text_page_count: 0,
        processing_duration_ms: 120,
        status: "SUCCEEDED",
      };

      const parsed = processingManifestSchema.safeParse(validManifest);
      expect(parsed.success).toBe(true);
    });

    it("rejects invalid status in manifest", () => {
      const invalidManifest = {
        pipeline_version: "1.0.0",
        source_sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        page_count: 1,
        structural_warning_count: 0,
        native_text_page_count: 1,
        ocr_page_count: 0,
        no_text_page_count: 0,
        processing_duration_ms: 50,
        status: "UNKNOWN_STATUS",
      };

      const parsed = processingManifestSchema.safeParse(invalidManifest);
      expect(parsed.success).toBe(false);
    });

    it("validates compliant page processing result", () => {
      const validPage: PageProcessingResult = {
        page_number: 1,
        classification: "TEXT_BASED",
        extraction_method: "NATIVE",
        text_content: "Cardiologia Clinica",
        char_count: 19,
        native_char_count: 19,
        ocr_char_count: 0,
        ocr_confidence: null,
        width_points: 612,
        height_points: 792,
        rotation_degrees: 0,
        text_sha256: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
      };

      const parsed = pageProcessingResultSchema.safeParse(validPage);
      expect(parsed.success).toBe(true);
    });

    it("rejects negative dimensions or character counts", () => {
      const invalidPage = {
        page_number: -1,
        classification: "TEXT_BASED",
        extraction_method: "NATIVE",
        text_content: "test",
        char_count: -10,
        native_char_count: 0,
        ocr_char_count: 0,
        ocr_confidence: null,
        width_points: -100,
        height_points: -200,
        rotation_degrees: 0,
        text_sha256: "abc",
      };

      const parsed = pageProcessingResultSchema.safeParse(invalidPage);
      expect(parsed.success).toBe(false);
    });
  });

  describe("Parser CLI execution against test fixtures", () => {
    function runParser(fixtureName: string, subDirName: string) {
      const inputPdf = path.join(fixturesDir, fixtureName);
      const outDir = path.join(testTempDir, subDirName, "out");
      const tmpDir = path.join(testTempDir, subDirName, "tmp");

      const args = [
        parserScript,
        "--input",
        inputPdf,
        "--output",
        outDir,
        "--temp",
        tmpDir,
      ];

      if (qpdfExe) args.push("--qpdf-path", qpdfExe);
      if (tesseractExe) args.push("--tesseract-path", tesseractExe);

      const safeEnv = createSafeParserEnvironment();
      const res = spawnSync(pythonExe, args, {
        env: safeEnv,
        encoding: "utf-8",
      });

      return {
        exitCode: res.status,
        stdout: res.stdout,
        stderr: res.stderr,
        outDir,
      };
    }

    it("extracts native text from valid_text.pdf", async () => {
      const { exitCode, outDir } = runParser("valid_text.pdf", "valid-text");
      expect(exitCode).toBe(0);

      const manifestRaw = await fs.readFile(
        path.join(outDir, "manifest.json"),
        "utf-8"
      );
      const manifest: ProcessingManifest = JSON.parse(manifestRaw);

      expect(manifest.status).toBe("SUCCEEDED");
      expect(manifest.page_count).toBe(2);
      expect(manifest.ocr_page_count).toBe(0);
      expect(manifest.native_text_page_count).toBe(2);

      // Page 1 check
      const page1Raw = await fs.readFile(
        path.join(outDir, "pages", "0001.json"),
        "utf-8"
      );
      const page1: PageProcessingResult = JSON.parse(page1Raw);
      expect(page1.page_number).toBe(1);
      expect(page1.extraction_method).toBe("NATIVE");
      expect(page1.text_content).toContain("Cardiologia: Insuficiencia Cardiaca");
      expect(page1.width_points).toBeCloseTo(612, 1);
      expect(page1.height_points).toBeCloseTo(792, 1);

      // Page 2 check
      const page2Raw = await fs.readFile(
        path.join(outDir, "pages", "0002.json"),
        "utf-8"
      );
      const page2: PageProcessingResult = JSON.parse(page2Raw);
      expect(page2.page_number).toBe(2);
      expect(page2.extraction_method).toBe("NATIVE");
      expect(page2.text_content).toContain("Tratamiento farmacologico");
    });

    it("applies Tesseract OCR on scanned_image.pdf in Spanish", async () => {
      const { exitCode, outDir } = runParser("scanned_image.pdf", "scanned-ocr");
      expect(exitCode).toBe(0);

      const manifestRaw = await fs.readFile(
        path.join(outDir, "manifest.json"),
        "utf-8"
      );
      const manifest: ProcessingManifest = JSON.parse(manifestRaw);

      expect(manifest.status).toBe("SUCCEEDED");
      expect(manifest.page_count).toBe(1);
      expect(manifest.ocr_page_count).toBe(1);

      const page1Raw = await fs.readFile(
        path.join(outDir, "pages", "0001.json"),
        "utf-8"
      );
      const page1: PageProcessingResult = JSON.parse(page1Raw);
      expect(page1.page_number).toBe(1);
      expect(page1.extraction_method).toBe("OCR");
      expect(page1.text_content.toLowerCase()).toMatch(/disnea|edema|paciente/);
    });

    it("handles mixed native text and scanned image in mixed_text_scanned.pdf", async () => {
      const { exitCode, outDir } = runParser(
        "mixed_text_scanned.pdf",
        "mixed-text"
      );
      expect(exitCode).toBe(0);

      const manifestRaw = await fs.readFile(
        path.join(outDir, "manifest.json"),
        "utf-8"
      );
      const manifest: ProcessingManifest = JSON.parse(manifestRaw);
      expect(manifest.page_count).toBe(2);
      expect(manifest.ocr_page_count).toBe(1);
      expect(manifest.native_text_page_count).toBe(1);

      const page1: PageProcessingResult = JSON.parse(
        await fs.readFile(path.join(outDir, "pages", "0001.json"), "utf-8")
      );
      expect(page1.extraction_method).toBe("NATIVE");

      const page2: PageProcessingResult = JSON.parse(
        await fs.readFile(path.join(outDir, "pages", "0002.json"), "utf-8")
      );
      expect(page2.extraction_method).toBe("OCR");
    });

    it("processes blank_page.pdf cleanly with empty text", async () => {
      const { exitCode, outDir } = runParser("blank_page.pdf", "blank-page");
      expect(exitCode).toBe(0);

      const manifest: ProcessingManifest = JSON.parse(
        await fs.readFile(path.join(outDir, "manifest.json"), "utf-8")
      );
      expect(manifest.status).toBe("SUCCEEDED");
      expect(manifest.page_count).toBe(1);

      const page1: PageProcessingResult = JSON.parse(
        await fs.readFile(path.join(outDir, "pages", "0001.json"), "utf-8")
      );
      expect(page1.text_content.trim()).toBe("");
      expect(page1.char_count).toBe(0);
    });

    it("treats prompt injection payloads as inert text without executing", async () => {
      const { exitCode, outDir } = runParser(
        "prompt_injection.pdf",
        "prompt-injection"
      );
      expect(exitCode).toBe(0);

      const page1: PageProcessingResult = JSON.parse(
        await fs.readFile(path.join(outDir, "pages", "0001.json"), "utf-8")
      );
      // Injection text is faithfully preserved as inert data
      expect(page1.text_content).toContain("IGNORE PREVIOUS INSTRUCTIONS");
      expect(page1.text_content).toContain("ADMIN_SECRET_XYZ");
    });

    it("fails cleanly on encrypted.pdf with PDF_ENCRYPTED code", async () => {
      const { exitCode, outDir } = runParser("encrypted.pdf", "encrypted-pdf");
      expect(exitCode).not.toBe(0);

      const manifestRaw = await fs.readFile(
        path.join(outDir, "manifest.json"),
        "utf-8"
      );
      const manifest: ProcessingManifest = JSON.parse(manifestRaw);
      expect(manifest.status).toBe("FAILED");
      expect(manifest.error_code).toBe("PDF_ENCRYPTED");
    });

    it("fails cleanly on corrupt.pdf with PDF_CORRUPT code", async () => {
      const { exitCode, outDir } = runParser("corrupt.pdf", "corrupt-pdf");
      expect(exitCode).not.toBe(0);

      const manifestRaw = await fs.readFile(
        path.join(outDir, "manifest.json"),
        "utf-8"
      );
      const manifest: ProcessingManifest = JSON.parse(manifestRaw);
      expect(manifest.status).toBe("FAILED");
      expect(manifest.error_code).toBe("PDF_CORRUPT");
    });

    it("fails on extreme_dimension.pdf with PAGE_RENDER_LIMIT", async () => {
      const { exitCode, outDir } = runParser(
        "extreme_dimension.pdf",
        "extreme-dim"
      );
      expect(exitCode).not.toBe(0);

      const manifestRaw = await fs.readFile(
        path.join(outDir, "manifest.json"),
        "utf-8"
      );
      const manifest: ProcessingManifest = JSON.parse(manifestRaw);
      expect(manifest.status).toBe("FAILED");
      expect(manifest.error_code).toBe("PAGE_RENDER_LIMIT");
    });
  });
});
