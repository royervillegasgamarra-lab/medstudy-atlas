import * as crypto from "crypto";
import {
  CHUNKING_VERSION,
  CHUNKING_LIMITS,
  type ChunkingLimits,
} from "@/config/study-pack-limits";

export interface PageForChunking {
  id: string; // document_page_id
  processing_run_id: string;
  document_id: string;
  user_id: string;
  page_number: number;
  text_content: string;
  classification?: string;
}

export interface CanonicalChunk {
  id?: string;
  document_page_id: string;
  processing_run_id: string;
  document_id: string;
  user_id: string;
  page_number: number;
  chunk_index: number;
  start_char: number;
  end_char: number;
  content: string;
  char_count: number;
  content_sha256: string;
  chunking_version: string;
}

export interface ChunkProvenanceValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates that a chunk's content matches the source page text exactly
 * at [start_char:end_char] using Unicode code-point slicing, and that
 * cryptographic hashes and character counts match.
 */
export function verifyChunkProvenance(
  page: PageForChunking,
  chunk: CanonicalChunk
): ChunkProvenanceValidationResult {
  if (chunk.document_page_id !== page.id) {
    return { valid: false, error: "document_page_id mismatch" };
  }
  if (chunk.processing_run_id !== page.processing_run_id) {
    return { valid: false, error: "processing_run_id mismatch" };
  }
  if (chunk.document_id !== page.document_id) {
    return { valid: false, error: "document_id mismatch" };
  }
  if (chunk.user_id !== page.user_id) {
    return { valid: false, error: "user_id mismatch" };
  }
  if (chunk.page_number !== page.page_number) {
    return { valid: false, error: "page_number mismatch" };
  }

  const codePoints = Array.from(page.text_content);
  if (
    chunk.start_char < 0 ||
    chunk.end_char > codePoints.length ||
    chunk.start_char >= chunk.end_char
  ) {
    return { valid: false, error: "start_char/end_char out of bounds" };
  }

  const expectedContent = codePoints
    .slice(chunk.start_char, chunk.end_char)
    .join("");
  if (chunk.content !== expectedContent) {
    return {
      valid: false,
      error: "content does not match page slice at [start_char:end_char]",
    };
  }

  const expectedCharCount = codePoints.slice(
    chunk.start_char,
    chunk.end_char
  ).length;
  if (chunk.char_count !== expectedCharCount) {
    return { valid: false, error: "char_count mismatch" };
  }

  const expectedSha256 = crypto
    .createHash("sha256")
    .update(chunk.content, "utf8")
    .digest("hex");
  if (chunk.content_sha256 !== expectedSha256) {
    return { valid: false, error: "content_sha256 mismatch" };
  }

  return { valid: true };
}

/**
 * Deterministically splits a single page into canonical chunks.
 * Strictly respects page boundaries (chunks never cross pages).
 * Preserves paragraph boundaries where practical and splits oversized blocks near whitespace.
 */
export function chunkPage(
  page: PageForChunking,
  limits: ChunkingLimits = CHUNKING_LIMITS
): CanonicalChunk[] {
  const codePoints = Array.from(page.text_content);
  const totalChars = codePoints.length;

  // Blank or empty page (e.g. NO_TEXT) produces 0 chunks
  if (totalChars === 0 || page.text_content.trim().length === 0) {
    return [];
  }

  // Short page fitting within max chunk size produces exactly 1 chunk
  if (totalChars <= limits.maxChunkChars) {
    const content = page.text_content;
    const sha = crypto
      .createHash("sha256")
      .update(content, "utf8")
      .digest("hex");
    return [
      {
        document_page_id: page.id,
        processing_run_id: page.processing_run_id,
        document_id: page.document_id,
        user_id: page.user_id,
        page_number: page.page_number,
        chunk_index: 0,
        start_char: 0,
        end_char: totalChars,
        content,
        char_count: totalChars,
        content_sha256: sha,
        chunking_version: CHUNKING_VERSION,
      },
    ];
  }

  const chunks: CanonicalChunk[] = [];
  let currentStart = 0;
  let chunkIndex = 0;

  while (currentStart < totalChars) {
    const remainingChars = totalChars - currentStart;

    // If remaining text is within maxChunkChars, take all of it to avoid tiny trailing chunk
    if (remainingChars <= limits.maxChunkChars) {
      const endChar = totalChars;
      const content = codePoints.slice(currentStart, endChar).join("");
      const sha = crypto
        .createHash("sha256")
        .update(content, "utf8")
        .digest("hex");
      chunks.push({
        document_page_id: page.id,
        processing_run_id: page.processing_run_id,
        document_id: page.document_id,
        user_id: page.user_id,
        page_number: page.page_number,
        chunk_index: chunkIndex++,
        start_char: currentStart,
        end_char: endChar,
        content,
        char_count: endChar - currentStart,
        content_sha256: sha,
        chunking_version: CHUNKING_VERSION,
      });
      break;
    }

    // Target slice boundary
    let targetEnd = currentStart + limits.targetChunkChars;
    if (targetEnd > totalChars) {
      targetEnd = totalChars;
    }

    // Try finding a paragraph break (\n\n or \n) between minChunkChars and maxChunkChars
    const searchStart = currentStart + limits.minChunkChars;
    const searchEnd = Math.min(totalChars, currentStart + limits.maxChunkChars);
    const searchWindow = codePoints.slice(searchStart, searchEnd).join("");

    // Look for double newline first (paragraph break)
    const doubleNewlineIdx = searchWindow.lastIndexOf("\n\n");
    let chosenEnd = targetEnd;

    if (doubleNewlineIdx !== -1) {
      // Split after the double newline
      chosenEnd = searchStart + doubleNewlineIdx + 2;
    } else {
      // Look for single newline
      const singleNewlineIdx = searchWindow.lastIndexOf("\n");
      if (singleNewlineIdx !== -1) {
        chosenEnd = searchStart + singleNewlineIdx + 1;
      } else {
        // Look for sentence end (. or ? or !) or whitespace
        const whitespaceIdx = searchWindow.lastIndexOf(" ");
        if (whitespaceIdx !== -1) {
          chosenEnd = searchStart + whitespaceIdx + 1;
        } else {
          // Hard split at maxChunkChars if no whitespace exists
          chosenEnd = searchEnd;
        }
      }
    }

    // Ensure forward progress of at least minChunkChars
    if (chosenEnd <= currentStart) {
      chosenEnd = Math.min(totalChars, currentStart + limits.targetChunkChars);
    }

    const content = codePoints.slice(currentStart, chosenEnd).join("");
    const sha = crypto
      .createHash("sha256")
      .update(content, "utf8")
      .digest("hex");

    chunks.push({
      document_page_id: page.id,
      processing_run_id: page.processing_run_id,
      document_id: page.document_id,
      user_id: page.user_id,
      page_number: page.page_number,
      chunk_index: chunkIndex++,
      start_char: currentStart,
      end_char: chosenEnd,
      content,
      char_count: chosenEnd - currentStart,
      content_sha256: sha,
      chunking_version: CHUNKING_VERSION,
    });

    // Advance start position with overlap, ensuring forward progress
    const nextStartCandidate = chosenEnd - limits.overlapChars;
    if (nextStartCandidate > currentStart && nextStartCandidate < totalChars) {
      currentStart = nextStartCandidate;
    } else {
      currentStart = chosenEnd;
    }
  }

  return chunks;
}

/**
 * Deterministically chunks an array of pages.
 * Enforces that no chunks cross page boundaries.
 */
export function chunkDocumentPages(
  pages: PageForChunking[],
  limits: ChunkingLimits = CHUNKING_LIMITS
): CanonicalChunk[] {
  const allChunks: CanonicalChunk[] = [];

  for (const page of pages) {
    const pageChunks = chunkPage(page, limits);
    for (const chunk of pageChunks) {
      allChunks.push(chunk);
    }
  }

  return allChunks;
}
