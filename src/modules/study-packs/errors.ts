/**
 * Deterministic public error mapper for Study Pack operations.
 * Translates internal domain, database, and AI provider errors into safe,
 * localized Spanish user-facing messages without leaking internal schema,
 * SQL constraints, provider URLs, API keys, or raw exception strings.
 */

import { StudyPackServiceError } from "./service";
import { AIProviderError } from "../ai/types";
import type { StudyPackErrorCode } from "./types";

export interface PublicActionError {
  error: string;
  code?: StudyPackErrorCode;
}

export function getPublicErrorMessageForCode(code: StudyPackErrorCode): string {
  switch (code) {
    case "AI_DISABLED":
      return "La generación de Study Packs no está disponible temporalmente.";
    case "AI_NOT_CONFIGURED":
      return "El servicio de generación de Study Packs no está configurado actualmente.";
    case "STUDY_PACK_INPUT_LIMIT":
      return "El documento excede el límite de tamaño para generar un Study Pack. Intenta dividir el documento en partes más pequeñas.";
    case "AI_RATE_LIMITED":
      return "El servicio de IA ha alcanzado su límite de tasa temporalmente. Por favor, reintenta en unos minutos.";
    case "AI_TIMEOUT":
      return "El servicio de IA tardó demasiado en responder. Por favor, intenta nuevamente.";
    case "AI_PROVIDER_UNAVAILABLE":
      return "El servicio de IA no se encuentra disponible en este momento. Por favor, intenta nuevamente más tarde.";
    case "AI_PROVIDER_AUTH_ERROR":
      return "Error de autenticación con el proveedor de IA. Contacta a soporte.";
    case "STUDY_PACK_EVIDENCE_QA_FAILED":
      return "El material no contiene suficiente evidencia textual para generar un Study Pack de calidad académica.";
    case "STUDY_PACK_CITATION_INVALID":
      return "No se pudieron verificar las citas textuales generadas con el documento fuente.";
    case "STUDY_PACK_SCHEMA_INVALID":
      return "La respuesta generada por el proveedor no cumplió con el formato requerido.";
    case "STUDY_PACK_VERSION_UNSUPPORTED":
      return "La versión de generación de este Study Pack ya no es compatible.";
    case "STUDY_PACK_RETRY_LIMIT":
      return "Se superó el límite de intentos de generación para este documento.";
    case "STUDY_PACK_LEASE_EXPIRED":
      return "El tiempo de procesamiento asignado expiró. Por favor, intenta nuevamente.";
    case "DOCUMENT_ARCHIVED":
      return "El documento asociado ha sido archivado y no permite generar Study Packs.";
    case "SOURCE_NOT_READY":
    case "PROCESSING_NOT_SUCCEEDED":
    case "CHUNKS_NOT_READY":
    case "CHUNK_PROVENANCE_INVALID":
      return "El documento aún no está listo o procesado para generar un Study Pack.";
    case "WORKER_INTERNAL_ERROR":
    default:
      return "Ocurrió un error inesperado al procesar el Study Pack. Por favor, intenta nuevamente.";
  }
}

export function toPublicStudyPackError(err: unknown): PublicActionError {
  if (err instanceof StudyPackServiceError) {
    return {
      error: getPublicErrorMessageForCode(err.code),
      code: err.code,
    };
  }

  if (err instanceof AIProviderError) {
    switch (err.code) {
      case "AI_DISABLED":
        return {
          error: getPublicErrorMessageForCode("AI_DISABLED"),
          code: "AI_DISABLED",
        };
      case "AI_NOT_CONFIGURED":
        return {
          error: getPublicErrorMessageForCode("AI_NOT_CONFIGURED"),
          code: "AI_NOT_CONFIGURED",
        };
      case "AI_RATE_LIMITED":
        return {
          error: getPublicErrorMessageForCode("AI_RATE_LIMITED"),
          code: "AI_RATE_LIMITED",
        };
      case "AI_TIMEOUT":
        return {
          error: getPublicErrorMessageForCode("AI_TIMEOUT"),
          code: "AI_TIMEOUT",
        };
      case "AI_PROVIDER_UNAVAILABLE":
        return {
          error: getPublicErrorMessageForCode("AI_PROVIDER_UNAVAILABLE"),
          code: "AI_PROVIDER_UNAVAILABLE",
        };
      case "AI_PROVIDER_AUTH_ERROR":
        return {
          error: getPublicErrorMessageForCode("AI_PROVIDER_AUTH_ERROR"),
          code: "AI_PROVIDER_AUTH_ERROR",
        };
      case "AI_SCHEMA_INVALID":
        return {
          error: getPublicErrorMessageForCode("STUDY_PACK_SCHEMA_INVALID"),
          code: "STUDY_PACK_SCHEMA_INVALID",
        };
      default:
        return {
          error: getPublicErrorMessageForCode("WORKER_INTERNAL_ERROR"),
          code: "WORKER_INTERNAL_ERROR",
        };
    }
  }

  // Any raw unexpected error (Postgres, network, TypeError, etc.) fails safely
  return {
    error:
      "Ocurrió un error inesperado al procesar el Study Pack. Por favor, intenta nuevamente.",
    code: "WORKER_INTERNAL_ERROR",
  };
}
