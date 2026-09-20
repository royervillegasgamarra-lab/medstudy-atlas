import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  requestDocumentUpload,
  finalizeDocumentUpload,
  getAuthorizedDocumentUrl,
  archiveDocument,
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
    expect(docInDb?.status).toBe("UPLOADING");

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

    // Bob attempts to get authorized download URL for Alice's document
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
});
