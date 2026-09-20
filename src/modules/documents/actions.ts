"use server";

import { revalidatePath } from "next/cache";
import {
  requestDocumentUpload,
  finalizeDocumentUpload,
  getAuthorizedDocumentUrl,
  archiveDocument as archiveDocumentService,
  getDocumentQuotaUsage,
  retryDocumentProcessing,
} from "./service";
import type {
  RequestUploadInput,
  RequestUploadResult,
  DocumentQuotaUsage,
} from "./types";

export interface ActionResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Server action to request document upload authorization and create initial record.
 * P0: Returns documentId, storageBucket, and storageKey for direct authenticated upload.
 */
export async function requestDocumentUploadAction(
  input: RequestUploadInput
): Promise<ActionResult<RequestUploadResult>> {
  const result = await requestDocumentUpload(input);

  if (result.error || !result.data) {
    return {
      success: false,
      error: result.error || "Error al solicitar subida.",
    };
  }

  return { success: true, data: result.data };
}

/**
 * Server action to authoritatively finalize document upload after storage PUT completes.
 * P0-1 & P0-7: Authenticated browsers request server-side finalization.
 */
export async function finalizeDocumentUploadAction(
  documentId: string
): Promise<ActionResult> {
  const result = await finalizeDocumentUpload({ documentId });

  if (result.error) {
    return { success: false, error: result.error };
  }

  revalidatePath("/app/documents");
  revalidatePath("/app");
  return { success: true, data: result.data };
}

/**
 * Server action to generate short-lived signed access URL for viewing/downloading a document.
 * P0-3: 300s TTL signed download URL.
 */
export async function getAuthorizedDocumentUrlAction(
  documentId: string
): Promise<ActionResult<{ signedUrl: string }>> {
  const result = await getAuthorizedDocumentUrl(documentId);

  if (result.error) {
    return { success: false, error: result.error };
  }

  return { success: true, data: result.data };
}

/**
 * Server action to archive a document and remove physical storage object.
 * P0-6: Real storage deletion before setting archived_at.
 */
export async function archiveDocumentAction(
  documentId: string
): Promise<ActionResult> {
  const result = await archiveDocumentService(documentId);

  if (result.error) {
    return { success: false, error: result.error };
  }

  revalidatePath("/app/documents");
  revalidatePath("/app");
  return { success: true, data: result.data };
}

/**
 * Server action to retrieve authoritative current document quota usage.
 */
export async function getDocumentQuotaAction(): Promise<
  ActionResult<DocumentQuotaUsage>
> {
  const result = await getDocumentQuotaUsage();

  if (result.error || !result.data) {
    return { success: false, error: result.error || "Error al obtener cuota." };
  }

  return { success: true, data: result.data };
}

/**
 * Server action to retry document processing for a failed processing run.
 */
export async function retryDocumentProcessingAction(
  documentId: string
): Promise<ActionResult> {
  const result = await retryDocumentProcessing(documentId);

  if (result.error) {
    return { success: false, error: result.error };
  }

  revalidatePath("/app/documents");
  revalidatePath("/app");
  return { success: true, data: result.data };
}
