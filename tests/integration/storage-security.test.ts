import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const SUPABASE_SECRET_KEY =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";

describe("Authoritative Supabase Storage API Integration & Security Boundary (P1-3)", () => {
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

  it("3. Exact signed upload succeeds, creates physical object, and transitions to READY (P0-1, P0-3, P0-7)", async () => {
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

    // Step I: Application archive deletes physical blob and marks archived
    // Real Storage API deletion via admin client
    await adminClient.storage.from("documents").remove([docRecord.storage_key]);

    const { data: archiveResult, error: archiveError } = await aliceClient.rpc(
      "archive_document",
      {
        p_document_id: docRecord.document_id,
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

    // Step E: On validation failure, remove physical blob and reject
    await adminClient.storage
      .from(docRecord.storage_bucket)
      .remove([docRecord.storage_key]);

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

  it("5. Declared size mismatch is rejected (P0-4, P0-7)", async () => {
    const declaredSize = 5000;
    const actualContent = Buffer.from(
      "%PDF-1.4 Actual content of different size"
    );
    const actualSize = actualContent.length;

    // Request reservation with 5000 bytes
    const { data: rpcData } = await aliceClient.rpc("request_document_upload", {
      p_original_filename: "mismatch.pdf",
      p_size_bytes: declaredSize,
      p_mime_type: "application/pdf",
      p_subject_id: aliceSubjectId,
    });
    const docRecord = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    if (!docRecord) throw new Error("Expected docRecord to be returned");

    // Privileged finalization with mismatched actual size throws error
    const { error: finalizeError } = await adminClient.rpc(
      "finalize_document_upload_privileged",
      {
        p_document_id: docRecord.document_id,
        p_user_id: aliceUserId,
        p_actual_size: actualSize,
      }
    );

    expect(finalizeError).not.toBeNull();
    expect(finalizeError?.code).toBe("23514"); // Check violation: size mismatch
  });
});
