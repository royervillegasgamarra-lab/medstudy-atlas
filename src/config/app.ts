/**
 * Centralized application metadata and architectural configurable assumptions.
 * Avoids scattered magic numbers across the codebase.
 */

export const APP_CONFIG = {
  name: "MedStudy Atlas",
  tagline: "Adaptive medical learning workspace",
  phase: "Phase 1B — Onboarding, Curriculum & Exam Targets",
  version: "0.1.0",
  description:
    "Commercial, adaptive medical-learning SaaS platform for medical students in Peru and Latin America.",
} as const;

export const BUSINESS_ASSUMPTIONS = {
  /** Target monthly subscription price in Peruvian Soles (PEN) */
  targetMonthlyPricePEN: 10.0,
  /** Target gross margin threshold */
  targetGrossMargin: 0.7,
} as const;

export const UPLOAD_LIMITS = {
  /** Maximum file size in bytes for uploaded study PDFs (25 MB) */
  maxFileSizeBytes: 25 * 1024 * 1024,
  /** Maximum page count for Free tier */
  maxPagesFree: 40,
  /** Maximum page count for PRO tier */
  maxPagesPro: 100,
  /** Supported document MIME types */
  allowedMimeTypes: ["application/pdf"] as const,
} as const;

export const LEARNING_ASSUMPTIONS = {
  /** Target daily study time in minutes for the 'Today' engine */
  defaultDailyStudyMinutes: 45,
  /** Minimum daily plan duration */
  minDailyStudyMinutes: 30,
  /** Maximum daily plan duration */
  maxDailyStudyMinutes: 60,
  /** Default retention target for FSRS spaced repetition */
  defaultRetentionRate: 0.9,
} as const;
