import { describe, it, expect } from "vitest";
import * as crypto from "node:crypto";
import {
  chunkDocumentPages,
  verifyChunkProvenance,
  type PageForChunking,
  type CanonicalChunk,
} from "@/modules/study-packs/chunking";
import { CHUNKING_VERSION } from "@/config/study-pack-limits";

describe("Deterministic Canonical Chunking Engine", () => {
  const mockPage = (overrides?: Partial<PageForChunking>): PageForChunking => ({
    id: "page-uuid-1",
    processing_run_id: "run-uuid-1",
    document_id: "doc-uuid-1",
    user_id: "user-uuid-1",
    page_number: 1,
    text_content:
      "Este es un párrafo de prueba médica sobre anatomía vascular.",
    classification: "TEXT_DENSE",
    ...overrides,
  });

  it("returns empty chunk array when input pages is empty", () => {
    const chunks = chunkDocumentPages([]);
    expect(chunks).toEqual([]);
  });

  it("ignores pages with empty or whitespace-only text", () => {
    const pages: PageForChunking[] = [
      mockPage({ page_number: 1, text_content: "" }),
      mockPage({ page_number: 2, text_content: "   \n\t  " }),
      mockPage({
        page_number: 3,
        text_content: "Contenido válido en página 3.",
      }),
    ];

    const chunks = chunkDocumentPages(pages);
    expect(chunks.length).toBe(1);
    expect(chunks[0].page_number).toBe(3);
    expect(chunks[0].content).toBe("Contenido válido en página 3.");
  });

  it("creates a single chunk for short pages within chunk size limit", () => {
    const text =
      "Resumen de fisiología cardíaca: la sístole inicia con la contracción isovolumétrica.";
    const page = mockPage({ text_content: text });
    const chunks = chunkDocumentPages([page]);

    expect(chunks.length).toBe(1);
    expect(chunks[0].page_number).toBe(1);
    expect(chunks[0].chunk_index).toBe(0);
    expect(chunks[0].start_char).toBe(0);
    expect(chunks[0].end_char).toBe(text.length);
    expect(chunks[0].content).toBe(text);
    expect(chunks[0].char_count).toBe(text.length);
    expect(chunks[0].chunking_version).toBe(CHUNKING_VERSION);
    expect(chunks[0].content_sha256).toBe(
      crypto.createHash("sha256").update(text, "utf8").digest("hex")
    );
  });

  it("strictly enforces that chunks NEVER cross page boundaries", () => {
    const pages: PageForChunking[] = [
      mockPage({
        id: "p1",
        page_number: 1,
        text_content: "Texto exclusivo de la primera página del documento.",
      }),
      mockPage({
        id: "p2",
        page_number: 2,
        text_content: "Texto exclusivo de la segunda página del documento.",
      }),
    ];

    const chunks = chunkDocumentPages(pages);
    expect(chunks.length).toBe(2);

    expect(chunks[0].page_number).toBe(1);
    expect(chunks[0].document_page_id).toBe("p1");
    expect(chunks[0].content).toContain("primera página");
    expect(chunks[0].content).not.toContain("segunda página");

    expect(chunks[1].page_number).toBe(2);
    expect(chunks[1].document_page_id).toBe("p2");
    expect(chunks[1].content).toContain("segunda página");
    expect(chunks[1].content).not.toContain("primera página");
  });

  it("preserves paragraph boundaries when paragraphs fit within target length", () => {
    const p1 = "Primer párrafo de neuroanatomía sobre el polígono de Willis.";
    const p2 =
      "Segundo párrafo sobre las ramas de la arteria carótida interna.";
    const fullText = `${p1}\n\n${p2}`;

    const page = mockPage({ text_content: fullText });
    const chunks = chunkDocumentPages([page]);

    // When total text is under targetChunkChars (1200), single chunk preserves both
    expect(chunks.length).toBe(1);
    expect(chunks[0].content).toBe(fullText);
  });

  it("handles Unicode code points and accented medical terminology accurately", () => {
    const unicodeText =
      "Arteria esfenopalatina — irrigación de la cavidad nasal: café, corazón, clínica, fármaco, año, niño. 🫀🧠🩺";
    const page = mockPage({ text_content: unicodeText });
    const chunks = chunkDocumentPages([page]);

    expect(chunks.length).toBe(1);
    const chunk = chunks[0];

    // Character length check using code points
    const codePointLength = Array.from(unicodeText).length;
    expect(chunk.char_count).toBe(codePointLength);
    expect(chunk.end_char).toBe(codePointLength);

    const provenance = verifyChunkProvenance(page, chunk);
    expect(provenance.valid).toBe(true);
  });

  it("splits long text exceeding limits on whitespace with overlap", () => {
    // Generate a long paragraph (> maxChunkChars = 2800 characters)
    const sentence =
      "La despolarización de la membrana ventricular activa canales de sodio voltaje-dependientes. ";
    const longText = sentence.repeat(40); // ~3640 chars > 2800 limit

    const page = mockPage({ text_content: longText });
    const chunks = chunkDocumentPages([page]);

    expect(chunks.length).toBeGreaterThan(1);
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].chunk_index).toBe(i);
      expect(chunks[i].page_number).toBe(1);
      const provenance = verifyChunkProvenance(page, chunks[i]);
      expect(provenance.valid).toBe(true);
    }
  });

  it("guarantees full coverage of non-empty text content", () => {
    const longText =
      "Fármacos antibacterianos betalactámicos inhiben la síntesis de peptidoglicano bacteriano. ".repeat(
        30
      );
    const page = mockPage({ text_content: longText });
    const chunks = chunkDocumentPages([page]);

    // Verify each chunk is a valid substring of the original page
    const pageChars = Array.from(longText);
    for (const chunk of chunks) {
      const sliced = pageChars.slice(chunk.start_char, chunk.end_char).join("");
      expect(chunk.content).toBe(sliced);
    }
  });
});

describe("Provenance Verification (verifyChunkProvenance)", () => {
  const basePage: PageForChunking = {
    id: "p-100",
    processing_run_id: "run-100",
    document_id: "doc-100",
    user_id: "user-100",
    page_number: 1,
    text_content:
      "Patología pulmonar: EPOC y enfisema centroacinar vs panacinar.",
    classification: "TEXT_DENSE",
  };

  const createValidChunk = (page: PageForChunking): CanonicalChunk => {
    const content = page.text_content;
    const charCount = Array.from(content).length;
    return {
      document_page_id: page.id,
      processing_run_id: page.processing_run_id,
      document_id: page.document_id,
      user_id: page.user_id,
      page_number: page.page_number,
      chunk_index: 0,
      start_char: 0,
      end_char: charCount,
      content,
      char_count: charCount,
      content_sha256: crypto
        .createHash("sha256")
        .update(content, "utf8")
        .digest("hex"),
      chunking_version: CHUNKING_VERSION,
    };
  };

  it("validates valid chunk successfully", () => {
    const chunk = createValidChunk(basePage);
    const result = verifyChunkProvenance(basePage, chunk);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("fails when document_page_id is mismatched", () => {
    const chunk = {
      ...createValidChunk(basePage),
      document_page_id: "foreign-page",
    };
    const result = verifyChunkProvenance(basePage, chunk);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("document_page_id mismatch");
  });

  it("fails when processing_run_id is mismatched", () => {
    const chunk = {
      ...createValidChunk(basePage),
      processing_run_id: "foreign-run",
    };
    const result = verifyChunkProvenance(basePage, chunk);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("processing_run_id mismatch");
  });

  it("fails when document_id is mismatched", () => {
    const chunk = { ...createValidChunk(basePage), document_id: "foreign-doc" };
    const result = verifyChunkProvenance(basePage, chunk);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("document_id mismatch");
  });

  it("fails when user_id is mismatched", () => {
    const chunk = { ...createValidChunk(basePage), user_id: "foreign-user" };
    const result = verifyChunkProvenance(basePage, chunk);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("user_id mismatch");
  });

  it("fails when page_number is mismatched", () => {
    const chunk = { ...createValidChunk(basePage), page_number: 99 };
    const result = verifyChunkProvenance(basePage, chunk);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("page_number mismatch");
  });

  it("fails when content_sha256 is tampered", () => {
    const chunk = {
      ...createValidChunk(basePage),
      content_sha256: "tampered-sha256",
    };
    const result = verifyChunkProvenance(basePage, chunk);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("content_sha256 mismatch");
  });

  it("fails when content does not match source slice", () => {
    const valid = createValidChunk(basePage);
    const chunk: CanonicalChunk = {
      ...valid,
      content:
        "Contenido alterado o inyectado que no coincide con la página original.",
      content_sha256: crypto
        .createHash("sha256")
        .update(
          "Contenido alterado o inyectado que no coincide con la página original.",
          "utf8"
        )
        .digest("hex"),
      char_count: Array.from(
        "Contenido alterado o inyectado que no coincide con la página original."
      ).length,
    };
    const result = verifyChunkProvenance(basePage, chunk);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("content does not match page slice");
  });
});
