import { describe, it, expect, beforeEach } from "vitest";
import {
  executeEvidenceVerification,
  type NormalizedCandidateItem,
} from "@/modules/study-packs/evidence-verifier";
import { MockAIProvider } from "@/modules/ai/mock-provider";
import type { SuppliedChunkInfo } from "@/modules/study-packs/citation-validator";
import { StudyPackServiceError } from "@/modules/study-packs/service";
import { STUDY_PACK_BUDGET_LIMITS } from "@/config/study-pack-limits";
import type { AIProvider, AIStructuredRequest } from "@/modules/ai/types";

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

describe("Verifier Evidence Deduplication & Bound (Items 2 & 3)", () => {
  const chunk1Id = "11111111-1111-1111-1111-111111111111";
  const chunk2Id = "22222222-2222-2222-2222-222222222222";
  const chunkUnrelatedId = "33333333-3333-3333-3333-333333333333";

  const extendedChunksMap = new Map<string, SuppliedChunkInfo>([
    [
      chunk1Id,
      {
        id: chunk1Id,
        document_id: "doc-1",
        user_id: "user-1",
        page_number: 1,
        content: "Contenido del chunk 1 sobre anatomía ventricular.",
      },
    ],
    [
      chunk2Id,
      {
        id: chunk2Id,
        document_id: "doc-1",
        user_id: "user-1",
        page_number: 2,
        content: "Contenido del chunk 2 sobre sístole y diástole.",
      },
    ],
    [
      chunkUnrelatedId,
      {
        id: chunkUnrelatedId,
        document_id: "doc-1",
        user_id: "user-1",
        page_number: 3,
        content: "Contenido no citado de otra sección del documento.",
      },
    ],
  ]);

  it("serializes only the unique union of cited chunks once in evidence array and omits unrelated chunks", async () => {
    let capturedUserPrompt = "";

    const instrumentedProvider: AIProvider = {
      name: "test-verifier-provider",
      model: "test-model",
      generateStructured: async <T>(req: AIStructuredRequest<T>) => {
        capturedUserPrompt = req.userPrompt;
        return {
          data: {
            evaluations: [
              { itemKey: "item-1", verdict: "SUPPORTED", rationale: "ok" },
              { itemKey: "item-2", verdict: "SUPPORTED", rationale: "ok" },
              { itemKey: "item-3", verdict: "SUPPORTED", rationale: "ok" },
            ],
          } as unknown as T,
          telemetry: {
            provider: "test-verifier-provider",
            model: "test-model",
            inputTokens: 100,
            outputTokens: 50,
            cachedTokens: 0,
            estimatedCostUsd: 0,
            latencyMs: 10,
            status: "SUCCESS" as const,
          },
        };
      },
    };

    // 3 items all cite chunk1Id, 2 items also cite chunk2Id
    const items: NormalizedCandidateItem[] = [
      {
        tempKey: "item-1",
        itemType: "SUMMARY",
        ordinal: 0,
        textForVerification: "Summary claim citing chunk 1",
        payload: {},
        citedChunkIds: [chunk1Id],
        derivedPageNumbers: [1],
      },
      {
        tempKey: "item-2",
        itemType: "LEARNING_OBJECTIVE",
        ordinal: 0,
        textForVerification: "Objective claim citing chunk 1 and 2",
        payload: {},
        citedChunkIds: [chunk1Id, chunk2Id],
        derivedPageNumbers: [1, 2],
      },
      {
        tempKey: "item-3",
        itemType: "KEY_CONCEPT",
        ordinal: 0,
        textForVerification: "Concept claim citing chunk 1 and 2",
        payload: {},
        citedChunkIds: [chunk1Id, chunk2Id],
        derivedPageNumbers: [1, 2],
      },
    ];

    await executeEvidenceVerification(
      items,
      extendedChunksMap,
      instrumentedProvider
    );

    const parsed = JSON.parse(capturedUserPrompt) as {
      candidates: Array<{ itemKey: string; citedChunkIds: string[] }>;
      evidence: Array<{ chunkId: string; pageNumber: number; content: string }>;
      instructions: string;
    };

    // 1. Evidence contains EXACTLY 2 unique cited chunks, despite 5 total citations
    expect(parsed.evidence.length).toBe(2);
    const chunkIdsInEvidence = parsed.evidence.map((e) => e.chunkId);
    expect(chunkIdsInEvidence).toContain(chunk1Id);
    expect(chunkIdsInEvidence).toContain(chunk2Id);
    // Unrelated chunk is omitted
    expect(chunkIdsInEvidence).not.toContain(chunkUnrelatedId);

    // 2. Candidates reference only citedChunkIds without chunk content duplication
    expect(parsed.candidates.length).toBe(3);
    expect(parsed.candidates[0].citedChunkIds).toEqual([chunk1Id]);
    expect(parsed.candidates[1].citedChunkIds).toEqual([chunk1Id, chunk2Id]);
    expect(
      (parsed.candidates[0] as Record<string, unknown>).citedEvidence
    ).toBeUndefined();

    // 3. Verifier instructions explicitly restrict evaluation to citedChunkIds
    expect(parsed.instructions).toContain(
      "Evaluate each candidate item ONLY against evidence chunks whose chunkId is listed in candidate.citedChunkIds"
    );
  });

  it("throws STUDY_PACK_INPUT_LIMIT with 0 provider calls when verifier prompt exceeds maxVerifierInputChars", async () => {
    let providerCalls = 0;

    const instrumentedProvider: AIProvider = {
      name: "test-verifier-provider",
      model: "test-model",
      generateStructured: async <T>() => {
        providerCalls++;
        return {} as unknown as T;
      },
    };

    // Create a massive chunk that will blow past maxVerifierInputChars (180,000)
    const giantContent = "A".repeat(
      STUDY_PACK_BUDGET_LIMITS.maxVerifierInputChars + 1000
    );
    const giantChunkMap = new Map<string, SuppliedChunkInfo>([
      [
        chunk1Id,
        {
          id: chunk1Id,
          document_id: "doc-1",
          user_id: "user-1",
          page_number: 1,
          content: giantContent,
        },
      ],
    ]);

    const items: NormalizedCandidateItem[] = [
      {
        tempKey: "sum-0",
        itemType: "SUMMARY",
        ordinal: 0,
        textForVerification: "Summary claim",
        payload: {},
        citedChunkIds: [chunk1Id],
        derivedPageNumbers: [1],
      },
    ];

    await expect(
      executeEvidenceVerification(items, giantChunkMap, instrumentedProvider)
    ).rejects.toThrowError(StudyPackServiceError);

    try {
      await executeEvidenceVerification(
        items,
        giantChunkMap,
        instrumentedProvider
      );
    } catch (e: unknown) {
      expect((e as StudyPackServiceError).code).toBe("STUDY_PACK_INPUT_LIMIT");
      expect((e as StudyPackServiceError).retryable).toBe(false);
      expect((e as StudyPackServiceError).message).toContain(
        "exceeds maximum allowed verifier input limit"
      );
    }

    // Crucial invariant: ZERO external provider calls made for oversized payload
    expect(providerCalls).toBe(0);
  });
});
