import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
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
 * P0-4: Counts all active reservations (UPLOADING, VALIDATING, READY).
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

    const activeCount = activeDocs.length;
    const totalBytes = activeDocs.reduce(
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
 * P0-3: Creates an exact signed upload authorization for {user_id}/{doc_id}/source.pdf.
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

    // Call database RPC to reserve quota and insert initial UPLOADING record
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

    // P0-3: Trusted server admin client creates signed upload authorization for THAT EXACT KEY
    const { data: signedData, error: signedError } = await supabaseAdmin.storage
      .from(record.storage_bucket)
      .createSignedUploadUrl(record.storage_key);

    if (signedError || !signedData?.token) {
      return {
        error:
          "No se pudo generar la autorización de subida al almacenamiento.",
      };
    }

    return {
      data: {
        documentId: record.document_id,
        storageBucket: record.storage_bucket,
        storageKey: record.storage_key,
        signedUploadUrl: signedData.signedUrl,
        signedUploadToken: signedData.token,
      },
    };
  } catch {
    return { error: "Error inesperado al solicitar la subida del documento." };
  }
}

/**
 * Authoritatively validates the uploaded object in private storage and transitions status to READY or REJECTED.
 * P0-1 & P0-7: Authenticated browsers cannot invoke finalization directly; execution is performed
 * by trusted server code using privileged admin access and server-only RPCs.
 * P1-1: Avoids full 25 MB download by inspecting metadata for actual size and using 5-byte range read.
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

    // Retrieve document record to verify ownership and active status
    const { data: doc, error: docError } = await supabase
      .from("documents")
      .select("*")
      .eq("id", parsed.data.documentId)
      .eq("user_id", user.id)
      .is("archived_at", null)
      .single();

    if (docError || !doc) {
      return { error: "Documento no encontrado o acceso no autorizado." };
    }

    // Idempotency: If already READY, return cleanly
    if (doc.status === "READY") {
      return { data: doc as unknown as DocumentRecord };
    }

    // P0-7: Privileged Storage access to confirm exact object exists and get metadata
    const { data: info, error: infoError } = await supabaseAdmin.storage
      .from(doc.storage_bucket)
      .info(doc.storage_key);

    if (infoError || !info) {
      await supabaseAdmin.rpc("reject_document_upload_privileged", {
        p_document_id: doc.id,
        p_user_id: user.id,
        p_error_code: "OBJECT_NOT_FOUND",
        p_status: "REJECTED",
      });
      return {
        error: "El archivo no se encontró en el almacenamiento privado.",
      };
    }

    // P0-4: Actual storage size MUST equal the reserved/declared size
    if (info.size !== doc.size_bytes) {
      await supabaseAdmin.storage
        .from(doc.storage_bucket)
        .remove([doc.storage_key]);

      await supabaseAdmin.rpc("reject_document_upload_privileged", {
        p_document_id: doc.id,
        p_user_id: user.id,
        p_error_code: "SIZE_MISMATCH",
        p_status: "REJECTED",
      });

      return {
        error: "El tamaño del archivo no coincide con la reserva declarada.",
      };
    }

    // P0-7: Confirm allowed content type as defense-in-depth
    if (info.contentType !== "application/pdf") {
      await supabaseAdmin.storage
        .from(doc.storage_bucket)
        .remove([doc.storage_key]);

      await supabaseAdmin.rpc("reject_document_upload_privileged", {
        p_document_id: doc.id,
        p_user_id: user.id,
        p_error_code: "INVALID_MIME_TYPE",
        p_status: "REJECTED",
      });

      return {
        error: "Tipo de archivo no permitido. Solo se aceptan archivos PDF.",
      };
    }

    // P1-1: Read only the minimum prefix (5 bytes) needed to verify %PDF-
    let isValidPdf = false;
    try {
      const { data: signed, error: signErr } = await supabaseAdmin.storage
        .from(doc.storage_bucket)
        .createSignedUrl(doc.storage_key, 60);

      if (!signErr && signed?.signedUrl) {
        const rangeRes = await fetch(signed.signedUrl, {
          headers: { Range: "bytes=0-4" },
        });

        if (rangeRes.ok || rangeRes.status === 206) {
          const rangeBuffer = await rangeRes.arrayBuffer();
          const rangeBytes = new Uint8Array(rangeBuffer);
          isValidPdf = validatePdfMagicBytes(rangeBytes);
        }
      }
    } catch {
      isValidPdf = false;
    }

    if (!isValidPdf) {
      // Reject and remove invalid object from physical storage
      await supabaseAdmin.storage
        .from(doc.storage_bucket)
        .remove([doc.storage_key]);

      await supabaseAdmin.rpc("reject_document_upload_privileged", {
        p_document_id: doc.id,
        p_user_id: user.id,
        p_error_code: "INVALID_PDF_SIGNATURE",
        p_status: "REJECTED",
      });

      return {
        error:
          "El archivo subido no es un PDF válido o contiene una cabecera corrupta.",
      };
    }

    // P0-7: Mark READY through server-only privileged DB path
    const { data: updatedDoc, error: finalizeError } = await supabaseAdmin.rpc(
      "finalize_document_upload_privileged",
      {
        p_document_id: doc.id,
        p_user_id: user.id,
        p_actual_size: info.size,
      }
    );

    if (finalizeError || !updatedDoc) {
      return { error: "No se pudo completar la finalización del documento." };
    }

    return { data: updatedDoc as unknown as DocumentRecord };
  } catch {
    return { error: "Error inesperado al validar el documento." };
  }
}

/**
 * Generates an authorized, short-lived signed URL for accessing a private document.
 * P0-3: Access is exclusively through short-lived signed URLs (300s TTL)
 * after server-side ownership authorization.
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
      .eq("user_id", user.id)
      .is("archived_at", null)
      .single();

    if (docError || !doc) {
      return { error: "Documento no encontrado o acceso no autorizado." };
    }

    if (doc.status !== "READY") {
      return { error: "El documento aún no está listo para su visualización." };
    }

    // Server creates signed download URL using admin client
    const { data, error } = await supabaseAdmin.storage
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
 * Archives a document and removes the physical storage object.
 * P0-6: Physically removes the Storage object through the official Storage API
 * before setting archived_at. Quota is freed only when storage removal succeeds
 * or the object is already absent.
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

    // Retrieve document to get storage key and verify ownership
    const { data: doc, error: docError } = await supabase
      .from("documents")
      .select("id, storage_bucket, storage_key, user_id")
      .eq("id", parsed.data.documentId)
      .eq("user_id", user.id)
      .is("archived_at", null)
      .single();

    if (docError || !doc) {
      return { error: "Documento no encontrado o ya archivado." };
    }

    // P0-6: Physically remove storage object through official Storage API
    try {
      await supabaseAdmin.storage
        .from(doc.storage_bucket)
        .remove([doc.storage_key]);
    } catch {
      // If removal fails, do not silently free quota
      return {
        error: "No se pudo eliminar el archivo físico del almacenamiento.",
      };
    }

    // Mark document archived in database
    const { error: archiveError } = await supabase.rpc("archive_document", {
      p_document_id: doc.id,
    });

    if (archiveError) {
      return { error: "No se pudo actualizar el registro de archivo." };
    }

    return { data: true };
  } catch {
    return { error: "Error inesperado al archivar el documento." };
  }
}
