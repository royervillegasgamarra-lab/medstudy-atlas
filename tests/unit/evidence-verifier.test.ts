import { describe, it, expect, beforeEach } from "vitest";
import {
  executeEvidenceVerification,
  type NormalizedCandidateItem,
} from "@/modules/study-packs/evidence-verifier";
import { MockAIProvider } from "@/modules/ai/mock-provider";
import type { SuppliedChunkInfo } from "@/modules/study-packs/citation-validator";

describe("Deterministic Evidence Verifier (CALL 2 & QA Gate)", () => {
  let mockProvider: MockAIProvider;

  const chunk1Id = "11111111-1111-1111-1111-111111111111";
  const chunk2Id = "22222222-2222-2222-2222-222222222222";

  const chunksMap = new Map<string, SuppliedChunkInfo>([
    [
      chunk1Id,
      {
        id: chunk1Id,
        document_id: "doc-1",
        user_id: "user-1",
        page_number: 1,
        content:
          "La sístole ventricular comienza con la contracción isovolumétrica.",
      },
    ],
    [
      chunk2Id,
      {
        id: chunk2Id,
        document_id: "doc-1",
        user_id: "user-1",
        page_number: 2,
        content: "El llenado ventricular ocurre durante la diástole.",
      },
    ],
  ]);

  const candidateItems: NormalizedCandidateItem[] = [
    {
      tempKey: "sum-0",
      itemType: "SUMMARY",
      ordinal: 0,
      textForVerification: "La sístole inicia con contracción isovolumétrica.",
      payload: {
        paragraph: "La sístole inicia con contracción isovolumétrica.",
      },
      citedChunkIds: [chunk1Id],
      derivedPageNumbers: [1],
    },
    {
      tempKey: "obj-0",
      itemType: "LEARNING_OBJECTIVE",
      ordinal: 0,
      textForVerification:
        "Identificar la fase de llenado ventricular en diástole.",
      payload: {
        objective: "Identificar la fase de llenado ventricular en diástole.",
      },
      citedChunkIds: [chunk2Id],
      derivedPageNumbers: [2],
    },
    {
      tempKey: "concept-0",
      itemType: "KEY_CONCEPT",
      ordinal: 0,
      textForVerification: "Fisiología cardíaca básica: contracción y llenado.",
      payload: { title: "Fisiología", explanation: "Contracción y llenado." },
      citedChunkIds: [chunk1Id, chunk2Id],
      derivedPageNumbers: [1, 2],
    },
    {
      tempKey: "hy-0",
      itemType: "HIGH_YIELD_POINT",
      ordinal: 0,
      textForVerification:
        "Afirmación no respaldada sobre dosis de betabloqueantes.",
      payload: {
        point: "Afirmación no respaldada sobre dosis de betabloqueantes.",
      },
      citedChunkIds: [chunk1Id],
      derivedPageNumbers: [1],
    },
  ];

  beforeEach(() => {
    mockProvider = new MockAIProvider();
  });

  it("filters out UNSUPPORTED items and keeps only verified claims", async () => {
    mockProvider.enqueueData({
      evaluations: [
        {
          itemKey: "sum-0",
          verdict: "SUPPORTED",
          rationale: "Encontrado en chunk 1",
        },
        {
          itemKey: "obj-0",
          verdict: "SUPPORTED",
          rationale: "Encontrado en chunk 2",
        },
        {
          itemKey: "concept-0",
          verdict: "SUPPORTED",
          rationale: "Encontrado en chunks 1 y 2",
        },
        {
          itemKey: "hy-0",
          verdict: "UNSUPPORTED",
          rationale: "No mencionado en el documento",
        },
      ],
    });

    const result = await executeEvidenceVerification(
      candidateItems,
      chunksMap,
      mockProvider
    );

    expect(result.passed).toBe(true);
    expect(result.items.length).toBe(3);
    expect(result.items.map((i) => i.tempKey)).toEqual([
      "sum-0",
      "obj-0",
      "concept-0",
    ]);
    expect(result.items.find((i) => i.tempKey === "hy-0")).toBeUndefined();
  });

  it("re-indexes ordinals per item_type starting at 1", async () => {
    const twoConcepts: NormalizedCandidateItem[] = [
      ...candidateItems,
      {
        tempKey: "concept-1",
        itemType: "KEY_CONCEPT",
        ordinal: 1,
        textForVerification: "Segundo concepto clave respaldado.",
        payload: { title: "Segundo", explanation: "Explicación" },
        citedChunkIds: [chunk1Id],
        derivedPageNumbers: [1],
      },
    ];

    mockProvider.enqueueData({
      evaluations: [
        { itemKey: "sum-0", verdict: "SUPPORTED", rationale: "ok" },
        { itemKey: "obj-0", verdict: "SUPPORTED", rationale: "ok" },
        { itemKey: "concept-0", verdict: "SUPPORTED", rationale: "ok" },
        { itemKey: "concept-1", verdict: "SUPPORTED", rationale: "ok" },
        { itemKey: "hy-0", verdict: "UNSUPPORTED", rationale: "rejected" },
      ],
    });

    const result = await executeEvidenceVerification(
      twoConcepts,
      chunksMap,
      mockProvider
    );

    expect(result.passed).toBe(true);
    const concepts = result.items.filter((i) => i.itemType === "KEY_CONCEPT");
    expect(concepts.length).toBe(2);
    expect(concepts[0].ordinal).toBe(0);
    expect(concepts[1].ordinal).toBe(1);
  });

  it("fails QA gate when 0 summary items are supported", async () => {
    mockProvider.enqueueData({
      evaluations: [
        {
          itemKey: "sum-0",
          verdict: "UNSUPPORTED",
          rationale: "Resumen no respaldado",
        },
        { itemKey: "obj-0", verdict: "SUPPORTED", rationale: "ok" },
        { itemKey: "concept-0", verdict: "SUPPORTED", rationale: "ok" },
        { itemKey: "hy-0", verdict: "SUPPORTED", rationale: "ok" },
      ],
    });

    const result = await executeEvidenceVerification(
      candidateItems,
      chunksMap,
      mockProvider
    );

    expect(result.passed).toBe(false);
    expect(result.error).toContain("Evidence QA gate failed");
    expect(result.items).toEqual([]);
    expect(result.citations).toEqual([]);
  });

  it("fails QA gate when supported ratio drops below 50%", async () => {
    // 1 of 4 items supported = 25% < 50%
    mockProvider.enqueueData({
      evaluations: [
        { itemKey: "sum-0", verdict: "SUPPORTED", rationale: "ok" },
        { itemKey: "obj-0", verdict: "UNSUPPORTED", rationale: "no" },
        { itemKey: "concept-0", verdict: "UNSUPPORTED", rationale: "no" },
        { itemKey: "hy-0", verdict: "UNSUPPORTED", rationale: "no" },
      ],
    });

    const result = await executeEvidenceVerification(
      candidateItems,
      chunksMap,
      mockProvider
    );

    expect(result.passed).toBe(false);
    expect(result.error).toContain("Evidence QA gate failed");
  });

  it("constructs verified citations correctly for supported items", async () => {
    mockProvider.enqueueData({
      evaluations: [
        { itemKey: "sum-0", verdict: "SUPPORTED", rationale: "ok" },
        { itemKey: "obj-0", verdict: "SUPPORTED", rationale: "ok" },
        { itemKey: "concept-0", verdict: "SUPPORTED", rationale: "ok" },
        { itemKey: "hy-0", verdict: "UNSUPPORTED", rationale: "no" },
      ],
    });

    const result = await executeEvidenceVerification(
      candidateItems,
      chunksMap,
      mockProvider
    );

    expect(result.passed).toBe(true);
    // concept-0 has 2 cited chunks
    const conceptCitations = result.citations.filter(
      (c) => c.itemTempKey === "concept-0"
    );
    expect(conceptCitations.length).toBe(2);
    expect(conceptCitations[0].documentChunkId).toBe(chunk1Id);
    expect(conceptCitations[0].ordinal).toBe(0);
    expect(conceptCitations[1].documentChunkId).toBe(chunk2Id);
    expect(conceptCitations[1].ordinal).toBe(1);
  });
});
