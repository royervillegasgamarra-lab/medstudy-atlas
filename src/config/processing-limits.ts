/**
 * Centralized resource budgets and operational limits for document processing.
 * Phase 1D: Secure Document Processing / Ingestion & Page Provenance.
 */

export const PROCESSING_LIMITS = {
  /** Maximum number of pages permitted in a single document */
  maxPagesPerDocument: 300,

  /** Maximum number of pages permitted to undergo OCR per document */
  maxOcrPagesPerDocument: 60,

  /** Maximum character count allowed from a single page */
  maxExtractedCharsPerPage: 100_000,

  /** Maximum total extracted character count for the entire document */
  maxExtractedCharsPerDocument: 3_000_000,

  /** Maximum rasterization pixel count for OCR rendering (e.g. ~3000x4000) */
  maxRenderPixelsPerPage: 12_000_000,

  /** Maximum seconds allowed for qpdf structural preflight */
  preflightTimeoutSeconds: 10,

  /** Maximum seconds allowed for native page extraction */
  nativePageExtractionTimeoutSeconds: 5,

  /** Maximum seconds allowed for a single page OCR execution */
  ocrPageTimeoutSeconds: 20,

  /** Maximum total seconds allowed for the complete document processing job */
  totalJobTimeoutSeconds: 600,

  /** Maximum processing retries before moving to FAILED_FINAL */
  maxRetries: 3,

  /** Minimum usable native characters required to classify as TEXT_BASED without OCR */
  minNativeCharsForText: 50,

  /** Canonical processing pipeline version */
  pipelineVersion: "1.0.0",

  /** Worker claim lease duration in seconds */
  workerLeaseSeconds: 300,
} as const;
