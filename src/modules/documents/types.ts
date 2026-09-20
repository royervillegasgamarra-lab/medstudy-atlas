/**
 * Document domain types for MedStudy Atlas.
 * Phase 1C: Document Library & Secure Upload.
 */

export type DocumentStatus =
  "UPLOADING" | "VALIDATING" | "READY" | "REJECTED" | "FAILED";

export interface DocumentRecord {
  id: string;
  user_id: string;
  subject_id: string | null;
  original_filename: string;
  storage_provider: string;
  storage_bucket: string;
  storage_key: string;
  mime_type: string;
  size_bytes: number;
  status: DocumentStatus;
  validation_error_code: string | null;
  sha256_hash: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface DocumentWithSubject extends DocumentRecord {
  subject?: {
    id: string;
    name: string;
  } | null;
}

export interface RequestUploadInput {
  original_filename: string;
  size_bytes: number;
  mime_type?: string;
  subject_id?: string | null;
}

export interface RequestUploadResult {
  documentId: string;
  storageBucket: string;
  storageKey: string;
}

export interface FinalizeUploadInput {
  documentId: string;
}

export interface DocumentQuotaUsage {
  activeDocumentsCount: number;
  maxActiveDocuments: number;
  totalSizeBytes: number;
  maxTotalBytes: number;
}
