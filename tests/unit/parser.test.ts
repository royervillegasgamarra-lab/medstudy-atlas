import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs/promises";
import * as fsSync from "node:fs";
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
import { PROCESSING_LIMITS } from "@/config/processing-limits";

describe("Document Parser Subprocess & Schemas", () => {
  const pythonExe = resolvePythonExecutable();
  const parserScript = path.resolve(
    process.cwd(),
    "src/parsers/document_parser.py"
  );
  const qpdfExe = resolveQpdfExecutable();
  const tesseractExe = resolveTesseractExecutable();
  const fixturesDir = path.resolve(process.cwd(), "tests/fixtures/documents");

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
        source_sha256:
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
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
        source_sha256:
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
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
        text_sha256:
          "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
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
        height_points: 100,
        rotation_degrees: 0,
        text_sha256: "invalid",
      };

      const parsed = pageProcessingResultSchema.safeParse(invalidPage);
      expect(parsed.success).toBe(false);
    });
  });

  describe("Parser CLI execution against test fixtures", () => {
    function runParser(
      fixtureName: string,
      testCaseName: string,
      extraConfig?: Record<string, unknown>
    ) {
      const inputPdf = path.join(fixturesDir, fixtureName);
      const outDir = path.join(testTempDir, `out-${testCaseName}`);
      const tempOcrDir = path.join(testTempDir, `temp-${testCaseName}`);

      const args = [
        parserScript,
        "--input",
        inputPdf,
        "--output",
        outDir,
        "--temp",
        tempOcrDir,
        "--source-sha256",
        "mock-sha-256",
        "--config",
        JSON.stringify({ ...PROCESSING_LIMITS, ...extraConfig }),
      ];

      if (qpdfExe) {
        args.push("--qpdf-path", qpdfExe);
      }
      if (tesseractExe) {
        args.push("--tesseract-path", tesseractExe);
      }

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
      expect(manifest.native_text_page_count).toBe(2);
      expect(manifest.ocr_page_count).toBe(0);

      const page1Raw = await fs.readFile(
        path.join(outDir, "pages", "0001.json"),
        "utf-8"
      );
      const page1: PageProcessingResult = JSON.parse(page1Raw);
      expect(page1.page_number).toBe(1);
      expect(page1.classification).toBe("TEXT_BASED");
      expect(page1.extraction_method).toBe("NATIVE");
      expect(page1.text_content).toContain("Cardiologia");
      expect(page1.char_count).toBeGreaterThan(30);
      expect(page1.text_sha256).toBeDefined();
    });

    it("applies Tesseract OCR on scanned_image.pdf in Spanish", async () => {
      const { exitCode, outDir } = runParser(
        "scanned_image.pdf",
        "scanned-image"
      );
      expect(exitCode).toBe(0);

      const manifestRaw = await fs.readFile(
        path.join(outDir, "manifest.json"),
        "utf-8"
      );
      const manifest: ProcessingManifest = JSON.parse(manifestRaw);
      expect(manifest.status).toBe("SUCCEEDED");
      expect(manifest.page_count).toBe(1);
      expect(manifest.ocr_page_count).toBe(1);
      expect(manifest.native_text_page_count).toBe(0);

      const page1: PageProcessingResult = JSON.parse(
        await fs.readFile(path.join(outDir, "pages", "0001.json"), "utf-8")
      );
      expect(page1.classification).toBe("SCANNED");
      expect(page1.extraction_method).toBe("OCR");
      expect(page1.ocr_confidence).toBeDefined();
      expect(page1.text_content).toContain("Paciente masculino");
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
      expect(manifest.no_text_page_count).toBe(1);
      expect(manifest.native_text_page_count).toBe(0);
      expect(manifest.ocr_page_count).toBe(0);

      const page1: PageProcessingResult = JSON.parse(
        await fs.readFile(path.join(outDir, "pages", "0001.json"), "utf-8")
      );
      expect(page1.classification).toBe("NO_TEXT");
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

    it("fails with PARSER_OUTPUT_INVALID when --config is missing", async () => {
      const inputPdf = path.join(fixturesDir, "valid_text.pdf");
      const outDir = path.join(testTempDir, "out-missing-config");
      const tempOcrDir = path.join(testTempDir, "temp-missing-config");

      const args = [
        parserScript,
        "--input",
        inputPdf,
        "--output",
        outDir,
        "--temp",
        tempOcrDir,
        "--source-sha256",
        "mock-sha-256",
      ];

      const safeEnv = createSafeParserEnvironment();
      const res = spawnSync(pythonExe, args, {
        env: safeEnv,
        encoding: "utf-8",
      });
      expect(res.status).not.toBe(0);

      const manifestRaw = await fs.readFile(
        path.join(outDir, "manifest.json"),
        "utf-8"
      );
      const manifest: ProcessingManifest = JSON.parse(manifestRaw);
      expect(manifest.status).toBe("FAILED");
      expect(manifest.error_code).toBe("PARSER_OUTPUT_INVALID");
    });

    it("fails with PARSER_OUTPUT_INVALID when given out-of-range configuration", async () => {
      const { exitCode, outDir } = runParser(
        "valid_text.pdf",
        "invalid-config",
        {
          maxPagesPerDocument: -5, // Invalid negative limit
        }
      );
      expect(exitCode).not.toBe(0);

      const manifestRaw = await fs.readFile(
        path.join(outDir, "manifest.json"),
        "utf-8"
      );
      const manifest: ProcessingManifest = JSON.parse(manifestRaw);
      expect(manifest.status).toBe("FAILED");
      expect(manifest.error_code).toBe("PARSER_OUTPUT_INVALID");
    });

    it("fails with TEXT_PAGE_LIMIT when page extracted text exceeds maxExtractedCharsPerPage", async () => {
      const { exitCode, outDir } = runParser(
        "valid_text.pdf",
        "page-text-limit",
        {
          maxExtractedCharsPerPage: 10,
        }
      );
      expect(exitCode).not.toBe(0);

      const manifestRaw = await fs.readFile(
        path.join(outDir, "manifest.json"),
        "utf-8"
      );
      const manifest: ProcessingManifest = JSON.parse(manifestRaw);
      expect(manifest.status).toBe("FAILED");
      expect(manifest.error_code).toBe("TEXT_PAGE_LIMIT");
    });

    it("fails with TEXT_DOCUMENT_LIMIT when total extracted text exceeds maxExtractedCharsPerDocument", async () => {
      const { exitCode, outDir } = runParser(
        "valid_text.pdf",
        "doc-text-limit",
        {
          maxExtractedCharsPerPage: 100_000,
          maxExtractedCharsPerDocument: 20,
        }
      );
      expect(exitCode).not.toBe(0);

      const manifestRaw = await fs.readFile(
        path.join(outDir, "manifest.json"),
        "utf-8"
      );
      const manifest: ProcessingManifest = JSON.parse(manifestRaw);
      expect(manifest.status).toBe("FAILED");
      expect(manifest.error_code).toBe("TEXT_DOCUMENT_LIMIT");
    });

    it("fails with PAGE_LIMIT_EXCEEDED when document exceeds maxPagesPerDocument", async () => {
      const { exitCode, outDir } = runParser(
        "valid_text.pdf",
        "page-count-limit",
        {
          maxPagesPerDocument: 1, // valid_text.pdf has 2 pages
        }
      );
      expect(exitCode).not.toBe(0);

      const manifestRaw = await fs.readFile(
        path.join(outDir, "manifest.json"),
        "utf-8"
      );
      const manifest: ProcessingManifest = JSON.parse(manifestRaw);
      expect(manifest.status).toBe("FAILED");
      expect(manifest.error_code).toBe("PAGE_LIMIT_EXCEEDED");
    });

    it("fails with OCR_PAGE_LIMIT when OCR budget maxOcrPagesPerDocument is exceeded", async () => {
      const { exitCode, outDir } = runParser(
        "scanned_image.pdf",
        "ocr-page-limit",
        {
          maxOcrPagesPerDocument: 0,
        }
      );
      expect(exitCode).not.toBe(0);

      const manifestRaw = await fs.readFile(
        path.join(outDir, "manifest.json"),
        "utf-8"
      );
      const manifest: ProcessingManifest = JSON.parse(manifestRaw);
      expect(manifest.status).toBe("FAILED");
      expect(manifest.error_code).toBe("OCR_PAGE_LIMIT");
    });

    it("classifies pytesseract RuntimeError timeout as OCR_TIMEOUT during DocumentParser.process()", () => {
      // Real production OCR timeout test: monkeypatch pytesseract.image_to_data during DocumentParser.process()
      const testPythonScript = `
import sys, json
from pathlib import Path
import pytesseract
from src.parsers.document_parser import DocumentParser

# Monkeypatch pytesseract.image_to_data to raise timeout RuntimeError
def mock_image_to_data(*args, **kwargs):
    raise RuntimeError("Tesseract process timeout")

pytesseract.image_to_data = mock_image_to_data

out_dir = Path(sys.argv[1])
temp_dir = out_dir / "temp"
config_json = sys.argv[2]
tesseract_exe = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] != "NONE" else None
qpdf_exe = sys.argv[4] if len(sys.argv) > 4 and sys.argv[4] != "NONE" else None

parser = DocumentParser(
    input_path=Path("tests/fixtures/documents/scanned_image.pdf"),
    output_dir=out_dir,
    temp_dir=temp_dir,
    qpdf_path=qpdf_exe,
    tesseract_path=tesseract_exe,
    source_sha256="mock-sha-256",
    config_json=config_json
)

exit_code = parser.process()
sys.exit(exit_code)
`;
      const outDir = path.join(testTempDir, "ocr-timeout-test");
      const safeEnv = createSafeParserEnvironment();
      const res = spawnSync(
        pythonExe,
        [
          "-c",
          testPythonScript,
          outDir,
          JSON.stringify(PROCESSING_LIMITS),
          tesseractExe || "NONE",
          qpdfExe || "NONE",
        ],
        {
          env: safeEnv,
          encoding: "utf-8",
        }
      );
      if (res.status === 0 && res.stderr) {
        console.error(res.stderr);
      }
      expect(res.status).not.toBe(0);

      const manifestRaw = fsSyncReadFile(path.join(outDir, "manifest.json"));
      const manifest = JSON.parse(manifestRaw);
      expect(manifest.error_code).toBe("OCR_TIMEOUT");
      expect(manifest.status).toBe("FAILED");
    });
  });
});

function fsSyncReadFile(filePath: string): string {
  return fsSync.readFileSync(filePath, "utf-8");
}
