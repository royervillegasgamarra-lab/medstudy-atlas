import { z } from "zod";
import { UPLOAD_LIMITS } from "@/config/app";

/**
 * Validates request to upload a new document.
 */
export const requestUploadSchema = z.object({
  original_filename: z
    .string()
    .trim()
    .min(1, "El nombre del archivo es requerido.")
    .max(255, "El nombre del archivo no puede exceder 255 caracteres."),
  size_bytes: z
    .number()
    .int("El tamaño del archivo debe ser un número entero.")
    .positive("El tamaño del archivo debe ser mayor a 0.")
    .max(
      UPLOAD_LIMITS.maxFileSizeBytes,
      `El archivo no puede exceder ${UPLOAD_LIMITS.maxFileSizeBytes / (1024 * 1024)} MB.`
    ),
  mime_type: z
    .string()
    .trim()
    .refine(
      (val) =>
        (UPLOAD_LIMITS.allowedMimeTypes as readonly string[]).includes(val),
      "Solo se admiten documentos en formato PDF."
    )
    .default("application/pdf"),
  subject_id: z
    .string()
    .uuid("Identificador de asignatura inválido.")
    .nullable()
    .optional(),
});

export const finalizeUploadSchema = z.object({
  documentId: z.string().uuid("Identificador de documento inválido."),
});

export const archiveDocumentSchema = z.object({
  documentId: z.string().uuid("Identificador de documento inválido."),
});

/**
 * Checks if the given buffer begins with the PDF magic bytes (%PDF-).
 * ASCII: % (0x25), P (0x50), D (0x44), F (0x46), - (0x2D)
 */
export function validatePdfMagicBytes(
  data: Uint8Array | ArrayBuffer | Buffer
): boolean {
  if (!data) return false;
  const bytes =
    data instanceof Uint8Array
      ? data
      : data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data);

  if (bytes.length < 5) {
    return false;
  }

  return (
    bytes[0] === 0x25 && // %
    bytes[1] === 0x50 && // P
    bytes[2] === 0x44 && // D
    bytes[3] === 0x46 && // F
    bytes[4] === 0x2d // -
  );
}

/**
 * Sanitizes original filename for safe UI display and metadata storage.
 * Strips path traversal sequences and control characters.
 */
export function sanitizeFilename(filename: string): string {
  if (!filename) return "documento.pdf";

  // Strip path traversal sequences
  let cleaned = filename.replace(/^.*[\\/]/, "");
  // Replace control characters
  cleaned = cleaned.replace(/[\x00-\x1f\x7f]/g, "");
  // Trim whitespace
  cleaned = cleaned.trim();

  return cleaned.length > 0 ? cleaned : "documento.pdf";
}
