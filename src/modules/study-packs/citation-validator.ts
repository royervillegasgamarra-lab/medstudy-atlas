import type { StudyPackCandidate, StudyPackItemType } from "./types";
import { STUDY_PACK_BUDGET_LIMITS } from "@/config/study-pack-limits";

export interface SuppliedChunkInfo {
  id: string;
  document_id: string;
  user_id: string;
  page_number: number;
  content: string;
}

export interface NormalizedItemWithCitations {
  tempKey: string;
  itemType: StudyPackItemType;
  ordinal: number;
  textForVerification: string;
  payload: Record<string, unknown>;
  citedChunkIds: string[];
  derivedPageNumbers: number[];
}

export interface CitationValidationResult {
  valid: boolean;
  error?: string;
  items: NormalizedItemWithCitations[];
}

/**
 * Deterministically validates that all citations in candidate model output
 * refer exclusively to valid chunks provided in the active prompt evidence set,
 * that citation counts are within bounds, and derives page numbers server-side.
 */
export function validateStudyPackCitations(
  candidate: StudyPackCandidate,
  suppliedChunks: Map<string, SuppliedChunkInfo>
): CitationValidationResult {
  const normalizedItems: NormalizedItemWithCitations[] = [];
  const { minCitationsPerItem, maxCitationsPerItem } = STUDY_PACK_BUDGET_LIMITS;

  const validateCitations = (
    tempKey: string,
    itemType: StudyPackItemType,
    ordinal: number,
    textForVerification: string,
    payload: Record<string, unknown>,
    chunkIds: string[]
  ): string | null => {
    if (!chunkIds || chunkIds.length < minCitationsPerItem) {
      return `Item ${tempKey} must cite at least ${minCitationsPerItem} chunk(s).`;
    }
    if (chunkIds.length > maxCitationsPerItem) {
      return `Item ${tempKey} exceeds maximum ${maxCitationsPerItem} citations (got ${chunkIds.length}).`;
    }

    const uniqueChunkIds = Array.from(new Set(chunkIds));
    const derivedPages: number[] = [];

    for (const chunkId of uniqueChunkIds) {
      const chunk = suppliedChunks.get(chunkId);
      if (!chunk) {
        return `Item ${tempKey} cites invalid or unsupplied chunk ID: ${chunkId}`;
      }
      derivedPages.push(chunk.page_number);
    }

    normalizedItems.push({
      tempKey,
      itemType,
      ordinal,
      textForVerification,
      payload,
      citedChunkIds: uniqueChunkIds,
      derivedPageNumbers: derivedPages,
    });

    return null;
  };

  // 1. Summary Paragraphs
  for (let i = 0; i < candidate.summaryParagraphs.length; i++) {
    const item = candidate.summaryParagraphs[i];
    const err = validateCitations(
      `summary-${i}`,
      "SUMMARY",
      i,
      item.paragraph,
      { paragraph: item.paragraph },
      item.evidenceChunkIds
    );
    if (err) return { valid: false, error: err, items: [] };
  }

  // 2. Learning Objectives
  for (let i = 0; i < candidate.learningObjectives.length; i++) {
    const item = candidate.learningObjectives[i];
    const err = validateCitations(
      `obj-${i}`,
      "LEARNING_OBJECTIVE",
      i,
      item.objective,
      { objective: item.objective },
      item.evidenceChunkIds
    );
    if (err) return { valid: false, error: err, items: [] };
  }

  // 3. Key Concepts
  for (let i = 0; i < candidate.keyConcepts.length; i++) {
    const item = candidate.keyConcepts[i];
    const text = `${item.title}: ${item.explanation}`;
    const err = validateCitations(
      `concept-${i}`,
      "KEY_CONCEPT",
      i,
      text,
      { title: item.title, explanation: item.explanation },
      item.evidenceChunkIds
    );
    if (err) return { valid: false, error: err, items: [] };
  }

  // 4. High-Yield Points
  for (let i = 0; i < candidate.highYieldPoints.length; i++) {
    const item = candidate.highYieldPoints[i];
    const err = validateCitations(
      `hy-${i}`,
      "HIGH_YIELD_POINT",
      i,
      item.point,
      { point: item.point },
      item.evidenceChunkIds
    );
    if (err) return { valid: false, error: err, items: [] };
  }

  // 5. Key Terms
  for (let i = 0; i < candidate.keyTerms.length; i++) {
    const item = candidate.keyTerms[i];
    const text = `${item.term}: ${item.definition}`;
    const err = validateCitations(
      `term-${i}`,
      "KEY_TERM",
      i,
      text,
      { term: item.term, definition: item.definition },
      item.evidenceChunkIds
    );
    if (err) return { valid: false, error: err, items: [] };
  }

  return { valid: true, items: normalizedItems };
}
