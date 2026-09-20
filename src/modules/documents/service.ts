import { createClient } from "@/lib/supabase/server";
import { UPLOAD_LIMITS } from "@/config/app";
import {
  requestUploadSchema,
  finalizeUploadSchema,
  archiveDocumentSchema,
  validatePdfMagicBytes,
  sanitizeFilename,
} from "./validation";
import type {
  DocumentWithSubject,
  DocumentRecord,
  RequestUploadInput,
  RequestUploadResult,
  DocumentQuotaUsage,
} from "./types";

export interface DocumentsResult<T> {
  data?: T;
  error?: string;
}

/**
 * Retrieves all active (non-archived) documents for the authenticated user.
 */
export async function getUserDocuments(): Promise<
  DocumentsResult<DocumentWithSubject[]>
> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { error: "No autenticado." };
    }

    const { data, error } = await supabase
      .from("documents")
      .select("*, subject:subjects(id, name)")
      .is("archived_at", null)
      .order("created_at", { ascending: false });

    if (error) {
      return { error: "No se pudieron obtener los documentos." };
    }

    return { data: (data as unknown as DocumentWithSubject[]) || [] };
  } catch {
    return { error: "Error inesperado al cargar documentos." };
  }
}

/**
 * Calculates current document quota usage for the authenticated user.
 */
export async function getDocumentQuotaUsage(): Promise<
  DocumentsResult<DocumentQuotaUsage>
> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { error: "No autenticado." };
    }

    const { data, error } = await supabase
      .from("documents")
      .select("size_bytes, status")
      .is("archived_at", null);

    if (error) {
      return { error: "No se pudo calcular la cuota de almacenamiento." };
    }

    const activeDocs = data.filter((d) =>
      ["UPLOADING", "VALIDATING", "READY"].includes(d.status)
    );
    const readyDocs = data.filter((d) =>
      ["VALIDATING", "READY"].includes(d.status)
    );

    const activeCount = activeDocs.length;
    const totalBytes = readyDocs.reduce(
      (acc, d) => acc + (d.size_bytes || 0),
      0
    );

    return {
      data: {
        activeDocumentsCount: activeCount,
        maxActiveDocuments: UPLOAD_LIMITS.maxActiveDocumentsPerUser,
        totalSizeBytes: totalBytes,
        maxTotalBytes: UPLOAD_LIMITS.maxTotalDocumentBytesPerUser,
      },
    };
  } catch {
    return { error: "Error al verificar cuotas de documentos." };
  }
}

/**
 * Authorizes a document upload and creates the initial system-owned record.
 */
export async function requestDocumentUpload(
  input: RequestUploadInput
): Promise<DocumentsResult<RequestUploadResult>> {
  try {
    const parsed = requestUploadSchema.safeParse(input);
    if (!parsed.success) {
      return {
        error: parsed.error.issues[0]?.message || "Datos de subida inválidos.",
      };
    }

    const cleanFilename = sanitizeFilename(parsed.data.original_filename);

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { error: "No autenticado." };
    }

    const { data, error } = await supabase.rpc("request_document_upload", {
      p_original_filename: cleanFilename,
      p_size_bytes: parsed.data.size_bytes,
      p_mime_type: parsed.data.mime_type || "application/pdf",
      p_subject_id: parsed.data.subject_id || undefined,
    });

    if (error) {
      if (error.code === "23514") {
        return {
          error:
            "Has alcanzado el límite de cuota para documentos en tu cuenta.",
        };
      }
      if (error.code === "23503") {
        return {
          error: "La asignatura seleccionada no existe o no te pertenece.",
        };
      }
      return { error: "No se pudo registrar la solicitud de subida." };
    }

    const record = Array.isArray(data) ? data[0] : data;

    if (!record || !record.document_id) {
      return { error: "Respuesta inválida del servidor al iniciar subida." };
    }

    return {
      data: {
        documentId: record.document_id,
        storageBucket: record.storage_bucket,
        storageKey: record.storage_key,
      },
    };
  } catch {
    return { error: "Error inesperado al solicitar la subida del documento." };
  }
}

/**
 * Validates the uploaded object in private storage and transitions status to READY or REJECTED.
 */
export async function finalizeDocumentUpload(input: {
  documentId: string;
}): Promise<DocumentsResult<DocumentRecord>> {
  try {
    const parsed = finalizeUploadSchema.safeParse(input);
    if (!parsed.success) {
      return { error: "Identificador de documento inválido." };
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { error: "No autenticado." };
    }

    // Retrieve document record
    const { data: doc, error: docError } = await supabase
      .from("documents")
      .select("*")
      .eq("id", parsed.data.documentId)
      .is("archived_at", null)
      .single();

    if (docError || !doc) {
      return { error: "Documento no encontrado." };
    }

    // Idempotency: If already READY, return cleanly
    if (doc.status === "READY") {
      return { data: doc as unknown as DocumentRecord };
    }

    // Download object from storage to validate container and magic bytes
    const { data: fileBlob, error: downloadError } = await supabase.storage
      .from(doc.storage_bucket)
      .download(doc.storage_key);

    if (downloadError || !fileBlob) {
      // Mark as REJECTED due to missing storage object
      await supabase.rpc("finalize_document_upload", {
        p_document_id: doc.id,
        p_finalize_token: doc.finalize_token,
        p_status: "REJECTED",
        p_size_bytes: doc.size_bytes,
        p_validation_error_code: "OBJECT_NOT_FOUND",
      });
      return {
        error: "El archivo no se encontró en el almacenamiento privado.",
      };
    }

    const arrayBuffer = await fileBlob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    // Validate magic bytes
    const isValidPdf = validatePdfMagicBytes(bytes);
    if (!isValidPdf) {
      // Reject and remove hostile/invalid object from storage
      await supabase.storage.from(doc.storage_bucket).remove([doc.storage_key]);

      await supabase.rpc("finalize_document_upload", {
        p_document_id: doc.id,
        p_finalize_token: doc.finalize_token,
        p_status: "REJECTED",
        p_size_bytes: fileBlob.size,
        p_validation_error_code: "INVALID_PDF_SIGNATURE",
      });

      return {
        error:
          "El archivo subido no es un PDF válido o contiene una cabecera corrupta.",
      };
    }

    // Validate actual size does not exceed quota
    if (fileBlob.size > UPLOAD_LIMITS.maxFileSizeBytes) {
      await supabase.storage.from(doc.storage_bucket).remove([doc.storage_key]);

      await supabase.rpc("finalize_document_upload", {
        p_document_id: doc.id,
        p_finalize_token: doc.finalize_token,
        p_status: "REJECTED",
        p_size_bytes: fileBlob.size,
        p_validation_error_code: "FILE_SIZE_EXCEEDED",
      });

      return {
        error: "El archivo excede el tamaño máximo permitido de 25 MB.",
      };
    }

    // Compute SHA-256 hash for integrity
    let sha256Hex: string | null = null;
    try {
      const hashBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      sha256Hex = hashArray
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    } catch {
      // Non-critical hash failure fallback
    }

    // Finalize to READY
    const { data: updatedDoc, error: finalizeError } = await supabase.rpc(
      "finalize_document_upload",
      {
        p_document_id: doc.id,
        p_finalize_token: doc.finalize_token,
        p_status: "READY",
        p_size_bytes: fileBlob.size,
        p_sha256: sha256Hex || undefined,
      }
    );

    if (finalizeError) {
      return { error: "No se pudo completar la validación del documento." };
    }

    return { data: updatedDoc as unknown as DocumentRecord };
  } catch {
    return { error: "Error inesperado al validar el documento." };
  }
}

/**
 * Generates an authorized, short-lived signed URL for accessing a private document.
 */
export async function getAuthorizedDocumentUrl(
  documentId: string
): Promise<DocumentsResult<{ signedUrl: string }>> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { error: "No autenticado." };
    }

    // Strict ownership verification: query document directly
    const { data: doc, error: docError } = await supabase
      .from("documents")
      .select("id, storage_bucket, storage_key, status, user_id")
      .eq("id", documentId)
      .is("archived_at", null)
      .single();

    if (docError || !doc) {
      return { error: "Documento no encontrado o acceso no autorizado." };
    }

    if (doc.status !== "READY") {
      return { error: "El documento aún no está listo para su visualización." };
    }

    const { data, error } = await supabase.storage
      .from(doc.storage_bucket)
      .createSignedUrl(doc.storage_key, UPLOAD_LIMITS.signedUrlTtlSeconds);

    if (error || !data?.signedUrl) {
      return { error: "No se pudo generar el enlace seguro de acceso." };
    }

    return { data: { signedUrl: data.signedUrl } };
  } catch {
    return { error: "Error inesperado al generar acceso seguro." };
  }
}

/**
 * Archives a document (soft-delete).
 */
export async function archiveDocument(
  documentId: string
): Promise<DocumentsResult<boolean>> {
  try {
    const parsed = archiveDocumentSchema.safeParse({ documentId });
    if (!parsed.success) {
      return { error: "Identificador de documento inválido." };
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { error: "No autenticado." };
    }

    const { error } = await supabase.rpc("archive_document", {
      p_document_id: parsed.data.documentId,
    });

    if (error) {
      return { error: "No se pudo archivar el documento." };
    }

    return { data: true };
  } catch {
    return { error: "Error inesperado al archivar el documento." };
  }
}
