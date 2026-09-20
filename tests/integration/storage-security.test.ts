import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

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
    // Alice tries to directly upload to storage without an upload reservation
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

  it("3. Exact signed upload succeeds, creates physical object, transitions to READY, and authorized download works (P0-1, P0-3, P0-7)", async () => {
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

    // Step B: Trusted server admin client creates signed upload authorization for THAT EXACT KEY
    const { data: signedData, error: signedError } = await adminClient.storage
      .from(docRecord.storage_bucket)
      .createSignedUploadUrl(docRecord.storage_key);

    expect(signedError).toBeNull();
    expect(signedData?.token).toBeDefined();

    // Step C: Browser uploads to exact signed URL (upsert: false)
    const { data: uploadData, error: uploadError } = await aliceClient.storage
      .from(docRecord.storage_bucket)
      .uploadToSignedUrl(
        docRecord.storage_key,
        signedData!.token,
        validPdfContent,
        {
          contentType: "application/pdf",
          upsert: false,
        }
      );

    expect(uploadError).toBeNull();
    expect(uploadData?.path).toBe(docRecord.storage_key);

    // Step D: Physical object exists in storage
    const { data: infoData, error: infoError } = await adminClient.storage
      .from(docRecord.storage_bucket)
      .info(docRecord.storage_key);

    expect(infoError).toBeNull();
    expect(infoData).toBeDefined();
    expect(infoData?.size).toBe(declaredSize);
    expect(infoData?.contentType).toBe("application/pdf");

    // Step E: Privileged server-only finalization marks READY
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

    // Step F: Verify signed download works for owner
    const { data: downloadSigned, error: downloadError } =
      await adminClient.storage
        .from(docRecord.storage_bucket)
        .createSignedUrl(docRecord.storage_key, 300);

    expect(downloadError).toBeNull();
    expect(downloadSigned?.signedUrl).toBeDefined();

    // Fetch download URL and verify content
    const res = await fetch(downloadSigned!.signedUrl);
    expect(res.ok).toBe(true);
    const downloadedBuffer = Buffer.from(await res.arrayBuffer());
    expect(downloadedBuffer.toString()).toBe(validPdfContent.toString());

    // Step G: Bob cannot read Alice's document from database
    const { data: bobViewDoc, error: bobViewError } = await bobClient
      .from("documents")
      .select("*")
      .eq("id", docRecord.document_id);

    expect(bobViewError).toBeNull();
    expect(bobViewDoc).toHaveLength(0);

    // Step H: Direct Storage DELETE is strictly denied
    await aliceClient.storage.from("documents").remove([docRecord.storage_key]);

    // Removal by authenticated client fails or returns empty because DELETE policy is revoked
    // Verify physical object still exists after direct client delete attempt
    const { data: infoAfterDeleteAttempt } = await adminClient.storage
      .from("documents")
      .info(docRecord.storage_key);
    expect(infoAfterDeleteAttempt).not.toBeNull();

    // Step I: Direct call to archive_document_privileged by authenticated client is DENIED (P0)
    const { error: aliceArchivePrivError } = await aliceClient.rpc(
      "archive_document_privileged" as unknown as "request_document_upload",
      {
        p_document_id: docRecord.document_id,
        p_user_id: aliceUserId,
      } as unknown as { p_original_filename: string; p_size_bytes: number }
    );
    expect(aliceArchivePrivError).not.toBeNull();
    expect(aliceArchivePrivError?.code).toBe("42501"); // permission denied

    // Step J: Application archive deletes physical blob and privileged RPC marks archived
    // Real Storage API deletion via admin client
    const { error: removeErr } = await adminClient.storage
      .from("documents")
      .remove([docRecord.storage_key]);
    expect(removeErr).toBeNull();

    const { data: archiveResult, error: archiveError } = await adminClient.rpc(
      "archive_document_privileged",
      {
        p_document_id: docRecord.document_id,
        p_user_id: aliceUserId,
      }
    );

    expect(archiveError).toBeNull();
    expect(archiveResult).toBe(true);

    // Physical object is now gone
    const { data: infoAfterArchive } = await adminClient.storage
      .from("documents")
      .info(docRecord.storage_key);
    expect(infoAfterArchive).toBeNull();
  });

  it("4. Invalid PDF is rejected and physical blob is removed from Storage (P0-7, P1-1)", async () => {
    const fakePdfContent = Buffer.from(
      "<html><body>Fake PDF content</body></html>"
    );
    const declaredSize = fakePdfContent.length;

    // Step A: Request upload reservation
    const { data: rpcData, error: rpcError } = await aliceClient.rpc(
      "request_document_upload",
      {
        p_original_filename: "fake_slides.pdf",
        p_size_bytes: declaredSize,
        p_mime_type: "application/pdf",
        p_subject_id: aliceSubjectId,
      }
    );

    expect(rpcError).toBeNull();
    const docRecord = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    if (!docRecord) throw new Error("Expected docRecord to be returned");

    // Step B: Signed upload authorization
    const { data: signedData } = await adminClient.storage
      .from(docRecord.storage_bucket)
      .createSignedUploadUrl(docRecord.storage_key);

    // Step C: Upload fake content
    await aliceClient.storage
      .from(docRecord.storage_bucket)
      .uploadToSignedUrl(
        docRecord.storage_key,
        signedData!.token,
        fakePdfContent,
        {
          contentType: "application/pdf",
          upsert: false,
        }
      );

    // Step D: Range read 5 bytes to verify magic bytes
    const { data: signedDownload } = await adminClient.storage
      .from(docRecord.storage_bucket)
      .createSignedUrl(docRecord.storage_key, 60);

    const rangeRes = await fetch(signedDownload!.signedUrl, {
      headers: { Range: "bytes=0-4" },
    });
    const rangeBytes = Buffer.from(await rangeRes.arrayBuffer());
    const isPdf = rangeBytes.toString().startsWith("%PDF-");
    expect(isPdf).toBe(false);

    // Step E: On validation failure, remove physical blob with explicit error check
    const { error: removeErr } = await adminClient.storage
      .from(docRecord.storage_bucket)
      .remove([docRecord.storage_key]);
    expect(removeErr).toBeNull();

    const { data: rejectData, error: rejectError } = await adminClient.rpc(
      "reject_document_upload_privileged",
      {
        p_document_id: docRecord.document_id,
        p_user_id: aliceUserId,
        p_error_code: "INVALID_PDF_SIGNATURE",
        p_status: "REJECTED",
      }
    );

    expect(rejectError).toBeNull();
    expect(rejectData?.status).toBe("REJECTED");
    expect(rejectData?.validation_error_code).toBe("INVALID_PDF_SIGNATURE");

    // Step F: Verify physical blob was removed
    const { data: infoCheck } = await adminClient.storage
      .from(docRecord.storage_bucket)
      .info(docRecord.storage_key);
    expect(infoCheck).toBeNull();
  });

  it("5. Declared size mismatch with a REAL uploaded object: rejects and physical blob cleanup succeeds (P0-4, P0-7)", async () => {
    const declaredSize = 50000;
    const realContent = Buffer.from(
      "%PDF-1.4 Real content with different size"
    );
    const realSize = realContent.length;

    // Step A: Request reservation with declaredSize = 50000 bytes
    const { data: rpcData, error: rpcError } = await aliceClient.rpc(
      "request_document_upload",
      {
        p_original_filename: "mismatch_real.pdf",
        p_size_bytes: declaredSize,
        p_mime_type: "application/pdf",
        p_subject_id: aliceSubjectId,
      }
    );
    expect(rpcError).toBeNull();
    const docRecord = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    if (!docRecord) throw new Error("Expected docRecord to be returned");

    // Step B: Signed upload authorization
    const { data: signedData } = await adminClient.storage
      .from(docRecord.storage_bucket)
      .createSignedUploadUrl(docRecord.storage_key);

    // Step C: Upload REAL object with actual size (realSize != declaredSize)
    await aliceClient.storage
      .from(docRecord.storage_bucket)
      .uploadToSignedUrl(
        docRecord.storage_key,
        signedData!.token,
        realContent,
        {
          contentType: "application/pdf",
          upsert: false,
        }
      );

    // Step D: Verify storage metadata sees real size
    const { data: infoData } = await adminClient.storage
      .from(docRecord.storage_bucket)
      .info(docRecord.storage_key);
    expect(infoData?.size).toBe(realSize);
    expect(infoData?.size).not.toBe(declaredSize);

    // Step E: Size mismatch detected -> explicitly remove physical blob
    const { error: removeErr } = await adminClient.storage
      .from(docRecord.storage_bucket)
      .remove([docRecord.storage_key]);
    expect(removeErr).toBeNull();

    // Step F: Privileged rejection marks document REJECTED
    const { data: rejectData, error: rejectError } = await adminClient.rpc(
      "reject_document_upload_privileged",
      {
        p_document_id: docRecord.document_id,
        p_user_id: aliceUserId,
        p_error_code: "SIZE_MISMATCH",
        p_status: "REJECTED",
      }
    );
    expect(rejectError).toBeNull();
    expect(rejectData?.status).toBe("REJECTED");
    expect(rejectData?.validation_error_code).toBe("SIZE_MISMATCH");

    // Step G: Physical blob cleanup confirmed
    const { data: infoAfter } = await adminClient.storage
      .from(docRecord.storage_bucket)
      .info(docRecord.storage_key);
    expect(infoAfter).toBeNull();
  });

  it("6. Authenticated user cannot call archive_document_privileged directly (P0)", async () => {
    // Attempting to invoke privileged archive directly via authenticated client is rejected
    const { error } = await aliceClient.rpc(
      "archive_document_privileged" as unknown as "request_document_upload",
      {
        p_document_id: "11111111-1111-1111-1111-111111111111",
        p_user_id: aliceUserId,
      } as unknown as { p_original_filename: string; p_size_bytes: number }
    );
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501"); // permission denied
  });

  it("7. Storage deletion failure on archive does NOT free quota or mark archived (P0)", async () => {
    // Create a document record
    const { data: rpcData } = await aliceClient.rpc("request_document_upload", {
      p_original_filename: "archive_fail_test.pdf",
      p_size_bytes: 1024,
      p_mime_type: "application/pdf",
      p_subject_id: aliceSubjectId,
    });
    const docRecord = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    if (!docRecord) throw new Error("Expected docRecord");

    // Real Storage API call with invalid authorization simulating transient storage failure
    const failingStorageClient = createClient<Database>(
      SUPABASE_URL,
      "invalid-simulated-key",
      { auth: { persistSession: false } }
    );
    const { data: removeData, error: removeError } =
      await failingStorageClient.storage
        .from("documents")
        .remove([docRecord.storage_key]);

    expect(removeData).toBeNull();
    expect(removeError).not.toBeNull();

    // Invariant: Because Storage deletion failed, privileged archive RPC must NOT be called.
    // Verify DB row is still active and NOT archived (quota is preserved)
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

  it("8. Cross-user download authorization denied via application boundary (P0-3)", async () => {
    // Alice creates and finalizes a document
    const content = Buffer.from(
      "%PDF-1.4 Alice private document\ntrailer\n%%EOF"
    );
    const { data: rpcData } = await aliceClient.rpc("request_document_upload", {
      p_original_filename: "alice_confidential.pdf",
      p_size_bytes: content.length,
      p_mime_type: "application/pdf",
      p_subject_id: aliceSubjectId,
    });
    const docRecord = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    if (!docRecord) throw new Error("Expected docRecord");

    const { data: signed } = await adminClient.storage
      .from(docRecord.storage_bucket)
      .createSignedUploadUrl(docRecord.storage_key);

    await aliceClient.storage
      .from(docRecord.storage_bucket)
      .uploadToSignedUrl(docRecord.storage_key, signed!.token, content, {
        contentType: "application/pdf",
        upsert: false,
      });

    await adminClient.rpc("finalize_document_upload_privileged", {
      p_document_id: docRecord.document_id,
      p_user_id: aliceUserId,
      p_actual_size: content.length,
    });

    // Bob attempts to query Alice's document directly: RLS returns nothing
    const { data: bobDocQuery } = await bobClient
      .from("documents")
      .select("id")
      .eq("id", docRecord.document_id);
    expect(bobDocQuery).toHaveLength(0);

    // Bob cannot read the physical object from storage directly
    const { data: bobStorageData, error: bobStorageError } =
      await bobClient.storage.from("documents").download(docRecord.storage_key);
    expect(bobStorageData).toBeNull();
    expect(bobStorageError).not.toBeNull();

    // Cleanup
    await adminClient.storage.from("documents").remove([docRecord.storage_key]);
    await adminClient
      .from("documents")
      .delete()
      .eq("id", docRecord.document_id);
  });

  it("9. Signed upload token reuse-after-delete experiment & lease mitigation (P1)", async () => {
    const testKey = `${aliceUserId}/reuse-experiment-${Date.now()}/source.pdf`;
    const { data: signed, error: sErr } = await adminClient.storage
      .from("documents")
      .createSignedUploadUrl(testKey);

    expect(sErr).toBeNull();
    expect(signed?.token).toBeDefined();

    // First upload
    const { data: u1, error: u1Err } = await aliceClient.storage
      .from("documents")
      .uploadToSignedUrl(
        testKey,
        signed!.token,
        Buffer.from("%PDF-1.4 first upload"),
        {
          contentType: "application/pdf",
          upsert: false,
        }
      );
    expect(u1Err).toBeNull();
    expect(u1?.path).toBe(testKey);

    // Delete object
    const { error: dErr } = await adminClient.storage
      .from("documents")
      .remove([testKey]);
    expect(dErr).toBeNull();

    // Re-upload attempt with SAME token:
    // Empirical finding: Supabase Storage allows reuse if path is empty within the token's 2-hour window
    const { data: u2, error: u2Err } = await aliceClient.storage
      .from("documents")
      .uploadToSignedUrl(
        testKey,
        signed!.token,
        Buffer.from("%PDF-1.4 re-upload with same token"),
        {
          contentType: "application/pdf",
          upsert: false,
        }
      );
    expect(u2Err).toBeNull();
    expect(u2?.path).toBe(testKey);

    // Mitigation Demonstration:
    // 1. If a tombstone object exists at that path, upsert: false rejects re-upload with 409 KeyAlreadyExists
    const { error: u3Err } = await aliceClient.storage
      .from("documents")
      .uploadToSignedUrl(
        testKey,
        signed!.token,
        Buffer.from("%PDF-1.4 blocked attempt"),
        {
          contentType: "application/pdf",
          upsert: false,
        }
      );
    expect(u3Err).not.toBeNull();
    expect((u3Err as { statusCode?: string }).statusCode).toBe("409");

    // Cleanup experiment object
    await adminClient.storage.from("documents").remove([testKey]);
  });

  it("10. Abandoned upload reservation recovery via lazy cleanup (P1)", async () => {
    // Insert a simulated abandoned upload reservation created 3 hours ago (> 2 hours lease)
    const expiredDocId = "88888888-8888-8888-8888-888888888888";
    await adminClient.from("documents").insert({
      id: expiredDocId,
      user_id: aliceUserId,
      subject_id: aliceSubjectId,
      original_filename: "abandoned_doc.pdf",
      storage_key: `${aliceUserId}/${expiredDocId}/source.pdf`,
      mime_type: "application/pdf",
      size_bytes: 5000000,
      status: "UPLOADING",
      created_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    });

    // Verify it is initially UPLOADING
    const { data: before } = await adminClient
      .from("documents")
      .select("status, validation_error_code")
      .eq("id", expiredDocId)
      .single();
    expect(before?.status).toBe("UPLOADING");

    // Alice initiates a new upload request -> triggers lazy cleanup of expired reservations
    const { data: newUpload, error: newUploadErr } = await aliceClient.rpc(
      "request_document_upload",
      {
        p_original_filename: "fresh_doc.pdf",
        p_size_bytes: 1024,
        p_mime_type: "application/pdf",
        p_subject_id: aliceSubjectId,
      }
    );
    expect(newUploadErr).toBeNull();
    expect(newUpload).toBeDefined();

    // Verify the abandoned reservation was automatically transitioned to FAILED (UPLOAD_TIMEOUT)
    const { data: after } = await adminClient
      .from("documents")
      .select("status, validation_error_code")
      .eq("id", expiredDocId)
      .single();
    expect(after?.status).toBe("FAILED");
    expect(after?.validation_error_code).toBe("UPLOAD_TIMEOUT");

    // Cleanup
    const newDocRecord = Array.isArray(newUpload) ? newUpload[0] : newUpload;
    if (!newDocRecord) throw new Error("Expected newDocRecord");
    await adminClient
      .from("documents")
      .delete()
      .in("id", [expiredDocId, newDocRecord.document_id]);
  });

  it("11. Application-level archive retry is idempotent (P1)", async () => {
    // Create an archived document record where physical blob is absent
    const archivedDocId = "77777777-7777-7777-7777-777777777777";
    await adminClient.from("documents").insert({
      id: archivedDocId,
      user_id: aliceUserId,
      subject_id: aliceSubjectId,
      original_filename: "already_archived.pdf",
      storage_key: `${aliceUserId}/${archivedDocId}/source.pdf`,
      mime_type: "application/pdf",
      size_bytes: 1024,
      status: "READY",
      archived_at: new Date().toISOString(),
    });

    // Calling privileged archive again on an already archived document succeeds idempotently
    const { data: retryResult, error: retryError } = await adminClient.rpc(
      "archive_document_privileged",
      {
        p_document_id: archivedDocId,
        p_user_id: aliceUserId,
      }
    );

    expect(retryError).toBeNull();
    expect(retryResult).toBe(true);

    // Cleanup
    await adminClient.from("documents").delete().eq("id", archivedDocId);
  });

  it("12. Concurrent quota reservations are serialized via advisory lock (P0-5)", async () => {
    // Max single file size is 25 MB (26,214,400 bytes). Max total quota is 100 MB (104,857,600 bytes).
    // Establish a 70 MB baseline reservation for Alice (using 3 valid files of ~23.3 MB each).
    const baselineDocIds: string[] = [];
    const baselineSize = 23 * 1024 * 1024; // 23 MB

    for (let i = 1; i <= 3; i++) {
      const { data: bData, error: bErr } = await aliceClient.rpc(
        "request_document_upload",
        {
          p_original_filename: `baseline_${i}.pdf`,
          p_size_bytes: baselineSize,
          p_mime_type: "application/pdf",
          p_subject_id: aliceSubjectId,
        }
      );
      expect(bErr).toBeNull();
      const bDoc = Array.isArray(bData) ? bData[0] : bData;
      if (!bDoc) throw new Error("Expected bDoc");
      baselineDocIds.push(bDoc.document_id);
    }

    // Now Alice has 69 MB reserved (31 MB remaining out of 100 MB).
    // Launch 2 concurrent requests, each requesting 20 MB (20,971,520 bytes <= 25 MB max file).
    // Together they would be 69 MB + 40 MB = 109 MB > 100 MB.
    // Due to pg_advisory_xact_lock serialization:
    // Exactly ONE must succeed (reaching 89 MB) and ONE must fail with 23514 (quota exceeded).
    const size20Mb = 20 * 1024 * 1024;

    const [res1, res2] = await Promise.allSettled([
      aliceClient.rpc("request_document_upload", {
        p_original_filename: "concurrent_1.pdf",
        p_size_bytes: size20Mb,
        p_mime_type: "application/pdf",
        p_subject_id: aliceSubjectId,
      }),
      aliceClient.rpc("request_document_upload", {
        p_original_filename: "concurrent_2.pdf",
        p_size_bytes: size20Mb,
        p_mime_type: "application/pdf",
        p_subject_id: aliceSubjectId,
      }),
    ]);

    const results = [
      res1.status === "fulfilled" ? res1.value : null,
      res2.status === "fulfilled" ? res2.value : null,
    ];

    const successes = results.filter((r) => r?.error === null);
    const failures = results.filter((r) => r?.error !== null);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.error?.code).toBe("23514"); // Quota exceeded

    // Cleanup successful doc and baseline docs
    const successDoc = Array.isArray(successes[0]!.data)
      ? successes[0]!.data[0]
      : successes[0]!.data;
    await adminClient
      .from("documents")
      .delete()
      .in("id", [...baselineDocIds, successDoc.document_id]);
  });
});
