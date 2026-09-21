import { describe, it, expect } from "vitest";
import {
  validateStudyPackCitations,
  type SuppliedChunkInfo,
} from "@/modules/study-packs/citation-validator";
import type { StudyPackCandidate } from "@/modules/study-packs/types";

describe("Deterministic Citation Validator", () => {
  const chunk1Id = "11111111-1111-1111-1111-111111111111";
  const chunk2Id = "22222222-2222-2222-2222-222222222222";
  const chunk3Id = "33333333-3333-3333-3333-333333333333";

  const suppliedChunksMap = new Map<string, SuppliedChunkInfo>([
    [
      chunk1Id,
      {
        id: chunk1Id,
        document_id: "doc-1",
        user_id: "user-1",
        page_number: 1,
        content: "Texto del fragmento 1 correspondiente a la página 1.",
      },
    ],
    [
      chunk2Id,
      {
        id: chunk2Id,
        document_id: "doc-1",
        user_id: "user-1",
        page_number: 2,
        content: "Texto del fragmento 2 correspondiente a la página 2.",
      },
    ],
    [
      chunk3Id,
      {
        id: chunk3Id,
        document_id: "doc-1",
        user_id: "user-1",
        page_number: 3,
        content: "Texto del fragmento 3 correspondiente a la página 3.",
      },
    ],
  ]);

  const validCandidate: StudyPackCandidate = {
    summaryParagraphs: [
      {
        paragraph:
          "El ciclo cardíaco comprende fases de sístole y diástole ventriculares coordinadas.",
        evidenceChunkIds: [chunk1Id],
      },
    ],
    learningObjectives: [
      {
        objective:
          "Comprender los mecanismos de precarga y poscarga miocárdica.",
        evidenceChunkIds: [chunk2Id],
      },
    ],
    keyConcepts: [
      {
        title: "Ley de Frank-Starling",
        explanation:
          "La fuerza de contracción es directamente proporcional al volumen telediastólico.",
        evidenceChunkIds: [chunk1Id, chunk2Id],
      },
    ],
    highYieldPoints: [
      {
        point:
          "La perfusión coronaria del ventrículo izquierdo ocurre principalmente en diástole.",
        evidenceChunkIds: [chunk3Id],
      },
    ],
    keyTerms: [
      {
        term: "Precarga",
        definition:
          "Tensión parietal al final de la diástole ventricular determinada por el retorno venoso.",
        evidenceChunkIds: [chunk2Id],
      },
    ],
  };

  it("validates valid candidate citations and derives exact page numbers", () => {
    const result = validateStudyPackCitations(
      validCandidate,
      suppliedChunksMap
    );

    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.items.length).toBe(5);

    // Summary item check
    const summary = result.items.find((i) => i.itemType === "SUMMARY");
    expect(summary).toBeDefined();
    expect(summary?.citedChunkIds).toEqual([chunk1Id]);
    expect(summary?.derivedPageNumbers).toEqual([1]);

    // Concept with multiple citations check
    const concept = result.items.find((i) => i.itemType === "KEY_CONCEPT");
    expect(concept).toBeDefined();
    expect(concept?.citedChunkIds).toEqual([chunk1Id, chunk2Id]);
    expect(concept?.derivedPageNumbers).toEqual([1, 2]);
  });

  it("rejects candidate when citation references a foreign or non-existent chunk ID", () => {
    const foreignChunkId = "99999999-9999-9999-9999-999999999999";
    const invalidCandidate: StudyPackCandidate = {
      ...validCandidate,
      summaryParagraphs: [
        {
          paragraph:
            "Párrafo con cita a un fragmento inventado o de otro documento.",
          evidenceChunkIds: [foreignChunkId],
        },
      ],
    };

    const result = validateStudyPackCitations(
      invalidCandidate,
      suppliedChunksMap
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain("cites invalid or unsupplied chunk ID");
    expect(result.error).toContain(foreignChunkId);
  });

  it("rejects candidate when an item has zero citations", () => {
    const invalidCandidate: StudyPackCandidate = {
      ...validCandidate,
      highYieldPoints: [
        {
          point: "Punto sin ninguna cita.",
          evidenceChunkIds: [] as unknown as [string],
        },
      ],
    };

    const result = validateStudyPackCitations(
      invalidCandidate,
      suppliedChunksMap
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain("must cite at least 1 chunk");
  });

  it("rejects candidate when citations exceed max allowable limit (> 5)", () => {
    const invalidCandidate: StudyPackCandidate = {
      ...validCandidate,
      keyTerms: [
        {
          term: "Término",
          definition: "Definición con demasiadas citas.",
          evidenceChunkIds: [
            chunk1Id,
            chunk2Id,
            chunk3Id,
            chunk1Id,
            chunk2Id,
            chunk3Id,
          ] as unknown as [string, string, string, string, string, string],
        },
      ],
    };

    const result = validateStudyPackCitations(
      invalidCandidate,
      suppliedChunksMap
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain("exceeds maximum 5 citations");
  });

  it("deduplicates redundant citations for the same item", () => {
    const candidateWithDupes: StudyPackCandidate = {
      ...validCandidate,
      keyConcepts: [
        {
          title: "Concepto",
          explanation: "Explicación con citas repetidas.",
          evidenceChunkIds: [chunk1Id, chunk1Id],
        },
      ],
    };

    const result = validateStudyPackCitations(
      candidateWithDupes,
      suppliedChunksMap
    );
    expect(result.valid).toBe(true);
    const concept = result.items.find((i) => i.itemType === "KEY_CONCEPT");
    expect(concept?.citedChunkIds).toEqual([chunk1Id]);
    expect(concept?.derivedPageNumbers).toEqual([1]);
  });
});
