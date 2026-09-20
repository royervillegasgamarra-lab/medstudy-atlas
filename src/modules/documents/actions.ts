"use server";

import { revalidatePath } from "next/cache";
import {
  requestDocumentUpload,
  finalizeDocumentUpload,
  getAuthorizedDocumentUrl,
  archiveDocument as archiveDocumentService,
} from "./service";
import type { RequestUploadInput } from "./types";

export interface ActionResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Server action to request document upload authorization and create initial record.
 */
export async function requestDocumentUploadAction(
  input: RequestUploadInput
): Promise<
  ActionResult<{
    documentId: string;
    storageBucket: string;
    storageKey: string;
  }>
> {
  const result = await requestDocumentUpload(input);

  if (result.error) {
    return { success: false, error: result.error };
  }

  return { success: true, data: result.data };
}

/**
 * Server action to finalize document upload after storage PUT completes.
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
 * Server action to archive a document.
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
