import { z } from "zod";

/**
 * Error codes that the Python parser subprocess is permitted to emit in manifest.json.
 */
export const PARSER_REPORTED_ERROR_CODES = [
  "PDF_ENCRYPTED",
  "PDF_CORRUPT",
  "PDF_ZERO_PAGES",
  "PDF_PAGE_COUNT_EXCEEDED",
  "PREFLIGHT_FAILED",
  "PREFLIGHT_TIMEOUT",
  "PAGE_DIMENSION_EXCEEDED",
  "PAGE_PIXEL_AREA_EXCEEDED",
  "PARSER_RESOURCE_LIMIT",
  "PARSER_INTERNAL_ERROR",
  "OCR_TIMEOUT",
  "OCR_UNAVAILABLE",
  "OCR_FAILED",
] as const;

export type ParserReportedErrorCode =
  (typeof PARSER_REPORTED_ERROR_CODES)[number];

/**
 * Complete set of processing error codes across parser, worker, storage, and database layers.
 */
export const PROCESSING_ERROR_CODES = [
  ...PARSER_REPORTED_ERROR_CODES,
  "SOURCE_MISSING",
  "STORAGE_UNAVAILABLE",
  "PARSER_TIMEOUT",
  "PARSER_OUTPUT_INVALID",
  "WORKER_INTERNAL_ERROR",
  "DOCUMENT_ARCHIVED",
] as const;

export type ProcessingErrorCode = (typeof PROCESSING_ERROR_CODES)[number];

export type ProcessingStatus =
  "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED_RETRYABLE" | "FAILED_FINAL";

export type PageClassification =
  "TEXT_BASED" | "SCANNED" | "MIXED" | "IMAGE_ONLY" | "NO_TEXT";

export type ExtractionMethod = "NATIVE" | "OCR" | "HYBRID" | "NONE";

/**
 * Trust boundary for all user-extracted content.
 */
export const TRUST_CLASSIFICATION = "USER_DOCUMENT_UNTRUSTED" as const;

/**
 * Zod schema for individual page result files (output/pages/0001.json).
 */
export const pageProcessingResultSchema = z.object({
  page_number: z.number().int().positive(),
  classification: z.enum([
    "TEXT_BASED",
    "SCANNED",
    "MIXED",
    "IMAGE_ONLY",
    "NO_TEXT",
  ]),
  extraction_method: z.enum(["NATIVE", "OCR", "HYBRID", "NONE"]),
  text_content: z.string().max(100_000),
  char_count: z.number().int().nonnegative(),
  native_char_count: z.number().int().nonnegative(),
  ocr_char_count: z.number().int().nonnegative(),
  ocr_confidence: z.number().min(0).max(100).nullable(),
  width_points: z.number().positive(),
  height_points: z.number().positive(),
  rotation_degrees: z.number().int(),
  text_sha256: z.string().length(64),
});

export type PageProcessingResult = z.infer<typeof pageProcessingResultSchema>;

/**
 * Zod schema for successful parser output manifest.
 */
export const processingSuccessManifestSchema = z.object({
  status: z.literal("SUCCEEDED"),
  pipeline_version: z.string(),
  source_sha256: z.string().length(64),
  page_count: z.number().int().positive().max(300),
  structural_warning_count: z.number().int().nonnegative(),
  native_text_page_count: z.number().int().nonnegative(),
  ocr_page_count: z.number().int().nonnegative(),
  no_text_page_count: z.number().int().nonnegative(),
  processing_duration_ms: z.number().int().nonnegative(),
  error_code: z.null().optional(),
});

/**
 * Zod schema for failed parser output manifest.
 * Allows page_count = 0 and requires a valid parser error_code.
 */
export const processingFailureManifestSchema = z.object({
  status: z.literal("FAILED"),
  pipeline_version: z.string().optional(),
  source_sha256: z.string().length(64).nullable().optional(),
  page_count: z.number().int().nonnegative().max(300).default(0),
  structural_warning_count: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .default(0),
  native_text_page_count: z.number().int().nonnegative().optional().default(0),
  ocr_page_count: z.number().int().nonnegative().optional().default(0),
  no_text_page_count: z.number().int().nonnegative().optional().default(0),
  processing_duration_ms: z.number().int().nonnegative().optional().default(0),
  error_code: z.enum(PARSER_REPORTED_ERROR_CODES),
});

/**
 * Zod schema for the parser output manifest (output/manifest.json).
 * Discriminated union on status ("SUCCEEDED" | "FAILED").
 */
export const processingManifestSchema = z.discriminatedUnion("status", [
  processingSuccessManifestSchema,
  processingFailureManifestSchema,
]);

export type ProcessingSuccessManifest = z.infer<
  typeof processingSuccessManifestSchema
>;
export type ProcessingFailureManifest = z.infer<
  typeof processingFailureManifestSchema
>;
export type ProcessingManifest = z.infer<typeof processingManifestSchema>;

export interface DocumentProcessingRunRecord {
  id: string;
  document_id: string;
  user_id: string;
  pipeline_version: string;
  status: ProcessingStatus;
  attempt_count: number;
  error_code: ProcessingErrorCode | null;
  page_count: number | null;
  native_text_page_count: number;
  ocr_page_count: number;
  no_text_page_count: number;
  source_sha256: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentPageRecord {
  id: string;
  processing_run_id: string;
  document_id: string;
  user_id: string;
  page_number: number;
  classification: PageClassification;
  extraction_method: ExtractionMethod;
  text_content: string;
  char_count: number;
  native_char_count: number;
  ocr_char_count: number;
  ocr_confidence: number | null;
  width_points: number;
  height_points: number;
  rotation_degrees: number;
  text_sha256: string;
  created_at: string;
}
