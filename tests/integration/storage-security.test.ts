import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  requestDocumentUpload,
  finalizeDocumentUpload,
  getAuthorizedDocumentUrl,
  archiveDocument,
  getDocumentQuotaUsage,
} from "@/modules/documents/service";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Load local environment variables if available
if (typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // Ignore if not present
  }
}

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
if (!SUPABASE_SECRET_KEY) {
  throw new Error("Missing required environment variable: SUPABASE_SECRET_KEY");
}
const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!SUPABASE_PUBLISHABLE_KEY) {
  throw new Error(
    "Missing required environment variable: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
  );
}

// Mock @/lib/supabase/server so service functions use our authenticated test clients
let currentClient: SupabaseClient<Database>;
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => currentClient),
}));

describe("Authoritative Supabase Storage API Integration & Security Boundary (Phase 1C)", () => {
  let adminClient: SupabaseClient<Database>;
  let aliceClient: SupabaseClient<Database>;
  let bobClient: SupabaseClient<Database>;
  let aliceUserId: string;
  let bobUserId: string;
  let aliceSubjectId: string;

  const timestamp = Date.now();
  const aliceEmail = `alice.storage.${timestamp}@test.local`;
  const bobEmail = `bob.storage.${timestamp}@test.local`;
  const testPassword = "Password123!";

  beforeAll(async () => {
    // 1. Privileged admin client
    adminClient = createClient<Database>(SUPABASE_URL, SUPABASE_SECRET_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    // 2. Create Alice and Bob test users
    const { data: aliceUser, error: aliceCreateError } =
      await adminClient.auth.admin.createUser({
        email: aliceEmail,
        password: testPassword,
        email_confirm: true,
      });
    expect(aliceCreateError).toBeNull();
    aliceUserId = aliceUser.user!.id;

    const { data: bobUser, error: bobCreateError } =
      await adminClient.auth.admin.createUser({
        email: bobEmail,
        password: testPassword,
        email_confirm: true,
      });
    expect(bobCreateError).toBeNull();
    bobUserId = bobUser.user!.id;

    // 3. Create authenticated clients for Alice and Bob
    aliceClient = createClient<Database>(
      SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      }
    );
    const { error: aliceSignInError } =
      await aliceClient.auth.signInWithPassword({
        email: aliceEmail,
        password: testPassword,
      });
    expect(aliceSignInError).toBeNull();

    bobClient = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
    const { error: bobSignInError } = await bobClient.auth.signInWithPassword({
      email: bobEmail,
      password: testPassword,
    });
    expect(bobSignInError).toBeNull();

    // Default current client to Alice
    currentClient = aliceClient;

    // 4. Create Alice subject
    const { data: subjectData, error: subjectError } = await aliceClient
      .from("subjects")
      .insert({
        user_id: aliceUserId,
        name: "Anatomía de Alice",
      })
      .select("id")
      .single();

    expect(subjectError).toBeNull();
    aliceSubjectId = subjectData!.id;
  });

  afterAll(async () => {
    // Cleanup Alice and Bob users (cascades database tables)
    if (adminClient) {
      if (aliceUserId) {
        await adminClient.auth.admin.deleteUser(aliceUserId);
      }
      if (bobUserId) {
        await adminClient.auth.admin.deleteUser(bobUserId);
      }
    }
  });

  it("1. Direct unauthorized Storage upload is strictly denied (P0-3)", async () => {
    const directUploadPath = `${aliceUserId}/unauthorized.pdf`;
    const { data, error } = await aliceClient.storage
      .from("documents")
      .upload(directUploadPath, Buffer.from("%PDF-1.4 test direct"), {
        contentType: "application/pdf",
      });

    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/violates row-level security|AccessDenied/i);
  });

  it("2. Arbitrary unreserved path upload is denied even with authenticated user (P0-3)", async () => {
    const arbitraryPath = `${aliceUserId}/random/nested/arbitrary.pdf`;
    const { data, error } = await aliceClient.storage
      .from("documents")
      .upload(arbitraryPath, Buffer.from("%PDF-1.4 arbitrary"), {
        contentType: "application/pdf",
      });

    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });

  it("3. Exact reserved upload succeeds, creates physical object, transitions to READY, authorized download works (P0)", async () => {
    const validPdfContent = Buffer.from(
      "%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF"
    );
    const declaredSize = validPdfContent.length;

    // Step A: Request upload reservation via Alice's session
    const { data: rpcData, error: rpcError } = await aliceClient.rpc(
      "request_document_upload",
      {
        p_original_filename: "atlas_anatomia.pdf",
        p_size_bytes: declaredSize,
        p_mime_type: "application/pdf",
        p_subject_id: aliceSubjectId,
      }
    );

    expect(rpcError).toBeNull();
    const docRecord = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    expect(docRecord).toBeDefined();
    if (!docRecord) throw new Error("Expected docRecord to be returned");
    expect(docRecord.document_id).toBeDefined();
    expect(docRecord.storage_key).toBe(
      `${aliceUserId}/${docRecord.document_id}/source.pdf`
    );

    // Step B: Direct authenticated upload backed by Storage RLS
    const { data: uploadData, error: uploadError } = await aliceClient.storage
      .from(docRecord.storage_bucket)
      .upload(docRecord.storage_key, validPdfContent, {
        contentType: "application/pdf",
        upsert: false,
      });

    expect(uploadError).toBeNull();
    expect(uploadData?.path).toBe(docRecord.storage_key);

    // Step C: Physical object exists in storage
    const { data: infoData, error: infoError } = await adminClient.storage
      .from(docRecord.storage_bucket)
      .info(docRecord.storage_key);

    expect(infoError).toBeNull();
    expect(infoData).toBeDefined();
    expect(infoData?.size).toBe(declaredSize);
    expect(infoData?.contentType).toBe("application/pdf");

    // Step D: Privileged server-only finalization marks READY
    const { data: finalizeData, error: finalizeError } = await adminClient.rpc(
      "finalize_document_upload_privileged",
      {
        p_document_id: docRecord.document_id,
        p_user_id: aliceUserId,
        p_actual_size: declaredSize,
      }
    );

    expect(finalizeError).toBeNull();
    expect(finalizeData?.status).toBe("READY");

    // Step E: Verify signed download works for owner
    const { data: downloadSigned, error: downloadError } =
      await adminClient.storage
        .from(docRecord.storage_bucket)
        .createSignedUrl(docRecord.storage_key, 300);

    expect(downloadError).toBeNull();
    expect(downloadSigned?.signedUrl).toBeDefined();

    const res = await fetch(downloadSigned!.signedUrl);
    expect(res.ok).toBe(true);
    const downloadedBuffer = Buffer.from(await res.arrayBuffer());
    expect(downloadedBuffer.toString()).toBe(validPdfContent.toString());

    // Cleanup
    await adminClient.storage
      .from(docRecord.storage_bucket)
      .remove([docRecord.storage_key]);
    await adminClient
      .from("documents")
      .delete()
      .eq("id", docRecord.document_id);
  });

  it("4. Re-upload to SAME storage key after delete is DENIED by Storage RLS (proves token reuse impossible) (P0)", async () => {
    const validPdfContent = Buffer.from(
      "%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF"
    );
    const declaredSize = validPdfContent.length;

    // Step A: Reserve and upload initial document
    const { data: rpcData, error: rpcError } = await aliceClient.rpc(
      "request_document_upload",
      {
        p_original_filename: "reuse_test.pdf",
        p_size_bytes: declaredSize,
        p_mime_type: "application/pdf",
        p_subject_id: aliceSubjectId,
      }
    );
    expect(rpcError).toBeNull();
    const docRecord = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    if (!docRecord) throw new Error("Expected docRecord");

    // First upload succeeds
    const { error: uploadErr1 } = await aliceClient.storage
      .from(docRecord.storage_bucket)
      .upload(docRecord.storage_key, validPdfContent, {
        contentType: "application/pdf",
        upsert: false,
      });
    expect(uploadErr1).toBeNull();

    // Step B: Delete physical object
    const { error: removeErr } = await adminClient.storage
      .from(docRecord.storage_bucket)
      .remove([docRecord.storage_key]);
    expect(removeErr).toBeNull();

    // Step C: Document is transitioned to REJECTED via safe cleanup
    await adminClient.rpc("start_document_cleanup_privileged", {
      p_document_id: docRecord.document_id,
      p_user_id: aliceUserId,
    });
    await adminClient.rpc("complete_document_cleanup_privileged", {
      p_document_id: docRecord.document_id,
      p_user_id: aliceUserId,
      p_status: "REJECTED",
      p_error_code: "OBJECT_REMOVED",
    });

    // Step D: Re-upload attempt to SAME key: DENIED by Storage RLS!
    // In the old architecture, a signed-upload token was reusable after delete.
    // In our reservation-backed architecture, Storage RLS immediately rejects because status != 'UPLOADING'.
    const { data: reuploadData, error: reuploadErr } = await aliceClient.storage
      .from(docRecord.storage_bucket)
      .upload(docRecord.storage_key, validPdfContent, {
        contentType: "application/pdf",
        upsert: false,
      });

    expect(reuploadData).toBeNull();
    expect(reuploadErr).not.toBeNull();
    expect(reuploadErr?.message).toMatch(
      /violates row-level security|AccessDenied/i
    );

    // Cleanup doc
    await adminClient
      .from("documents")
      .delete()
      .eq("id", docRecord.document_id);
  });

  it("5. Upload to storage key with status CLEANUP_PENDING is DENIED by Storage RLS (P0)", async () => {
    const { data: rpcData } = await aliceClient.rpc("request_document_upload", {
      p_original_filename: "cleanup_pending_rls.pdf",
      p_size_bytes: 1024,
      p_mime_type: "application/pdf",
      p_subject_id: aliceSubjectId,
    });
    const docRecord = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    if (!docRecord) throw new Error("Expected docRecord");

    // Transition to CLEANUP_PENDING
    await adminClient.rpc("start_document_cleanup_privileged", {
      p_document_id: docRecord.document_id,
      p_user_id: aliceUserId,
    });

    // Upload attempt must fail
    const { data, error } = await aliceClient.storage
      .from(docRecord.storage_bucket)
      .upload(docRecord.storage_key, Buffer.from("%PDF-1.4 test"), {
        contentType: "application/pdf",
        upsert: false,
      });

    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/violates row-level security|AccessDenied/i);

    // Cleanup
    await adminClient
      .from("documents")
      .delete()
      .eq("id", docRecord.document_id);
  });

  it("6. Upload to storage key with status READY is DENIED by Storage RLS (P0)", async () => {
    const validPdf = Buffer.from("%PDF-1.4 ready test\ntrailer\n%%EOF");
    const { data: rpcData } = await aliceClient.rpc("request_document_upload", {
      p_original_filename: "ready_rls.pdf",
      p_size_bytes: validPdf.length,
      p_mime_type: "application/pdf",
      p_subject_id: aliceSubjectId,
    });
    const docRecord = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    if (!docRecord) throw new Error("Expected docRecord");

    // Upload and finalize to READY
    await aliceClient.storage
      .from(docRecord.storage_bucket)
      .upload(docRecord.storage_key, validPdf, {
        contentType: "application/pdf",
        upsert: false,
      });

    await adminClient.rpc("finalize_document_upload_privileged", {
      p_document_id: docRecord.document_id,
      p_user_id: aliceUserId,
      p_actual_size: validPdf.length,
    });

    // Attempt second upload to SAME key while status is READY
    const { data, error } = await aliceClient.storage
      .from(docRecord.storage_bucket)
      .upload(docRecord.storage_key, validPdf, {
        contentType: "application/pdf",
        upsert: false,
      });

    expect(data).toBeNull();
    expect(error).not.toBeNull();

    // Cleanup
    await adminClient.storage
      .from(docRecord.storage_bucket)
      .remove([docRecord.storage_key]);
    await adminClient
      .from("documents")
      .delete()
      .eq("id", docRecord.document_id);
  });

  it("7. Upload to storage key with status REJECTED is DENIED by Storage RLS (P0)", async () => {
    const docId = "44444444-4444-4444-4444-444444444444";
    const key = `${aliceUserId}/${docId}/source.pdf`;

    await adminClient.from("documents").insert({
      id: docId,
      user_id: aliceUserId,
      subject_id: aliceSubjectId,
      original_filename: "rejected.pdf",
      storage_key: key,
      mime_type: "application/pdf",
      size_bytes: 1024,
      status: "REJECTED",
    });

    const { data, error } = await aliceClient.storage
      .from("documents")
      .upload(key, Buffer.from("%PDF-1.4 test"), {
        contentType: "application/pdf",
        upsert: false,
      });

    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/violates row-level security|AccessDenied/i);

    await adminClient.from("documents").delete().eq("id", docId);
  });

  it("8. Upload to storage key with status FAILED is DENIED by Storage RLS (P0)", async () => {
    const docId = "55555555-5555-5555-5555-555555555555";
    const key = `${aliceUserId}/${docId}/source.pdf`;

    await adminClient.from("documents").insert({
      id: docId,
      user_id: aliceUserId,
      subject_id: aliceSubjectId,
      original_filename: "failed.pdf",
      storage_key: key,
      mime_type: "application/pdf",
      size_bytes: 1024,
      status: "FAILED",
    });

    const { data, error } = await aliceClient.storage
      .from("documents")
      .upload(key, Buffer.from("%PDF-1.4 test"), {
        contentType: "application/pdf",
        upsert: false,
      });

    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/violates row-level security|AccessDenied/i);

    await adminClient.from("documents").delete().eq("id", docId);
  });

  it("9. Upload to storage key with archived_at IS NOT NULL is DENIED by Storage RLS (P0)", async () => {
    const docId = "66666666-6666-6666-6666-666666666666";
    const key = `${aliceUserId}/${docId}/source.pdf`;

    await adminClient.from("documents").insert({
      id: docId,
      user_id: aliceUserId,
      subject_id: aliceSubjectId,
      original_filename: "archived.pdf",
      storage_key: key,
      mime_type: "application/pdf",
      size_bytes: 1024,
      status: "UPLOADING",
      archived_at: new Date().toISOString(),
    });

    const { data, error } = await aliceClient.storage
      .from("documents")
      .upload(key, Buffer.from("%PDF-1.4 test"), {
        contentType: "application/pdf",
        upsert: false,
      });

    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/violates row-level security|AccessDenied/i);

    await adminClient.from("documents").delete().eq("id", docId);
  });

  it("10. Upload to storage key with reservation > 2 hours old is DENIED by Storage RLS (P0)", async () => {
    const docId = "77777777-7777-7777-7777-777777777777";
    const key = `${aliceUserId}/${docId}/source.pdf`;

    await adminClient.from("documents").insert({
      id: docId,
      user_id: aliceUserId,
      subject_id: aliceSubjectId,
      original_filename: "expired_reservation.pdf",
      storage_key: key,
      mime_type: "application/pdf",
      size_bytes: 1024,
      status: "UPLOADING",
      created_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    });

    const { data, error } = await aliceClient.storage
      .from("documents")
      .upload(key, Buffer.from("%PDF-1.4 test"), {
        contentType: "application/pdf",
        upsert: false,
      });

    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/violates row-level security|AccessDenied/i);

    await adminClient.from("documents").delete().eq("id", docId);
  });

  it("11. Two-step cleanup lifecycle: UPLOADING → CLEANUP_PENDING → remove() → REJECTED (P0)", async () => {
    const { data: rpcData } = await aliceClient.rpc("request_document_upload", {
      p_original_filename: "cleanup_lifecycle_reject.pdf",
      p_size_bytes: 1024,
      p_mime_type: "application/pdf",
      p_subject_id: aliceSubjectId,
    });
    const docRecord = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    if (!docRecord) throw new Error("Expected docRecord");

    // Upload invalid content
    await aliceClient.storage
      .from(docRecord.storage_bucket)
      .upload(docRecord.storage_key, Buffer.from("invalid-content"), {
        contentType: "application/pdf",
        upsert: false,
      });

    // Step 1: Transition to CLEANUP_PENDING
    const { data: pendingDoc, error: pendingErr } = await adminClient.rpc(
      "start_document_cleanup_privileged",
      {
        p_document_id: docRecord.document_id,
        p_user_id: aliceUserId,
      }
    );
    expect(pendingErr).toBeNull();
    expect(pendingDoc?.status).toBe("CLEANUP_PENDING");

    // Step 2: Physical Storage remove
    const { error: removeErr } = await adminClient.storage
      .from(docRecord.storage_bucket)
      .remove([docRecord.storage_key]);
    expect(removeErr).toBeNull();

    // Step 3: Complete cleanup to REJECTED
    const { data: rejectedDoc, error: rejectErr } = await adminClient.rpc(
      "complete_document_cleanup_privileged",
      {
        p_document_id: docRecord.document_id,
        p_user_id: aliceUserId,
        p_status: "REJECTED",
        p_error_code: "INVALID_PDF_SIGNATURE",
      }
    );
    expect(rejectErr).toBeNull();
    expect(rejectedDoc?.status).toBe("REJECTED");
    expect(rejectedDoc?.validation_error_code).toBe("INVALID_PDF_SIGNATURE");

    // Verify blob is gone
    const { data: info } = await adminClient.storage
      .from(docRecord.storage_bucket)
      .info(docRecord.storage_key);
    expect(info).toBeNull();

    // Cleanup doc
    await adminClient
      .from("documents")
      .delete()
      .eq("id", docRecord.document_id);
  });

  it("12. Two-step cleanup lifecycle: UPLOADING → CLEANUP_PENDING → remove() → FAILED (P0)", async () => {
    const { data: rpcData } = await aliceClient.rpc("request_document_upload", {
      p_original_filename: "cleanup_lifecycle_failed.pdf",
      p_size_bytes: 1024,
      p_mime_type: "application/pdf",
      p_subject_id: aliceSubjectId,
    });
    const docRecord = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    if (!docRecord) throw new Error("Expected docRecord");

    // Step 1: Transition to CLEANUP_PENDING
    const { data: pendingDoc, error: pendingErr } = await adminClient.rpc(
      "start_document_cleanup_privileged",
      {
        p_document_id: docRecord.document_id,
        p_user_id: aliceUserId,
      }
    );
    expect(pendingErr).toBeNull();
    expect(pendingDoc?.status).toBe("CLEANUP_PENDING");

    // Step 2: Physical remove
    await adminClient.storage
      .from(docRecord.storage_bucket)
      .remove([docRecord.storage_key]);

    // Step 3: Complete cleanup to FAILED
    const { data: failedDoc, error: failErr } = await adminClient.rpc(
      "complete_document_cleanup_privileged",
      {
        p_document_id: docRecord.document_id,
        p_user_id: aliceUserId,
        p_status: "FAILED",
        p_error_code: "UPLOAD_TIMEOUT",
      }
    );
    expect(failErr).toBeNull();
    expect(failedDoc?.status).toBe("FAILED");
    expect(failedDoc?.validation_error_code).toBe("UPLOAD_TIMEOUT");

    // Cleanup doc
    await adminClient
      .from("documents")
      .delete()
      .eq("id", docRecord.document_id);
  });

  it("13. If Storage remove() fails during cleanup, status remains CLEANUP_PENDING and quota remains reserved (P0)", async () => {
    const { data: rpcData } = await aliceClient.rpc("request_document_upload", {
      p_original_filename: "cleanup_fail_preserve_quota.pdf",
      p_size_bytes: 1024,
      p_mime_type: "application/pdf",
      p_subject_id: aliceSubjectId,
    });
    const docRecord = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    if (!docRecord) throw new Error("Expected docRecord");

    // Step 1: Transition to CLEANUP_PENDING
    await adminClient.rpc("start_document_cleanup_privileged", {
      p_document_id: docRecord.document_id,
      p_user_id: aliceUserId,
    });

    // Simulate Storage remove() failure: complete_document_cleanup_privileged is NOT called
    // Invariant: Status remains CLEANUP_PENDING in DB
    const { data: docInDb } = await adminClient
      .from("documents")
      .select("status")
      .eq("id", docRecord.document_id)
      .single();
    expect(docInDb?.status).toBe("CLEANUP_PENDING");

    // Cleanup
    await adminClient
      .from("documents")
      .delete()
      .eq("id", docRecord.document_id);
  });

  it("14. Stale upload lazy cleanup physically deletes object before marking FAILED (P0)", async () => {
    const staleDocId = "88888888-8888-8888-8888-888888888888";
    const staleKey = `${aliceUserId}/${staleDocId}/source.pdf`;

    // Insert stale document record (> 2 hours old)
    await adminClient.from("documents").insert({
      id: staleDocId,
      user_id: aliceUserId,
      subject_id: aliceSubjectId,
      original_filename: "stale_blob.pdf",
      storage_key: staleKey,
      mime_type: "application/pdf",
      size_bytes: 1024,
      status: "UPLOADING",
      created_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    });

    // Upload physical blob to storage for this stale doc
    await adminClient.storage
      .from("documents")
      .upload(staleKey, Buffer.from("%PDF-1.4 stale content"), {
        contentType: "application/pdf",
        upsert: true,
      });

    // Verify blob exists before lazy cleanup
    const { data: infoBefore } = await adminClient.storage
      .from("documents")
      .info(staleKey);
    expect(infoBefore).not.toBeNull();

    // Call application requestDocumentUpload (which executes lazy physical cleanup)
    currentClient = aliceClient;
    const reqRes = await requestDocumentUpload({
      original_filename: "new_after_stale.pdf",
      size_bytes: 1024,
      mime_type: "application/pdf",
      subject_id: aliceSubjectId,
    });

    expect(reqRes.error).toBeUndefined();
    expect(reqRes.data?.documentId).toBeDefined();

    // Verify stale doc has been physically removed from storage
    const { data: infoAfter } = await adminClient.storage
      .from("documents")
      .info(staleKey);
    expect(infoAfter).toBeNull();

    // Verify stale doc DB status is FAILED (UPLOAD_TIMEOUT)
    const { data: staleInDb } = await adminClient
      .from("documents")
      .select("status, validation_error_code")
      .eq("id", staleDocId)
      .single();
    expect(staleInDb?.status).toBe("FAILED");
    expect(staleInDb?.validation_error_code).toBe("UPLOAD_TIMEOUT");

    // Cleanup
    await adminClient
      .from("documents")
      .delete()
      .in("id", [staleDocId, reqRes.data!.documentId]);
  });

  it("15. Worst-case in-flight quota: 4 active UPLOADING rows (25 MB each) reject 5th upload even if declared 1 byte (P0)", async () => {
    // Insert 4 active UPLOADING documents for Alice.
    // In-flight quota reserves 25 MB (26,214,400 bytes) for EACH UPLOADING row.
    // 4 rows * 25 MB = 100 MB total (the full quota limit).
    const docIds: string[] = [];
    for (let i = 1; i <= 4; i++) {
      const id = `99999999-0000-0000-0000-00000000000${i}`;
      await adminClient.from("documents").insert({
        id,
        user_id: aliceUserId,
        subject_id: aliceSubjectId,
        original_filename: `quota_reserve_${i}.pdf`,
        storage_key: `${aliceUserId}/${id}/source.pdf`,
        mime_type: "application/pdf",
        size_bytes: 1024, // Declared small, but reserves 25 MB in-flight!
        status: "UPLOADING",
      });
      docIds.push(id);
    }

    // Now Alice attempts to request a 5th upload, declaring ONLY 1 BYTE.
    // Even though declared size is 1 byte, worst-case accounting rejects because
    // (100 MB reserved + 25 MB worst-case for new upload) > 100 MB max total bytes.
    const { data, error } = await aliceClient.rpc("request_document_upload", {
      p_original_filename: "bypass_attempt.pdf",
      p_size_bytes: 1,
      p_mime_type: "application/pdf",
      p_subject_id: aliceSubjectId,
    });

    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error?.code).toBe("23514"); // Quota exceeded!

    // Cleanup
    await adminClient.from("documents").delete().in("id", docIds);
  });

  it("16. Storage 5xx error during finalizeDocumentUpload returns transient error without rejecting or deleting blob (P0)", async () => {
    const validPdf = Buffer.from(
      "%PDF-1.4 5xx test\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF"
    );
    const { data: rpcData } = await aliceClient.rpc("request_document_upload", {
      p_original_filename: "storage_5xx_test.pdf",
      p_size_bytes: validPdf.length,
      p_mime_type: "application/pdf",
      p_subject_id: aliceSubjectId,
    });
    const docRecord = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    if (!docRecord) throw new Error("Expected docRecord");

    // Upload physical object
    await aliceClient.storage
      .from(docRecord.storage_bucket)
      .upload(docRecord.storage_key, validPdf, {
        contentType: "application/pdf",
        upsert: false,
      });

    // Mock storage.info to simulate a 500 Internal Server Error
    const realFrom16 = supabaseAdmin.storage.from.bind(supabaseAdmin.storage);
    const fromSpy16 = vi
      .spyOn(supabaseAdmin.storage, "from")
      .mockImplementation((bucket: string) => {
        const fileApi = realFrom16(bucket);
        return {
          ...fileApi,
          info: vi.fn().mockResolvedValue({
            data: null,
            error: {
              name: "StorageApiError",
              message: "Internal Server Error",
              status: 500,
              statusCode: "500",
            },
          }),
        } as unknown as ReturnType<typeof realFrom16>;
      });

    currentClient = aliceClient;
    const finalizeRes = await finalizeDocumentUpload({
      documentId: docRecord.document_id,
    });

    fromSpy16.mockRestore();

    // P0: Must return recoverable error
    expect(finalizeRes.error).toContain(
      "Error temporal de almacenamiento al verificar el archivo"
    );

    // Verify DB status is STILL UPLOADING (not REJECTED, not CLEANUP_PENDING)
    const { data: docInDb } = await adminClient
      .from("documents")
      .select("status")
      .eq("id", docRecord.document_id)
      .single();
    expect(docInDb?.status).toBe("UPLOADING");

    // Verify physical blob was NOT deleted
    const { data: infoCheck } = await adminClient.storage
      .from(docRecord.storage_bucket)
      .info(docRecord.storage_key);
    expect(infoCheck).not.toBeNull();

    // Cleanup
    await adminClient.storage
      .from(docRecord.storage_bucket)
      .remove([docRecord.storage_key]);
    await adminClient
      .from("documents")
      .delete()
      .eq("id", docRecord.document_id);
  });

  it("17. Bounded range read enforces HTTP 206, byteLength <= 5, and timeout; HTTP 200 fails safely (P1)", async () => {
    const validPdf = Buffer.from(
      "%PDF-1.4 range test\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF"
    );
    const { data: rpcData } = await aliceClient.rpc("request_document_upload", {
      p_original_filename: "bounded_range_test.pdf",
      p_size_bytes: validPdf.length,
      p_mime_type: "application/pdf",
      p_subject_id: aliceSubjectId,
    });
    const docRecord = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    if (!docRecord) throw new Error("Expected docRecord");

    await aliceClient.storage
      .from(docRecord.storage_bucket)
      .upload(docRecord.storage_key, validPdf, {
        contentType: "application/pdf",
        upsert: false,
      });

    currentClient = aliceClient;

    // Case A: Server returns HTTP 200 (ignored Range header, attempted full 25 MB stream)
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation(async (url, init) => {
      const headers = init?.headers as Record<string, string> | undefined;
      if (headers?.Range === "bytes=0-4" || headers?.range === "bytes=0-4") {
        return new Response(new ArrayBuffer(25 * 1024 * 1024), {
          status: 200,
          headers: { "Content-Type": "application/pdf" },
        });
      }
      return originalFetch(url, init);
    });

    const res200 = await finalizeDocumentUpload({
      documentId: docRecord.document_id,
    });
    expect(res200.error).toContain("Error temporal de validación");

    // Verify document was NOT rejected and blob was NOT deleted
    const { data: doc200 } = await adminClient
      .from("documents")
      .select("status")
      .eq("id", docRecord.document_id)
      .single();
    expect(doc200?.status).toBe("UPLOADING");

    // Case B: Fetch timeout / AbortError
    global.fetch = vi.fn().mockImplementation(async (url, init) => {
      const headers = init?.headers as Record<string, string> | undefined;
      if (headers?.Range === "bytes=0-4" || headers?.range === "bytes=0-4") {
        const err = new Error("The operation was aborted.");
        err.name = "AbortError";
        throw err;
      }
      return originalFetch(url, init);
    });

    const resTimeout = await finalizeDocumentUpload({
      documentId: docRecord.document_id,
    });
    expect(resTimeout.error).toContain("Tiempo de espera agotado");

    // Restore fetch
    global.fetch = originalFetch;

    // Cleanup
    await adminClient.storage
      .from(docRecord.storage_bucket)
      .remove([docRecord.storage_key]);
    await adminClient
      .from("documents")
      .delete()
      .eq("id", docRecord.document_id);
  });

  it("18. Authenticated user cannot call any privileged RPC directly (finalize, archive, start_cleanup, complete_cleanup) (P0)", async () => {
    const fakeDocId = "11111111-1111-1111-1111-111111111111";

    // 1. finalize_document_upload_privileged
    const { error: err1 } = await aliceClient.rpc(
      "finalize_document_upload_privileged" as unknown as "request_document_upload",
      {
        p_document_id: fakeDocId,
        p_user_id: aliceUserId,
        p_actual_size: 1024,
      } as unknown as { p_original_filename: string; p_size_bytes: number }
    );
    expect(err1).not.toBeNull();
    expect(err1?.code).toBe("42501");

    // 2. archive_document_privileged
    const { error: err2 } = await aliceClient.rpc(
      "archive_document_privileged" as unknown as "request_document_upload",
      {
        p_document_id: fakeDocId,
        p_user_id: aliceUserId,
      } as unknown as { p_original_filename: string; p_size_bytes: number }
    );
    expect(err2).not.toBeNull();
    expect(err2?.code).toBe("42501");

    // 3. start_document_cleanup_privileged
    const { error: err3 } = await aliceClient.rpc(
      "start_document_cleanup_privileged" as unknown as "request_document_upload",
      {
        p_document_id: fakeDocId,
        p_user_id: aliceUserId,
      } as unknown as { p_original_filename: string; p_size_bytes: number }
    );
    expect(err3).not.toBeNull();
    expect(err3?.code).toBe("42501");

    // 4. complete_document_cleanup_privileged
    const { error: err4 } = await aliceClient.rpc(
      "complete_document_cleanup_privileged" as unknown as "request_document_upload",
      {
        p_document_id: fakeDocId,
        p_user_id: aliceUserId,
        p_status: "REJECTED",
        p_error_code: "TEST",
      } as unknown as { p_original_filename: string; p_size_bytes: number }
    );
    expect(err4).not.toBeNull();
    expect(err4?.code).toBe("42501");
  });

  it("19. Storage deletion failure on archive does NOT free quota or mark archived (P0)", async () => {
    const { data: rpcData } = await aliceClient.rpc("request_document_upload", {
      p_original_filename: "archive_fail_test.pdf",
      p_size_bytes: 1024,
      p_mime_type: "application/pdf",
      p_subject_id: aliceSubjectId,
    });
    const docRecord = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    if (!docRecord) throw new Error("Expected docRecord");

    // Simulate Storage remove() failure during archive
    const realFrom19 = supabaseAdmin.storage.from.bind(supabaseAdmin.storage);
    const fromSpy19 = vi
      .spyOn(supabaseAdmin.storage, "from")
      .mockImplementation((bucket: string) => {
        const fileApi = realFrom19(bucket);
        return {
          ...fileApi,
          remove: vi.fn().mockResolvedValue({
            data: null,
            error: {
              name: "StorageApiError",
              message: "Simulated Storage Error",
            },
          }),
        } as unknown as ReturnType<typeof realFrom19>;
      });

    currentClient = aliceClient;
    const archiveRes = await archiveDocument(docRecord.document_id);

    fromSpy19.mockRestore();

    expect(archiveRes.error).toContain(
      "No se pudo eliminar el archivo físico del almacenamiento"
    );

    // Invariant: Because Storage deletion failed, DB record must NOT be archived
    const { data: docInDb } = await adminClient
      .from("documents")
      .select("archived_at, status")
      .eq("id", docRecord.document_id)
      .single();

    expect(docInDb?.archived_at).toBeNull();
    // Invariant: Status transitioned to CLEANUP_PENDING to close upload authority, and remains CLEANUP_PENDING because removal failed
    expect(docInDb?.status).toBe("CLEANUP_PENDING");

    // Cleanup doc
    await adminClient
      .from("documents")
      .delete()
      .eq("id", docRecord.document_id);
  });

  it("20. Cross-user download authorization denied via application boundary (P0)", async () => {
    const content = Buffer.from(
      "%PDF-1.4 Alice confidential document\ntrailer\n%%EOF"
    );
    const { data: rpcData } = await aliceClient.rpc("request_document_upload", {
      p_original_filename: "alice_confidential.pdf",
      p_size_bytes: content.length,
      p_mime_type: "application/pdf",
      p_subject_id: aliceSubjectId,
    });
    const docRecord = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    if (!docRecord) throw new Error("Expected docRecord");

    await aliceClient.storage
      .from(docRecord.storage_bucket)
      .upload(docRecord.storage_key, content, {
        contentType: "application/pdf",
        upsert: false,
      });

    await adminClient.rpc("finalize_document_upload_privileged", {
      p_document_id: docRecord.document_id,
      p_user_id: aliceUserId,
      p_actual_size: content.length,
    });

    // Owner (Alice) downloads successfully through application boundary
    currentClient = aliceClient;
    const aliceDownloadRes = await getAuthorizedDocumentUrl(
      docRecord.document_id
    );
    expect(aliceDownloadRes.error).toBeUndefined();
    expect(aliceDownloadRes.data?.signedUrl).toBeDefined();

    const aliceFetchRes = await fetch(aliceDownloadRes.data!.signedUrl);
    expect(aliceFetchRes.ok).toBe(true);
    const aliceDownloaded = Buffer.from(await aliceFetchRes.arrayBuffer());
    expect(aliceDownloaded.toString()).toBe(content.toString());

    // Bob attempts to get authorized download URL for Alice's document (cross-user DENIED)
    currentClient = bobClient;
    const bobDownloadRes = await getAuthorizedDocumentUrl(
      docRecord.document_id
    );
    expect(bobDownloadRes.error).toContain(
      "Documento no encontrado o acceso no autorizado"
    );

    // Bob cannot query Alice's document in DB (RLS returns empty)
    const { data: bobDocQuery } = await bobClient
      .from("documents")
      .select("id")
      .eq("id", docRecord.document_id);
    expect(bobDocQuery).toHaveLength(0);

    // Bob cannot download physical object directly from storage
    const { data: bobStorageData, error: bobStorageError } =
      await bobClient.storage.from("documents").download(docRecord.storage_key);
    expect(bobStorageData).toBeNull();
    expect(bobStorageError).not.toBeNull();

    // Cleanup
    await adminClient.storage
      .from(docRecord.storage_bucket)
      .remove([docRecord.storage_key]);
    await adminClient
      .from("documents")
      .delete()
      .eq("id", docRecord.document_id);
  });

  it("21. CLEANUP_PENDING recovery: transient remove failure leaves quota reserved, subsequent lazy retry succeeds, removes blob, transitions to FAILED, and frees quota for new upload (P0)", async () => {
    // 1. Create real physical object
    const fakeContent = Buffer.from("NOT_A_VALID_PDF_HEADER");
    const declaredSize = fakeContent.length;

    const { data: rpcData, error: rpcError } = await aliceClient.rpc(
      "request_document_upload",
      {
        p_original_filename: "cleanup_recovery_test.pdf",
        p_size_bytes: declaredSize,
        p_mime_type: "application/pdf",
        p_subject_id: aliceSubjectId,
      }
    );
    expect(rpcError).toBeNull();
    const docRecord = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    if (!docRecord) throw new Error("Expected docRecord");

    const { error: uploadError } = await aliceClient.storage
      .from(docRecord.storage_bucket)
      .upload(docRecord.storage_key, fakeContent, {
        contentType: "application/pdf",
        upsert: false,
      });
    expect(uploadError).toBeNull();

    // Verify physical object exists
    const { data: infoBefore } = await adminClient.storage
      .from(docRecord.storage_bucket)
      .info(docRecord.storage_key);
    expect(infoBefore).not.toBeNull();

    // 2 & 3. Enter CLEANUP_PENDING and simulate first remove failure
    const realFrom21 = supabaseAdmin.storage.from.bind(supabaseAdmin.storage);
    const fromSpy21 = vi
      .spyOn(supabaseAdmin.storage, "from")
      .mockImplementation((bucket: string) => {
        const fileApi = realFrom21(bucket);
        vi.spyOn(fileApi, "remove").mockResolvedValue({
          data: null,
          error: {
            name: "StorageApiError",
            message: "Simulated Transient Storage Error during remove",
          } as unknown as NonNullable<
            Awaited<ReturnType<typeof fileApi.remove>>["error"]
          >,
        });
        return fileApi;
      });

    currentClient = aliceClient;
    const finalizeRes = await finalizeDocumentUpload({
      documentId: docRecord.document_id,
    });
    fromSpy21.mockRestore();

    expect(finalizeRes.error).toContain(
      "Error al limpiar archivo con firma PDF inválida"
    );

    // DB state must be CLEANUP_PENDING
    const { data: docPending } = await adminClient
      .from("documents")
      .select("status")
      .eq("id", docRecord.document_id)
      .single();
    expect(docPending?.status).toBe("CLEANUP_PENDING");

    // Physical blob is still present in storage
    const { data: infoStillPresent } = await adminClient.storage
      .from(docRecord.storage_bucket)
      .info(docRecord.storage_key);
    expect(infoStillPresent).not.toBeNull();

    // 4. Prove quota remains reserved (getDocumentQuotaUsage counts CLEANUP_PENDING as worst-case 25MB)
    const quotaRes1 = await getDocumentQuotaUsage();
    expect(quotaRes1.data?.activeDocumentsCount).toBeGreaterThanOrEqual(1);
    expect(quotaRes1.data?.totalSizeBytes).toBeGreaterThanOrEqual(
      25 * 1024 * 1024
    );

    // 5 & 6. Execute normal recovery path: subsequent requestDocumentUpload triggers lazy retry without error
    const newDocRes = await requestDocumentUpload({
      original_filename: "recovered_and_new.pdf",
      size_bytes: 1024,
      mime_type: "application/pdf",
      subject_id: aliceSubjectId,
    });
    expect(newDocRes.error).toBeUndefined();
    expect(newDocRes.data?.documentId).toBeDefined();

    // 7. Physical object absent (confirmed removed by second remove)
    const { data: infoAfterRecovery } = await adminClient.storage
      .from(docRecord.storage_bucket)
      .info(docRecord.storage_key);
    expect(infoAfterRecovery).toBeNull();

    // 8. Terminal DB state reached (FAILED / CLEANUP_RECOVERED)
    const { data: docRecovered } = await adminClient
      .from("documents")
      .select("status, validation_error_code")
      .eq("id", docRecord.document_id)
      .single();
    expect(docRecovered?.status).toBe("FAILED");
    expect(docRecovered?.validation_error_code).toBe("CLEANUP_RECOVERED");

    // 9. Quota released for the recovered document (now only the newly requested document is active)
    const quotaRes2 = await getDocumentQuotaUsage();
    expect(quotaRes2.data?.activeDocumentsCount).toBe(1);
    expect(quotaRes2.data?.totalSizeBytes).toBe(25 * 1024 * 1024);

    // 10. New upload becomes possible / succeeds
    const validPdf = Buffer.from("%PDF-1.4 recovery test\ntrailer\n%%EOF");
    const { error: newUploadErr } = await aliceClient.storage
      .from(newDocRes.data!.storageBucket)
      .upload(newDocRes.data!.storageKey, validPdf, {
        contentType: "application/pdf",
        upsert: false,
      });
    expect(newUploadErr).toBeNull();

    // Cleanup
    await adminClient.storage
      .from(newDocRes.data!.storageBucket)
      .remove([newDocRes.data!.storageKey]);
    await adminClient
      .from("documents")
      .delete()
      .in("id", [docRecord.document_id, newDocRes.data!.documentId]);
  });

  it("22. Adversarial archive/upload TOCTOU race: upload authority is closed (status=CLEANUP_PENDING) BEFORE physical deletion (P0)", async () => {
    const validContent = Buffer.from(
      "%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF"
    );
    const declaredSize = validContent.length;

    // 1. Create an UPLOADING reservation and upload initial file
    const { data: rpcData, error: rpcError } = await aliceClient.rpc(
      "request_document_upload",
      {
        p_original_filename: "archive_race_test.pdf",
        p_size_bytes: declaredSize,
        p_mime_type: "application/pdf",
        p_subject_id: aliceSubjectId,
      }
    );
    expect(rpcError).toBeNull();
    const docRecord = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    if (!docRecord) throw new Error("Expected docRecord");

    const { error: uploadError } = await aliceClient.storage
      .from(docRecord.storage_bucket)
      .upload(docRecord.storage_key, validContent, {
        contentType: "application/pdf",
        upsert: false,
      });
    expect(uploadError).toBeNull();

    // Verify blob exists
    const { data: infoBefore } = await adminClient.storage
      .from(docRecord.storage_bucket)
      .info(docRecord.storage_key);
    expect(infoBefore).not.toBeNull();

    // 3. Intercept Storage.remove() so archive is held during deletion
    let capturedStatusDuringRemove: string | null = null;
    let raceUploadError: unknown = null;

    const realFrom22 = supabaseAdmin.storage.from.bind(supabaseAdmin.storage);
    const fromSpy22 = vi
      .spyOn(supabaseAdmin.storage, "from")
      .mockImplementation((bucket: string) => {
        const fileApi = realFrom22(bucket);
        const originalRemove = fileApi.remove.bind(fileApi);
        vi.spyOn(fileApi, "remove").mockImplementation(
          async (paths: Parameters<typeof fileApi.remove>[0]) => {
            // 4. While remove is executing, inspect DB state: it must already be CLEANUP_PENDING!
            const { data: docInDb } = await adminClient
              .from("documents")
              .select("status")
              .eq("id", docRecord.document_id)
              .single();
            capturedStatusDuringRemove = docInDb?.status || null;

            // 5. Attempt aliceClient.storage.upload() to the exact reserved key
            const { error: raceErr } = await aliceClient.storage
              .from(bucket)
              .upload(docRecord.storage_key, validContent, {
                contentType: "application/pdf",
                upsert: false,
              });
            raceUploadError = raceErr;

            // 7. Perform real physical remove
            return originalRemove(paths);
          }
        );
        return fileApi;
      });

    // 2. Start archiveDocument()
    currentClient = aliceClient;
    const archiveRes = await archiveDocument(docRecord.document_id);
    fromSpy22.mockRestore();

    // 8. Archive completes
    expect(archiveRes.error).toBeUndefined();
    expect(archiveRes.data).toBe(true);

    // 4. Invariant: Status during remove was CLEANUP_PENDING
    expect(capturedStatusDuringRemove).toBe("CLEANUP_PENDING");

    // 6. Invariant: Upload during remove was DENIED by Storage RLS!
    expect(raceUploadError).not.toBeNull();
    expect((raceUploadError as { message: string })?.message).toMatch(
      /violates row-level security|AccessDenied/i
    );

    // 9. archived_at is set in DB
    const { data: archivedDoc } = await adminClient
      .from("documents")
      .select("archived_at")
      .eq("id", docRecord.document_id)
      .single();
    expect(archivedDoc?.archived_at).not.toBeNull();

    // 10. physical blob is absent
    const { data: infoAfter } = await adminClient.storage
      .from(docRecord.storage_bucket)
      .info(docRecord.storage_key);
    expect(infoAfter).toBeNull();

    // Cleanup
    await adminClient
      .from("documents")
      .delete()
      .eq("id", docRecord.document_id);
  });

  it("23. Real concurrent quota reservation: pg_advisory_xact_lock serializes parallel requests, exactly one succeeds, one fails (P1)", async () => {
    // Setup: Create 3 active UPLOADING documents for Alice (3 * 25 MB = 75 MB reserved)
    const docIds: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const id = `33333333-0000-0000-0000-00000000000${i}`;
      await adminClient.from("documents").insert({
        id,
        user_id: aliceUserId,
        subject_id: aliceSubjectId,
        original_filename: `concurrent_base_${i}.pdf`,
        storage_key: `${aliceUserId}/${id}/source.pdf`,
        mime_type: "application/pdf",
        size_bytes: 1024,
        status: "UPLOADING",
      });
      docIds.push(id);
    }

    // Now Alice issues TWO concurrent requests.
    // Each request needs 25 MB worst-case.
    // Since 75 MB is already reserved:
    // First one to obtain advisory lock will succeed (75 MB + 25 MB = 100 MB <= 100 MB limit).
    // Second one to obtain advisory lock will fail (100 MB + 25 MB = 125 MB > 100 MB limit, error 23514).
    const results = await Promise.allSettled([
      aliceClient.rpc("request_document_upload", {
        p_original_filename: "concurrent_req_A.pdf",
        p_size_bytes: 1024,
        p_mime_type: "application/pdf",
        p_subject_id: aliceSubjectId,
      }),
      aliceClient.rpc("request_document_upload", {
        p_original_filename: "concurrent_req_B.pdf",
        p_size_bytes: 1024,
        p_mime_type: "application/pdf",
        p_subject_id: aliceSubjectId,
      }),
    ]);

    const successes = results.filter(
      (r) => r.status === "fulfilled" && !r.value.error && r.value.data
    );
    const failures = results.filter(
      (r) =>
        r.status === "fulfilled" &&
        r.value.error &&
        r.value.error.code === "23514"
    );

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    // Track the successful doc for cleanup
    const successData =
      successes[0].status === "fulfilled" ? successes[0].value.data : null;
    const successDoc = Array.isArray(successData)
      ? successData[0]
      : successData;
    if (
      successDoc &&
      typeof successDoc === "object" &&
      "document_id" in successDoc
    ) {
      docIds.push((successDoc as { document_id: string }).document_id);
    }

    // Verify total active worst-case reservation in DB is exactly 4 * 25 MB = 100 MB
    const { data: activeDocs } = await adminClient
      .from("documents")
      .select("id, status")
      .eq("user_id", aliceUserId)
      .eq("status", "UPLOADING")
      .is("archived_at", null);

    expect(activeDocs).toHaveLength(4);

    // Cleanup
    await adminClient.from("documents").delete().in("id", docIds);
  });

  it("24. Real size-mismatch storage integration: physical blob is removed, DB marked REJECTED, quota released (P1)", async () => {
    const declaredSize = 1024;
    const actualContent = Buffer.from(
      "%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF"
    );
    expect(actualContent.length).not.toBe(declaredSize);

    // 1. Reserve 1024 bytes
    const { data: rpcData, error: rpcError } = await aliceClient.rpc(
      "request_document_upload",
      {
        p_original_filename: "size_mismatch_real.pdf",
        p_size_bytes: declaredSize,
        p_mime_type: "application/pdf",
        p_subject_id: aliceSubjectId,
      }
    );
    expect(rpcError).toBeNull();
    const docRecord = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    if (!docRecord) throw new Error("Expected docRecord");

    // 2. Physically upload different-size PDF object to exact key
    const { error: uploadError } = await aliceClient.storage
      .from(docRecord.storage_bucket)
      .upload(docRecord.storage_key, actualContent, {
        contentType: "application/pdf",
        upsert: false,
      });
    expect(uploadError).toBeNull();

    // Verify physical object exists before finalization
    const { data: infoBefore } = await adminClient.storage
      .from(docRecord.storage_bucket)
      .info(docRecord.storage_key);
    expect(infoBefore).not.toBeNull();
    expect(infoBefore?.size).toBe(actualContent.length);

    // 3. Invoke normal finalizeDocumentUpload()
    currentClient = aliceClient;
    const finalizeRes = await finalizeDocumentUpload({
      documentId: docRecord.document_id,
    });

    // 4. Verify SIZE_MISMATCH result
    expect(finalizeRes.error).toContain(
      "El tamaño del archivo no coincide con la reserva declarada"
    );

    // 5. Verify physical object is absent from storage
    const { data: infoAfter } = await adminClient.storage
      .from(docRecord.storage_bucket)
      .info(docRecord.storage_key);
    expect(infoAfter).toBeNull();

    // 6. Verify DB terminal state is REJECTED
    const { data: docInDb } = await adminClient
      .from("documents")
      .select("status, validation_error_code")
      .eq("id", docRecord.document_id)
      .single();
    expect(docInDb?.status).toBe("REJECTED");
    expect(docInDb?.validation_error_code).toBe("SIZE_MISMATCH");

    // 7. Verify quota is released (0 active documents, 0 bytes)
    const quotaRes = await getDocumentQuotaUsage();
    expect(quotaRes.data?.activeDocumentsCount).toBe(0);
    expect(quotaRes.data?.totalSizeBytes).toBe(0);

    // Cleanup
    await adminClient
      .from("documents")
      .delete()
      .eq("id", docRecord.document_id);
  });
});
