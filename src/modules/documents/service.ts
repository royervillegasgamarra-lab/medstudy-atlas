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

function isStorageNotFoundError(err: unknown): boolean {
  if (!err) return false;
  const anyErr = err as {
    statusCode?: number | string;
    status?: number | string;
    message?: string;
    error?: string;
  };
  const status = anyErr.statusCode || anyErr.status;
  if (status === 404 || status === "404") return true;
  const msg = (
    (anyErr.message || "") +
    " " +
    (anyErr.error || "")
  ).toLowerCase();
  return (
    msg.includes("not found") ||
    msg.includes("not_found") ||
    msg.includes("404")
  );
}

/**
 * Calculates current document quota usage for the authenticated user.
 * P0: Counts active rows (UPLOADING, CLEANUP_PENDING, READY) using worst-case 25 MB for unverified.
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
      ["UPLOADING", "CLEANUP_PENDING", "READY"].includes(d.status)
    );

    const activeCount = activeDocs.length;
    const totalBytes = activeDocs.reduce(
      (acc, d) =>
        acc +
        (d.status === "READY"
          ? d.size_bytes || 0
          : UPLOAD_LIMITS.maxFileSizeBytes),
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
 * P0: Direct authenticated upload backed by Storage INSERT RLS policy.
 * Stale UPLOADING reservations (> 2h) are physically cleaned up before release.
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

    // P0: Lazy physical cleanup of any CLEANUP_PENDING rows for this user
    const { data: pendingCleanupDocs } = await supabaseAdmin
      .from("documents")
      .select("id, storage_bucket, storage_key, validation_error_code")
      .eq("user_id", user.id)
      .eq("status", "CLEANUP_PENDING")
      .is("archived_at", null);

    if (pendingCleanupDocs && pendingCleanupDocs.length > 0) {
      for (const pending of pendingCleanupDocs) {
        try {
          const { error: removeErr } = await supabaseAdmin.storage
            .from(pending.storage_bucket)
            .remove([pending.storage_key]);

          if (!removeErr) {
            const targetStatus = pending.validation_error_code
              ? "REJECTED"
              : "FAILED";
            const targetErrorCode =
              pending.validation_error_code || "CLEANUP_RECOVERED";
            const { error: completeErr } = await supabaseAdmin.rpc(
              "complete_document_cleanup_privileged",
              {
                p_document_id: pending.id,
                p_user_id: user.id,
                p_status: targetStatus,
                p_error_code: targetErrorCode,
              }
            );
            if (completeErr) {
              // Remains in CLEANUP_PENDING if RPC fails
            }
          }
        } catch {
          // Leave in CLEANUP_PENDING if physical removal fails
        }
      }
    }

    // P0: Lazy physical cleanup of stale UPLOADING reservations (> 2 hours)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: staleDocs } = await supabaseAdmin
      .from("documents")
      .select("id, storage_bucket, storage_key, user_id")
      .eq("user_id", user.id)
      .eq("status", "UPLOADING")
      .is("archived_at", null)
      .lte("created_at", twoHoursAgo);

    if (staleDocs && staleDocs.length > 0) {
      for (const stale of staleDocs) {
        try {
          const { error: startErr } = await supabaseAdmin.rpc(
            "start_document_cleanup_privileged",
            {
              p_document_id: stale.id,
              p_user_id: user.id,
            }
          );
          if (startErr) {
            continue;
          }

          const { error: removeErr } = await supabaseAdmin.storage
            .from(stale.storage_bucket)
            .remove([stale.storage_key]);

          if (!removeErr) {
            const { error: completeErr } = await supabaseAdmin.rpc(
              "complete_document_cleanup_privileged",
              {
                p_document_id: stale.id,
                p_user_id: user.id,
                p_status: "FAILED",
                p_error_code: "UPLOAD_TIMEOUT",
              }
            );
            if (completeErr) {
              // Remains in CLEANUP_PENDING if RPC fails
            }
          }
        } catch {
          // Leave in CLEANUP_PENDING if physical removal fails
        }
      }
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
 * Authoritatively validates the uploaded object in private storage and transitions status to READY or REJECTED.
 * P0: Authenticated browsers cannot invoke finalization directly; execution is performed
 * by trusted server code using privileged admin access and server-only RPCs.
 * P0: Safe two-step cleanup: UPLOADING -> CLEANUP_PENDING -> physical remove -> REJECTED.
 * P0: Storage error differentiation: transient 5xx does not reject or delete.
 * P1: Range read is strictly bounded (HTTP 206, byteLength <= 5, timeout).
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

    if (doc.status !== "UPLOADING") {
      return {
        error: "El documento no se encuentra en estado de subida pendiente.",
      };
    }

    // P0: Privileged Storage access to confirm exact object exists and get metadata
    const { data: info, error: infoError } = await supabaseAdmin.storage
      .from(doc.storage_bucket)
      .info(doc.storage_key);

    if (infoError || !info) {
      if (infoError && !isStorageNotFoundError(infoError)) {
        // P0: Transient 5xx / network error: return recoverable error without rejecting or deleting
        return {
          error:
            "Error temporal de almacenamiento al verificar el archivo. Intenta nuevamente.",
        };
      }

      // Confirmed 404: execute safe two-step cleanup
      const { error: startErr } = await supabaseAdmin.rpc(
        "start_document_cleanup_privileged",
        {
          p_document_id: doc.id,
          p_user_id: user.id,
        }
      );
      if (startErr) {
        return { error: "Error al registrar estado de limpieza." };
      }

      const { error: completeErr } = await supabaseAdmin.rpc(
        "complete_document_cleanup_privileged",
        {
          p_document_id: doc.id,
          p_user_id: user.id,
          p_status: "REJECTED",
          p_error_code: "OBJECT_NOT_FOUND",
        }
      );
      if (completeErr) {
        return { error: "Error al registrar rechazo del documento." };
      }

      return {
        error: "El archivo no se encontró en el almacenamiento privado.",
      };
    }

    // P0-4: Actual storage size MUST equal the reserved/declared size
    if (info.size !== doc.size_bytes) {
      const { error: startErr } = await supabaseAdmin.rpc(
        "start_document_cleanup_privileged",
        {
          p_document_id: doc.id,
          p_user_id: user.id,
        }
      );
      if (startErr) {
        return { error: "Error al registrar estado de limpieza." };
      }

      const { error: removeError } = await supabaseAdmin.storage
        .from(doc.storage_bucket)
        .remove([doc.storage_key]);

      if (removeError) {
        return {
          error: "Error al limpiar archivo con tamaño no coincidente.",
        };
      }

      const { error: completeErr } = await supabaseAdmin.rpc(
        "complete_document_cleanup_privileged",
        {
          p_document_id: doc.id,
          p_user_id: user.id,
          p_status: "REJECTED",
          p_error_code: "SIZE_MISMATCH",
        }
      );
      if (completeErr) {
        return { error: "Error al registrar rechazo del documento." };
      }

      return {
        error: "El tamaño del archivo no coincide con la reserva declarada.",
      };
    }

    // P0: Confirm allowed content type
    if (info.contentType !== "application/pdf") {
      const { error: startErr } = await supabaseAdmin.rpc(
        "start_document_cleanup_privileged",
        {
          p_document_id: doc.id,
          p_user_id: user.id,
        }
      );
      if (startErr) {
        return { error: "Error al registrar estado de limpieza." };
      }

      const { error: removeError } = await supabaseAdmin.storage
        .from(doc.storage_bucket)
        .remove([doc.storage_key]);

      if (removeError) {
        return {
          error: "Error al limpiar archivo con tipo MIME no permitido.",
        };
      }

      const { error: completeErr } = await supabaseAdmin.rpc(
        "complete_document_cleanup_privileged",
        {
          p_document_id: doc.id,
          p_user_id: user.id,
          p_status: "REJECTED",
          p_error_code: "INVALID_MIME_TYPE",
        }
      );
      if (completeErr) {
        return { error: "Error al registrar rechazo del documento." };
      }

      return {
        error: "Tipo de archivo no permitido. Solo se aceptan archivos PDF.",
      };
    }

    // P1: Bounded range read (5 bytes)
    let isValidPdf = false;
    try {
      const { data: signed, error: signErr } = await supabaseAdmin.storage
        .from(doc.storage_bucket)
        .createSignedUrl(doc.storage_key, 60);

      if (signErr || !signed?.signedUrl) {
        return {
          error:
            "Error temporal de almacenamiento al verificar el archivo. Intenta nuevamente.",
        };
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      let rangeRes: Response;
      try {
        rangeRes = await fetch(signed.signedUrl, {
          headers: { Range: "bytes=0-4" },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      // P1: Bounded range read: MUST return HTTP 206 Partial Content
      if (rangeRes.status !== 206) {
        return {
          error:
            "Error temporal de validación al verificar el archivo. Intenta nuevamente.",
        };
      }

      const rangeBuffer = await rangeRes.arrayBuffer();
      // P1: Enforce byteLength <= 5
      if (rangeBuffer.byteLength > 5) {
        return {
          error:
            "Error temporal de validación al verificar el archivo. Intenta nuevamente.",
        };
      }

      if (rangeBuffer.byteLength < 5) {
        isValidPdf = false;
      } else {
        const rangeBytes = new Uint8Array(rangeBuffer);
        isValidPdf = validatePdfMagicBytes(rangeBytes);
      }
    } catch (fetchErr: unknown) {
      const err = fetchErr as { name?: string };
      if (err?.name === "AbortError" || err?.name === "TimeoutError") {
        return {
          error:
            "Tiempo de espera agotado al verificar el archivo. Intenta nuevamente.",
        };
      }
      return {
        error:
          "Error temporal de red al verificar el archivo. Intenta nuevamente.",
      };
    }

    if (!isValidPdf) {
      const { error: startErr } = await supabaseAdmin.rpc(
        "start_document_cleanup_privileged",
        {
          p_document_id: doc.id,
          p_user_id: user.id,
        }
      );
      if (startErr) {
        return { error: "Error al registrar estado de limpieza." };
      }

      const { error: removeError } = await supabaseAdmin.storage
        .from(doc.storage_bucket)
        .remove([doc.storage_key]);

      if (removeError) {
        return {
          error: "Error al limpiar archivo con firma PDF inválida.",
        };
      }

      const { error: completeErr } = await supabaseAdmin.rpc(
        "complete_document_cleanup_privileged",
        {
          p_document_id: doc.id,
          p_user_id: user.id,
          p_status: "REJECTED",
          p_error_code: "INVALID_PDF_SIGNATURE",
        }
      );
      if (completeErr) {
        return { error: "Error al registrar rechazo del documento." };
      }

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
 * P0: Authenticated user cannot call archive transition directly.
 * Server Action verifies ownership, performs physical Storage cleanup with explicit error check,
 * and only on confirmed deletion invokes privileged archive RPC.
 * P1: Idempotent - retries or already-archived states return success cleanly.
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

    // Retrieve document to get storage key and verify ownership (including already archived)
    const { data: doc, error: docError } = await supabase
      .from("documents")
      .select("id, storage_bucket, storage_key, user_id, status, archived_at")
      .eq("id", parsed.data.documentId)
      .eq("user_id", user.id)
      .single();

    if (docError || !doc) {
      return { error: "Documento no encontrado o acceso no autorizado." };
    }

    // P1 Idempotency: If already archived, check if physical blob is absent
    if (doc.archived_at !== null) {
      const { data: infoData, error: infoError } = await supabaseAdmin.storage
        .from(doc.storage_bucket)
        .info(doc.storage_key);

      if (infoError) {
        if (isStorageNotFoundError(infoError)) {
          // Blob already removed and record archived: return success
          return { data: true };
        }
        return {
          error:
            "Error temporal de almacenamiento al verificar el archivo archivado.",
        };
      }

      if (!infoData) {
        // Blob already removed and record archived: return success
        return { data: true };
      }

      // If blob is still present, attempt removal
      const { error: retryRemoveError } = await supabaseAdmin.storage
        .from(doc.storage_bucket)
        .remove([doc.storage_key]);

      if (retryRemoveError) {
        return {
          error: "No se pudo eliminar el archivo físico del almacenamiento.",
        };
      }

      return { data: true };
    }

    // P0: Close archive / upload TOCTOU race.
    // If document status is UPLOADING, close browser upload authority BEFORE physical deletion:
    // 1. invoke start_document_cleanup_privileged()
    // 2. verify RPC success -> status is now CLEANUP_PENDING
    // 3. Storage INSERT RLS now denies any further upload
    if (doc.status === "UPLOADING") {
      const { error: startErr } = await supabaseAdmin.rpc(
        "start_document_cleanup_privileged",
        {
          p_document_id: doc.id,
          p_user_id: user.id,
        }
      );
      if (startErr) {
        return { error: "Error al preparar la eliminación del documento." };
      }
    }

    // P0: Physically remove storage object through official Storage API with explicit error check
    const { error: removeError } = await supabaseAdmin.storage
      .from(doc.storage_bucket)
      .remove([doc.storage_key]);

    if (removeError) {
      // If removal fails, do NOT mark archived and do NOT free quota
      return {
        error: "No se pudo eliminar el archivo físico del almacenamiento.",
      };
    }

    // P0: Privileged server-only archive RPC invoked ONLY after physical removal confirmed
    const { data: archiveSuccess, error: archiveError } =
      await supabaseAdmin.rpc("archive_document_privileged", {
        p_document_id: doc.id,
        p_user_id: user.id,
      });

    if (archiveError || !archiveSuccess) {
      return { error: "No se pudo actualizar el registro de archivo." };
    }

    return { data: true };
  } catch {
    return { error: "Error inesperado al archivar el documento." };
  }
}
