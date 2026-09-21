import { describe, it, expect } from "vitest";
import {
  toPublicStudyPackError,
  getPublicErrorMessageForCode,
} from "@/modules/study-packs/errors";
import { StudyPackServiceError } from "@/modules/study-packs/service";
import { AIProviderError } from "@/modules/ai/types";
import { STUDY_PACK_ERROR_CODES } from "@/modules/study-packs/types";

describe("Public Error Mapper for Study Pack Actions (Item 6)", () => {
  it("maps raw database errors safely without exposing SQL or constraint names", () => {
    const rawPgError = new Error(
      'insert or update on table "study_packs" violates foreign key constraint "fk_study_packs_doc_owner"'
    );
    const mapped = toPublicStudyPackError(rawPgError);

    expect(mapped.code).toBe("WORKER_INTERNAL_ERROR");
    expect(mapped.error).toBe(
      "Ocurrió un error inesperado al procesar el Study Pack. Por favor, intenta nuevamente."
    );
    expect(mapped.error).not.toContain("study_packs");
    expect(mapped.error).not.toContain("foreign key");
    expect(mapped.error).not.toContain("fk_study_packs_doc_owner");
  });

  it("maps statement timeout and connection aborts safely", () => {
    const rawTimeoutError = new Error(
      "canceling statement due to statement timeout at character 42"
    );
    const mapped = toPublicStudyPackError(rawTimeoutError);

    expect(mapped.code).toBe("WORKER_INTERNAL_ERROR");
    expect(mapped.error).toBe(
      "Ocurrió un error inesperado al procesar el Study Pack. Por favor, intenta nuevamente."
    );
    expect(mapped.error).not.toContain("timeout");
    expect(mapped.error).not.toContain("character 42");
  });

  it("maps raw AI provider errors safely without exposing private base URLs or API keys", () => {
    const rawAiError = new AIProviderError(
      "AI_PROVIDER_UNAVAILABLE",
      "Failed to connect to http://10.0.0.12:8000/v1/chat/completions with key sk-secret-12345",
      true
    );
    const mapped = toPublicStudyPackError(rawAiError);

    expect(mapped.code).toBe("AI_PROVIDER_UNAVAILABLE");
    expect(mapped.error).toBe(
      "El servicio de IA no se encuentra disponible en este momento. Por favor, intenta nuevamente más tarde."
    );
    expect(mapped.error).not.toContain("10.0.0.12");
    expect(mapped.error).not.toContain("sk-secret-12345");
  });

  it("maps AI_DISABLED to localized maintenance message", () => {
    const aiDisabledError = new AIProviderError(
      "AI_DISABLED",
      "AI generation disabled on this node",
      false
    );
    const mapped = toPublicStudyPackError(aiDisabledError);

    expect(mapped.code).toBe("AI_DISABLED");
    expect(mapped.error).toBe(
      "La generación de Study Packs no está disponible temporalmente."
    );
  });

  it("maps AI_NOT_CONFIGURED to localized configuration message", () => {
    const notConfigured = new AIProviderError(
      "AI_NOT_CONFIGURED",
      "Missing AI_API_KEY in production env",
      false
    );
    const mapped = toPublicStudyPackError(notConfigured);

    expect(mapped.code).toBe("AI_NOT_CONFIGURED");
    expect(mapped.error).toBe(
      "El servicio de generación de Study Packs no está configurado actualmente."
    );
    expect(mapped.error).not.toContain("AI_API_KEY");
  });

  it("maps STUDY_PACK_INPUT_LIMIT to user guidance on splitting material", () => {
    const inputLimitError = new StudyPackServiceError(
      "STUDY_PACK_INPUT_LIMIT",
      "Document evidence 150000 chars exceeds limit 100000 chars",
      false
    );
    const mapped = toPublicStudyPackError(inputLimitError);

    expect(mapped.code).toBe("STUDY_PACK_INPUT_LIMIT");
    expect(mapped.error).toBe(
      "El documento excede el límite de tamaño para generar un Study Pack. Intenta dividir el documento en partes más pequeñas."
    );
    expect(mapped.error).not.toContain("150000");
  });

  it("maps STUDY_PACK_EVIDENCE_QA_FAILED to academic grounding message", () => {
    const qaError = new StudyPackServiceError(
      "STUDY_PACK_EVIDENCE_QA_FAILED",
      "Only 20% supported claims, minimum 50% required",
      false
    );
    const mapped = toPublicStudyPackError(qaError);

    expect(mapped.code).toBe("STUDY_PACK_EVIDENCE_QA_FAILED");
    expect(mapped.error).toBe(
      "El material no contiene suficiente evidencia textual para generar un Study Pack de calidad académica."
    );
    expect(mapped.error).not.toContain("20%");
  });

  it("provides non-empty safe Spanish messages for all 19 StudyPackErrorCode values", () => {
    expect(STUDY_PACK_ERROR_CODES.length).toBe(19);

    for (const code of STUDY_PACK_ERROR_CODES) {
      const msg = getPublicErrorMessageForCode(code);
      expect(typeof msg).toBe("string");
      expect(msg.length).toBeGreaterThan(15);
      // Ensure no raw identifiers appear in public messages
      expect(msg).not.toContain("SELECT");
      expect(msg).not.toContain("INSERT");
      expect(msg).not.toContain("undefined");
      expect(msg).not.toContain("null");
    }
  });

  it("handles arbitrary primitives safely (strings, null, numbers)", () => {
    expect(toPublicStudyPackError("raw string error").code).toBe(
      "WORKER_INTERNAL_ERROR"
    );
    expect(toPublicStudyPackError(null).code).toBe("WORKER_INTERNAL_ERROR");
    expect(toPublicStudyPackError(undefined).code).toBe(
      "WORKER_INTERNAL_ERROR"
    );
    expect(toPublicStudyPackError(500).code).toBe("WORKER_INTERNAL_ERROR");
  });
});
