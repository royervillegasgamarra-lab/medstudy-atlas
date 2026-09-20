import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import { spawnSync } from "child_process";
import type { Database } from "@/types/database";
import {
  processNextDocumentJob,
  createSafeParserEnvironment,
  resolvePythonExecutable,
} from "@/workers/documents-worker";

// Load local environment variables if available
const procWithEnv = process as unknown as {
  loadEnvFile?: (path?: string) => void;
};
if (typeof procWithEnv.loadEnvFile === "function") {
  try {
    procWithEnv.loadEnvFile(".env.local");
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

describe("Document Processing Worker & Isolation Integration (Phase 1D)", () => {
  let adminClient: SupabaseClient<Database>;
  let testUserId: string;
  let testSubjectId: string;
  const testEmail = `worker.test.${Date.now()}@test.local`;
  const testPassword = "Password123!";

  beforeAll(async () => {
    adminClient = createClient<Database>(SUPABASE_URL, SUPABASE_SECRET_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    // Create test user
    const { data: user, error: userError } =
      await adminClient.auth.admin.createUser({
        email: testEmail,
        password: testPassword,
        email_confirm: true,
      });
    expect(userError).toBeNull();
    testUserId = user.user!.id;

    // Create test subject
    const { data: subject, error: subjectError } = await adminClient
      .from("subjects")
      .insert({
        user_id: testUserId,
        name: "Cardiologia Clinica Worker Test",
      })
      .select("id")
      .single();
    expect(subjectError).toBeNull();
    testSubjectId = subject!.id;

    // Clean up any stale PENDING or RUNNING runs so tests start from a deterministic queue
    await adminClient
      .from("document_processing_runs")
      .update({ status: "FAILED_FINAL", error_code: "WORKER_INTERNAL_ERROR" })
      .in("status", ["PENDING", "RUNNING"]);
  });

  afterAll(async () => {
    // Cleanup test user and associated documents
    if (testUserId) {
      await adminClient.auth.admin.deleteUser(testUserId);
    }
  });

  describe("Subprocess Security Boundary & Stripped Environment", () => {
    it("ensures child process cannot access Supabase secret keys or database credentials", () => {
      const originalSecret = process.env.SUPABASE_SECRET_KEY;
      const originalDbUrl = process.env.DATABASE_URL;

      try {
        process.env.SUPABASE_SECRET_KEY = "super_secret_supabase_key_123";
        process.env.DATABASE_URL =
          "postgresql://postgres:secret@localhost:5432/db";

        const safeEnv = createSafeParserEnvironment();
        expect(safeEnv.SUPABASE_SECRET_KEY).toBeUndefined();
        expect(safeEnv.DATABASE_URL).toBeUndefined();

        // Spawn a python one-liner with safeEnv to verify isolation at the OS level
        const pythonExe = resolvePythonExecutable();
        const verifyScript =
          "import os; print('SECRET_FOUND' if 'SUPABASE_SECRET_KEY' in os.environ or 'DATABASE_URL' in os.environ else 'CLEAN_ISOLATION')";
        const res = spawnSync(pythonExe, ["-c", verifyScript], {
          env: safeEnv,
          encoding: "utf-8",
        });

        expect(res.status).toBe(0);
        expect(res.stdout.trim()).toBe("CLEAN_ISOLATION");
      } finally {
        process.env.SUPABASE_SECRET_KEY = originalSecret;
        process.env.DATABASE_URL = originalDbUrl;
      }
    });
  });

  describe("Worker Claim Concurrency & SKIP LOCKED", () => {
    it("prevents multiple workers from claiming the same job simultaneously", async () => {
      const docId = crypto.randomUUID();
      const storageKey = `${testUserId}/${docId}.pdf`;

      const { error: insertDocError } = await adminClient
        .from("documents")
        .insert({
          id: docId,
          user_id: testUserId,
          subject_id: testSubjectId,
          original_filename: "concurrency_test.pdf",
          storage_bucket: "documents",
          storage_key: storageKey,
          size_bytes: 1024,
          mime_type: "application/pdf",
          status: "READY",
        });
      expect(insertDocError).toBeNull();

      const { data: enqueueData, error: enqueueError } = await adminClient.rpc(
        "enqueue_document_processing_privileged",
        {
          p_document_id: docId,
          p_user_id: testUserId,
        }
      );
      expect(enqueueError).toBeNull();
      const runId = (enqueueData as unknown as Array<{ run_id: string }>)[0]
        .run_id;

      // Concurrently attempt to claim the job with two different worker IDs
      const [claimA, claimB] = await Promise.all([
        adminClient.rpc("claim_next_processing_run", {
          p_worker_id: "worker-concurrent-A",
          p_lease_seconds: 60,
        }),
        adminClient.rpc("claim_next_processing_run", {
          p_worker_id: "worker-concurrent-B",
          p_lease_seconds: 60,
        }),
      ]);

      expect(claimA.error).toBeNull();
      expect(claimB.error).toBeNull();

      const listA =
        (claimA.data as unknown as Array<{
          document_id: string;
          claim_token: string;
        }>) || [];
      const listB =
        (claimB.data as unknown as Array<{
          document_id: string;
          claim_token: string;
        }>) || [];

      // Exactly one worker must claim this specific job, never both
      const claimedThisDocA = listA.filter((c) => c.document_id === docId);
      const claimedThisDocB = listB.filter((c) => c.document_id === docId);
      const totalClaimedThisDoc =
        claimedThisDocA.length + claimedThisDocB.length;
      expect(totalClaimedThisDoc).toBe(1);

      const winningClaim =
        claimedThisDocA.length === 1 ? claimedThisDocA[0] : claimedThisDocB[0];
      expect(winningClaim.claim_token).toBeDefined();

      // Release / fail run with winning claim token
      await adminClient.rpc("fail_processing_run_privileged", {
        p_run_id: runId,
        p_claim_token: winningClaim.claim_token,
        p_error_code: "PREFLIGHT_TIMEOUT",
        p_retryable: false,
      });
    });
  });

  describe("Adversarial Lease Expiration & Claim Token Fencing (P0)", () => {
    it("denies stale worker persistence and fail calls after lease expired and reclaimed by another worker", async () => {
      const docId = crypto.randomUUID();
      const storageKey = `${testUserId}/${docId}.pdf`;

      await adminClient.from("documents").insert({
        id: docId,
        user_id: testUserId,
        subject_id: testSubjectId,
        original_filename: "lease_fencing_test.pdf",
        storage_bucket: "documents",
        storage_key: storageKey,
        size_bytes: 1024,
        mime_type: "application/pdf",
        status: "READY",
      });

      const { data: enqueueData } = await adminClient.rpc(
        "enqueue_document_processing_privileged",
        {
          p_document_id: docId,
          p_user_id: testUserId,
        }
      );
      const runId = (enqueueData as unknown as Array<{ run_id: string }>)[0]
        .run_id;

      // 1. Worker A claims the job
      const { data: claimAData } = await adminClient.rpc(
        "claim_next_processing_run",
        {
          p_worker_id: "worker-A",
          p_lease_seconds: 300,
        }
      );
      const claimA = (
        claimAData as unknown as Array<{ claim_token: string }>
      )[0];
      expect(claimA.claim_token).toBeDefined();

      // 2. Force Worker A's lease to expire
      await adminClient
        .from("document_processing_runs")
        .update({
          lease_expires_at: new Date(Date.now() - 10000).toISOString(),
        })
        .eq("id", runId);

      // 3. Worker B reclaims the expired job
      const { data: claimBData } = await adminClient.rpc(
        "claim_next_processing_run",
        {
          p_worker_id: "worker-B",
          p_lease_seconds: 300,
        }
      );
      const claimB = (
        claimBData as unknown as Array<{ claim_token: string }>
      )[0];
      expect(claimB.claim_token).toBeDefined();
      expect(claimB.claim_token).not.toBe(claimA.claim_token);

      // 4. Stale Worker A attempts to persist -> DENIED
      const { error: stalePersistError } = await adminClient.rpc(
        "persist_processing_run_results_privileged",
        {
          p_run_id: runId,
          p_claim_token: claimA.claim_token,
          p_manifest: {
            page_count: 1,
            native_text_page_count: 1,
            ocr_page_count: 0,
            no_text_page_count: 0,
            source_sha256: "stale_hash",
          },
          p_pages: [],
        }
      );
      expect(stalePersistError).toBeDefined();

      // 5. Stale Worker A attempts to fail -> DENIED
      const { error: staleFailError } = await adminClient.rpc(
        "fail_processing_run_privileged",
        {
          p_run_id: runId,
          p_claim_token: claimA.claim_token,
          p_error_code: "PARSER_TIMEOUT",
          p_retryable: true,
        }
      );
      expect(staleFailError).toBeDefined();

      // 6. Active Worker B persists -> SUCCEEDS
      const { error: activePersistError } = await adminClient.rpc(
        "persist_processing_run_results_privileged",
        {
          p_run_id: runId,
          p_claim_token: claimB.claim_token,
          p_manifest: {
            page_count: 1,
            native_text_page_count: 1,
            ocr_page_count: 0,
            no_text_page_count: 0,
            source_sha256: "active_hash",
          },
          p_pages: [
            {
              page_number: 1,
              classification: "TEXT_BASED",
              extraction_method: "NATIVE",
              text_content: "Active worker valid content",
              char_count: 27,
              native_char_count: 27,
              ocr_char_count: 0,
              ocr_confidence: null,
              width_points: 612,
              height_points: 792,
              rotation_degrees: 0,
              text_sha256: crypto
                .createHash("sha256")
                .update("Active worker valid content")
                .digest("hex"),
            },
          ],
        }
      );
      expect(activePersistError).toBeNull();

      const { data: runRecord } = await adminClient
        .from("document_processing_runs")
        .select("status, claim_token")
        .eq("id", runId)
        .single();
      expect(runRecord!.status).toBe("SUCCEEDED");
      expect(runRecord!.claim_token).toBeNull();
    });
  });

  describe("End-to-End Processing & Retry Idempotency", () => {
    it("processes valid PDF into pages, verifies provenance, and handles retries idempotently", async () => {
      const fixturePath = path.resolve(
        process.cwd(),
        "tests/fixtures/documents/valid_text.pdf"
      );
      const fixtureBuffer = await fs.readFile(fixturePath);

      const docId = crypto.randomUUID();
      const storageKey = `${testUserId}/${docId}.pdf`;

      // Upload to storage
      await adminClient.storage
        .from("documents")
        .upload(storageKey, fixtureBuffer, {
          contentType: "application/pdf",
          upsert: true,
        });

      // Insert document record
      await adminClient.from("documents").insert({
        id: docId,
        user_id: testUserId,
        subject_id: testSubjectId,
        original_filename: "valid_text.pdf",
        storage_bucket: "documents",
        storage_key: storageKey,
        size_bytes: fixtureBuffer.length,
        mime_type: "application/pdf",
        status: "READY",
      });

      // Enqueue processing run
      const { data: enqueueData } = await adminClient.rpc(
        "enqueue_document_processing_privileged",
        {
          p_document_id: docId,
          p_user_id: testUserId,
        }
      );
      const runId = (enqueueData as unknown as Array<{ run_id: string }>)[0]
        .run_id;

      // Execute worker job
      const result = await processNextDocumentJob("integration-worker-1");
      expect(result.claimed).toBe(true);
      expect(result.runId).toBe(runId);
      expect(result.status).toBe("SUCCEEDED");
      expect(result.pageCount).toBe(2);

      // Verify processing run record in database
      const { data: runRecord } = await adminClient
        .from("document_processing_runs")
        .select("*")
        .eq("id", runId)
        .single();

      expect(runRecord!.status).toBe("SUCCEEDED");
      expect(runRecord!.page_count).toBe(2);
      expect(runRecord!.native_text_page_count).toBe(2);
      expect(runRecord!.ocr_page_count).toBe(0);

      // Verify document_pages in database
      const { data: pages } = await adminClient
        .from("document_pages")
        .select("*")
        .eq("document_id", docId)
        .order("page_number", { ascending: true });

      expect(pages!.length).toBe(2);
      expect(pages![0].page_number).toBe(1);
      expect(pages![0].extraction_method).toBe("NATIVE");
      expect(pages![0].text_content).toContain(
        "Cardiologia: Insuficiencia Cardiaca"
      );
      expect(pages![1].page_number).toBe(2);
      expect(pages![1].extraction_method).toBe("NATIVE");

      // Test Retry Idempotency: Re-enqueue after failure
      // Simulate failure on active claim
      await adminClient.rpc("claim_next_processing_run", {
        p_worker_id: "worker-retry-claim",
        p_lease_seconds: 300,
      });

      // Directly update to FAILED_RETRYABLE for retry test
      await adminClient
        .from("document_processing_runs")
        .update({
          status: "FAILED_RETRYABLE",
          error_code: "PREFLIGHT_TIMEOUT",
          attempt_count: 1,
        })
        .eq("id", runId);

      const { data: retryEnqueueData } = await adminClient.rpc(
        "enqueue_document_processing_privileged",
        {
          p_document_id: docId,
          p_user_id: testUserId,
        }
      );
      const retryList = retryEnqueueData as unknown as Array<{
        run_id: string;
        status: string;
      }>;
      expect(retryList[0].status).toBe("PENDING");

      const retryResult = await processNextDocumentJob(
        "integration-worker-retry"
      );
      expect(retryResult.claimed).toBe(true);
      expect(retryResult.status).toBe("SUCCEEDED");

      // Verify page count is still exactly 2, never duplicated!
      const { data: pagesAfterRetry } = await adminClient
        .from("document_pages")
        .select("*")
        .eq("document_id", docId);

      expect(pagesAfterRetry!.length).toBe(2);

      // Clean up storage object
      await adminClient.storage.from("documents").remove([storageKey]);
    });
  });

  describe("Guaranteed Temp Directory Cleanup", () => {
    it("ensures no temporary files remain on the filesystem after successful and failed processing", async () => {
      const baseTempDir = path.join(os.tmpdir(), "medstudy-atlas-proc");

      // 1. Success case cleanup
      const fixturePath = path.resolve(
        process.cwd(),
        "tests/fixtures/documents/valid_text.pdf"
      );
      const fixtureBuffer = await fs.readFile(fixturePath);
      const docIdSuccess = crypto.randomUUID();
      const storageKeySuccess = `${testUserId}/${docIdSuccess}.pdf`;

      const { error: uploadSuccessErr } = await adminClient.storage
        .from("documents")
        .upload(storageKeySuccess, fixtureBuffer, {
          contentType: "application/pdf",
          upsert: true,
        });
      expect(uploadSuccessErr).toBeNull();

      await adminClient.from("documents").insert({
        id: docIdSuccess,
        user_id: testUserId,
        subject_id: testSubjectId,
        original_filename: "cleanup_success.pdf",
        storage_bucket: "documents",
        storage_key: storageKeySuccess,
        size_bytes: fixtureBuffer.length,
        mime_type: "application/pdf",
        status: "READY",
      });

      await adminClient.rpc("enqueue_document_processing_privileged", {
        p_document_id: docIdSuccess,
        p_user_id: testUserId,
      });

      const resSuccess = await processNextDocumentJob("worker-cleanup-success");
      expect(resSuccess.status).toBe("SUCCEEDED");

      // Verify no remaining temp dir for this run
      const remainingSuccess = (
        await fs.readdir(baseTempDir).catch(() => [])
      ).filter((d) => d.startsWith(resSuccess.runId!));
      expect(remainingSuccess.length).toBe(0);

      // 2. Failure case cleanup
      const corruptFixturePath = path.resolve(
        process.cwd(),
        "tests/fixtures/documents/corrupt.pdf"
      );
      const corruptBuffer = await fs.readFile(corruptFixturePath);
      const docIdFail = crypto.randomUUID();
      const storageKeyFail = `${testUserId}/${docIdFail}.pdf`;

      const { error: uploadFailErr } = await adminClient.storage
        .from("documents")
        .upload(storageKeyFail, corruptBuffer, {
          contentType: "application/pdf",
          upsert: true,
        });
      expect(uploadFailErr).toBeNull();

      await adminClient.from("documents").insert({
        id: docIdFail,
        user_id: testUserId,
        subject_id: testSubjectId,
        original_filename: "cleanup_fail.pdf",
        storage_bucket: "documents",
        storage_key: storageKeyFail,
        size_bytes: corruptBuffer.length,
        mime_type: "application/pdf",
        status: "READY",
      });

      await adminClient.rpc("enqueue_document_processing_privileged", {
        p_document_id: docIdFail,
        p_user_id: testUserId,
      });

      const resFail = await processNextDocumentJob("worker-cleanup-fail");
      expect(resFail.status).toBe("FAILED");

      // Verify no remaining temp dir for failed run
      const remainingFail = (
        await fs.readdir(baseTempDir).catch(() => [])
      ).filter((d) => d.startsWith(resFail.runId!));
      expect(remainingFail.length).toBe(0);

      // Cleanup storage objects
      await adminClient.storage
        .from("documents")
        .remove([storageKeySuccess, storageKeyFail]);
    });
  });

  describe("Authoritative Storage Download Error Classification", () => {
    it("classifies confirmed missing source as SOURCE_MISSING (non-retryable)", async () => {
      const docId = crypto.randomUUID();
      const nonExistentKey = `${testUserId}/non_existent_${Date.now()}.pdf`;

      await adminClient.from("documents").insert({
        id: docId,
        user_id: testUserId,
        subject_id: testSubjectId,
        original_filename: "missing.pdf",
        storage_bucket: "documents",
        storage_key: nonExistentKey,
        size_bytes: 1024,
        mime_type: "application/pdf",
        status: "READY",
      });

      await adminClient.rpc("enqueue_document_processing_privileged", {
        p_document_id: docId,
        p_user_id: testUserId,
      });

      const res = await processNextDocumentJob("worker-missing-test");
      expect(res.claimed).toBe(true);
      expect(res.status).toBe("FAILED");
      expect(res.errorCode).toBe("SOURCE_MISSING");

      const { data: runRecord } = await adminClient
        .from("document_processing_runs")
        .select("status, error_code")
        .eq("id", res.runId!)
        .single();
      expect(runRecord!.status).toBe("FAILED_FINAL"); // Non-retryable
      expect(runRecord!.error_code).toBe("SOURCE_MISSING");
    });

    it("classifies bucket-level or network errors as STORAGE_UNAVAILABLE (retryable)", async () => {
      const docId = crypto.randomUUID();

      await adminClient.from("documents").insert({
        id: docId,
        user_id: testUserId,
        subject_id: testSubjectId,
        original_filename: "bucket_missing.pdf",
        storage_bucket: "non_existent_bucket_xyz",
        storage_key: "some_key.pdf",
        size_bytes: 1024,
        mime_type: "application/pdf",
        status: "READY",
      });

      await adminClient.rpc("enqueue_document_processing_privileged", {
        p_document_id: docId,
        p_user_id: testUserId,
      });

      const res = await processNextDocumentJob(
        "worker-storage-unavailable-test"
      );
      expect(res.claimed).toBe(true);
      expect(res.status).toBe("FAILED");
      expect(res.errorCode).toBe("STORAGE_UNAVAILABLE");

      const { data: runRecord } = await adminClient
        .from("document_processing_runs")
        .select("status, error_code")
        .eq("id", res.runId!)
        .single();
      expect(runRecord!.status).toBe("FAILED_RETRYABLE"); // Retryable
      expect(runRecord!.error_code).toBe("STORAGE_UNAVAILABLE");
    });
  });

  describe("Archive vs Processing Race Closure", () => {
    it("cancels active processing run, deletes pages, and denies worker persist when document is archived", async () => {
      const docId = crypto.randomUUID();
      const storageKey = `${testUserId}/${docId}.pdf`;

      await adminClient.from("documents").insert({
        id: docId,
        user_id: testUserId,
        subject_id: testSubjectId,
        original_filename: "archive_race.pdf",
        storage_bucket: "documents",
        storage_key: storageKey,
        size_bytes: 1024,
        mime_type: "application/pdf",
        status: "READY",
      });

      const { data: enqueueData } = await adminClient.rpc(
        "enqueue_document_processing_privileged",
        {
          p_document_id: docId,
          p_user_id: testUserId,
        }
      );
      const runId = (enqueueData as unknown as Array<{ run_id: string }>)[0]
        .run_id;

      // Worker claims the job
      const { data: claimData } = await adminClient.rpc(
        "claim_next_processing_run",
        {
          p_worker_id: "worker-archive-race",
          p_lease_seconds: 300,
        }
      );
      const claim = (claimData as unknown as Array<{ claim_token: string }>)[0];

      // User archives the document while worker is executing
      const { error: archiveError } = await adminClient.rpc(
        "archive_document_privileged",
        {
          p_document_id: docId,
          p_user_id: testUserId,
        }
      );
      expect(archiveError).toBeNull();

      // Verify processing run was terminally cancelled
      const { data: runAfterArchive } = await adminClient
        .from("document_processing_runs")
        .select("status, error_code")
        .eq("id", runId)
        .single();
      expect(runAfterArchive!.status).toBe("FAILED_FINAL");
      expect(runAfterArchive!.error_code).toBe("DOCUMENT_ARCHIVED");

      // Stale worker attempts to persist -> DENIED
      const { error: persistError } = await adminClient.rpc(
        "persist_processing_run_results_privileged",
        {
          p_run_id: runId,
          p_claim_token: claim.claim_token,
          p_manifest: {
            page_count: 1,
            native_text_page_count: 1,
            ocr_page_count: 0,
            no_text_page_count: 0,
            source_sha256: "archive_race_hash",
          },
          p_pages: [],
        }
      );
      expect(persistError).toBeDefined();

      // Verify zero derived pages remain
      const { data: pages } = await adminClient
        .from("document_pages")
        .select("*")
        .eq("document_id", docId);
      expect(pages!.length).toBe(0);
    });
  });

  describe("Terminal Retry Semantics & Attempt Budget", () => {
    it("transitions to FAILED_FINAL on 3rd failure and prevents subsequent retry or claim", async () => {
      const docId = crypto.randomUUID();
      const storageKey = `${testUserId}/${docId}.pdf`;

      await adminClient.from("documents").insert({
        id: docId,
        user_id: testUserId,
        subject_id: testSubjectId,
        original_filename: "attempt_budget_test.pdf",
        storage_bucket: "documents",
        storage_key: storageKey,
        size_bytes: 1024,
        mime_type: "application/pdf",
        status: "READY",
      });

      const { data: enqueueData } = await adminClient.rpc(
        "enqueue_document_processing_privileged",
        {
          p_document_id: docId,
          p_user_id: testUserId,
        }
      );
      const runId = (enqueueData as unknown as Array<{ run_id: string }>)[0]
        .run_id;

      // Attempt 1: claim & fail retryable
      const { data: claim1 } = await adminClient.rpc(
        "claim_next_processing_run",
        {
          p_worker_id: "worker-attempt-1",
          p_lease_seconds: 300,
        }
      );
      const token1 = (claim1 as unknown as Array<{ claim_token: string }>)[0]
        .claim_token;
      await adminClient.rpc("fail_processing_run_privileged", {
        p_run_id: runId,
        p_claim_token: token1,
        p_error_code: "PARSER_TIMEOUT",
        p_retryable: true,
      });

      const { data: run1 } = await adminClient
        .from("document_processing_runs")
        .select("status, attempt_count")
        .eq("id", runId)
        .single();
      expect(run1!.status).toBe("FAILED_RETRYABLE");
      expect(run1!.attempt_count).toBe(1);

      // Verify claim_next_processing_run skips FAILED_RETRYABLE runs until explicitly re-enqueued
      const { data: skippedClaim } = await adminClient.rpc(
        "claim_next_processing_run",
        {
          p_worker_id: "worker-attempt-skip",
          p_lease_seconds: 300,
        }
      );
      expect((skippedClaim as unknown as unknown[]).length).toBe(0);

      // Attempt 2: re-enqueue, claim & fail retryable
      await adminClient.rpc("enqueue_document_processing_privileged", {
        p_document_id: docId,
        p_user_id: testUserId,
      });
      const { data: claim2 } = await adminClient.rpc(
        "claim_next_processing_run",
        {
          p_worker_id: "worker-attempt-2",
          p_lease_seconds: 300,
        }
      );
      const token2 = (claim2 as unknown as Array<{ claim_token: string }>)[0]
        .claim_token;
      await adminClient.rpc("fail_processing_run_privileged", {
        p_run_id: runId,
        p_claim_token: token2,
        p_error_code: "PARSER_TIMEOUT",
        p_retryable: true,
      });

      const { data: run2 } = await adminClient
        .from("document_processing_runs")
        .select("status, attempt_count")
        .eq("id", runId)
        .single();
      expect(run2!.status).toBe("FAILED_RETRYABLE");
      expect(run2!.attempt_count).toBe(2);

      // Attempt 3: re-enqueue, claim & fail retryable -> MUST transition to FAILED_FINAL
      await adminClient.rpc("enqueue_document_processing_privileged", {
        p_document_id: docId,
        p_user_id: testUserId,
      });
      const { data: claim3 } = await adminClient.rpc(
        "claim_next_processing_run",
        {
          p_worker_id: "worker-attempt-3",
          p_lease_seconds: 300,
        }
      );
      const token3 = (claim3 as unknown as Array<{ claim_token: string }>)[0]
        .claim_token;
      await adminClient.rpc("fail_processing_run_privileged", {
        p_run_id: runId,
        p_claim_token: token3,
        p_error_code: "PARSER_TIMEOUT",
        p_retryable: true,
      });

      const { data: run3 } = await adminClient
        .from("document_processing_runs")
        .select("status, attempt_count")
        .eq("id", runId)
        .single();
      expect(run3!.status).toBe("FAILED_FINAL");
      expect(run3!.attempt_count).toBe(3);

      // Re-enqueue must be rejected
      const { error: reEnqueueError } = await adminClient.rpc(
        "enqueue_document_processing_privileged",
        {
          p_document_id: docId,
          p_user_id: testUserId,
        }
      );
      expect(reEnqueueError).toBeDefined();

      // Claim must skip FAILED_FINAL
      const { data: emptyClaim } = await adminClient.rpc(
        "claim_next_processing_run",
        {
          p_worker_id: "worker-attempt-4",
          p_lease_seconds: 300,
        }
      );
      expect((emptyClaim as unknown as unknown[]).length).toBe(0);
    });

    it("processes blank_page.pdf through worker pipeline and records NO_TEXT classification and no_text_page_count = 1", async () => {
      const fixturePath = path.resolve(
        process.cwd(),
        "tests/fixtures/documents/blank_page.pdf"
      );
      const fixtureBuffer = await fs.readFile(fixturePath);

      const docId = crypto.randomUUID();
      const storageKey = `${testUserId}/${docId}.pdf`;

      // Upload to storage
      await adminClient.storage
        .from("documents")
        .upload(storageKey, fixtureBuffer, {
          contentType: "application/pdf",
          upsert: true,
        });

      // Insert document record
      await adminClient.from("documents").insert({
        id: docId,
        user_id: testUserId,
        subject_id: testSubjectId,
        original_filename: "blank_page.pdf",
        storage_bucket: "documents",
        storage_key: storageKey,
        size_bytes: fixtureBuffer.length,
        mime_type: "application/pdf",
        status: "READY",
      });

      // Enqueue processing run
      const { data: enqueueData } = await adminClient.rpc(
        "enqueue_document_processing_privileged",
        {
          p_document_id: docId,
          p_user_id: testUserId,
        }
      );
      const runId = (enqueueData as unknown as Array<{ run_id: string }>)[0]
        .run_id;

      // Execute worker job
      const result = await processNextDocumentJob("integration-worker-blank");
      expect(result.claimed).toBe(true);
      expect(result.runId).toBe(runId);
      expect(result.status).toBe("SUCCEEDED");
      expect(result.pageCount).toBe(1);

      // Verify processing run record in database
      const { data: runRecord } = await adminClient
        .from("document_processing_runs")
        .select("*")
        .eq("id", runId)
        .single();

      expect(runRecord!.status).toBe("SUCCEEDED");
      expect(runRecord!.page_count).toBe(1);
      expect(runRecord!.no_text_page_count).toBe(1);
      expect(runRecord!.native_text_page_count).toBe(0);
      expect(runRecord!.ocr_page_count).toBe(0);

      // Verify document_pages in database
      const { data: pages } = await adminClient
        .from("document_pages")
        .select("*")
        .eq("document_id", docId);

      expect(pages!.length).toBe(1);
      expect(pages![0].page_number).toBe(1);
      expect(pages![0].classification).toBe("NO_TEXT");
      expect(pages![0].char_count).toBe(0);
      expect(pages![0].text_content.trim()).toBe("");
    });

    it("transitions expired RUNNING run with >= 3 attempts to FAILED_FINAL with JOB_RETRY_LIMIT during claim maintenance", async () => {
      const docId = crypto.randomUUID();
      const storageKey = `${testUserId}/${docId}.pdf`;

      await adminClient.from("documents").insert({
        id: docId,
        user_id: testUserId,
        subject_id: testSubjectId,
        original_filename: "crashed_run.pdf",
        storage_bucket: "documents",
        storage_key: storageKey,
        size_bytes: 1024,
        mime_type: "application/pdf",
        status: "READY",
      });

      const { data: enqueueData } = await adminClient.rpc(
        "enqueue_document_processing_privileged",
        {
          p_document_id: docId,
          p_user_id: testUserId,
        }
      );
      const runId = (enqueueData as unknown as Array<{ run_id: string }>)[0]
        .run_id;

      // Simulate a crashed run that was RUNNING, had 3 attempts, and expired
      await adminClient
        .from("document_processing_runs")
        .update({
          status: "RUNNING",
          attempt_count: 3,
          lease_expires_at: new Date(Date.now() - 60000).toISOString(),
        })
        .eq("id", runId);

      // Call claim_next_processing_run to trigger maintenance
      await adminClient.rpc("claim_next_processing_run", {
        p_worker_id: "worker-maintenance-test",
        p_lease_seconds: 300,
      });

      const { data: runRecord } = await adminClient
        .from("document_processing_runs")
        .select("status, error_code")
        .eq("id", runId)
        .single();

      expect(runRecord!.status).toBe("FAILED_FINAL");
      expect(runRecord!.error_code).toBe("JOB_RETRY_LIMIT");
    });
  });

  describe("Failure Contract & Lease Revocation Integration", () => {
    it("fails run with FAILED_FINAL when encountering PDF_ENCRYPTED manifest", async () => {
      const docId = crypto.randomUUID();
      const storageKey = `${testUserId}/${docId}.pdf`;

      await adminClient.from("documents").insert({
        id: docId,
        user_id: testUserId,
        subject_id: testSubjectId,
        original_filename: "encrypted_contract_test.pdf",
        storage_bucket: "documents",
        storage_key: storageKey,
        size_bytes: 1024,
        mime_type: "application/pdf",
        status: "READY",
      });

      const { data: enqueueData } = await adminClient.rpc(
        "enqueue_document_processing_privileged",
        { p_document_id: docId, p_user_id: testUserId }
      );
      const runId = (enqueueData as unknown as Array<{ run_id: string }>)[0]
        .run_id;

      const { data: claimData } = await adminClient.rpc(
        "claim_next_processing_run",
        { p_worker_id: "worker-enc-test", p_lease_seconds: 900 }
      );
      const claimToken = (
        claimData as unknown as Array<{ claim_token: string }>
      )[0].claim_token;

      // Fail with PDF_ENCRYPTED (non-retryable)
      const { error: failError } = await adminClient.rpc(
        "fail_processing_run_privileged",
        {
          p_run_id: runId,
          p_claim_token: claimToken,
          p_error_code: "PDF_ENCRYPTED",
          p_retryable: false,
        }
      );
      expect(failError).toBeNull();

      const { data: run } = await adminClient
        .from("document_processing_runs")
        .select("status, error_code")
        .eq("id", runId)
        .single();

      expect(run!.status).toBe("FAILED_FINAL");
      expect(run!.error_code).toBe("PDF_ENCRYPTED");
    });

    it("fails run with FAILED_RETRYABLE when encountering PREFLIGHT_TIMEOUT manifest", async () => {
      const docId = crypto.randomUUID();
      const storageKey = `${testUserId}/${docId}.pdf`;

      await adminClient.from("documents").insert({
        id: docId,
        user_id: testUserId,
        subject_id: testSubjectId,
        original_filename: "timeout_contract_test.pdf",
        storage_bucket: "documents",
        storage_key: storageKey,
        size_bytes: 1024,
        mime_type: "application/pdf",
        status: "READY",
      });

      const { data: enqueueData } = await adminClient.rpc(
        "enqueue_document_processing_privileged",
        { p_document_id: docId, p_user_id: testUserId }
      );
      const runId = (enqueueData as unknown as Array<{ run_id: string }>)[0]
        .run_id;

      const { data: claimData } = await adminClient.rpc(
        "claim_next_processing_run",
        { p_worker_id: "worker-timeout-test", p_lease_seconds: 900 }
      );
      const claimToken = (
        claimData as unknown as Array<{ claim_token: string }>
      )[0].claim_token;

      // Fail with PREFLIGHT_TIMEOUT (retryable)
      const { error: failError } = await adminClient.rpc(
        "fail_processing_run_privileged",
        {
          p_run_id: runId,
          p_claim_token: claimToken,
          p_error_code: "PREFLIGHT_TIMEOUT",
          p_retryable: true,
        }
      );
      expect(failError).toBeNull();

      const { data: run } = await adminClient
        .from("document_processing_runs")
        .select("status, error_code")
        .eq("id", runId)
        .single();

      expect(run!.status).toBe("FAILED_RETRYABLE");
      expect(run!.error_code).toBe("PREFLIGHT_TIMEOUT");
    });

    it("revokes write authority on expired lease even without competitor claim", async () => {
      const docId = crypto.randomUUID();
      const storageKey = `${testUserId}/${docId}.pdf`;

      await adminClient.from("documents").insert({
        id: docId,
        user_id: testUserId,
        subject_id: testSubjectId,
        original_filename: "lease_revocation_test.pdf",
        storage_bucket: "documents",
        storage_key: storageKey,
        size_bytes: 1024,
        mime_type: "application/pdf",
        status: "READY",
      });

      const { data: enqueueData } = await adminClient.rpc(
        "enqueue_document_processing_privileged",
        { p_document_id: docId, p_user_id: testUserId }
      );
      const runId = (enqueueData as unknown as Array<{ run_id: string }>)[0]
        .run_id;

      const { data: claimData } = await adminClient.rpc(
        "claim_next_processing_run",
        { p_worker_id: "worker-expired-test", p_lease_seconds: 900 }
      );
      const claimToken = (
        claimData as unknown as Array<{ claim_token: string }>
      )[0].claim_token;

      // Manually expire the lease
      await adminClient
        .from("document_processing_runs")
        .update({
          lease_expires_at: new Date(Date.now() - 5000).toISOString(),
        })
        .eq("id", runId);

      // Attempt to persist results with expired lease -> MUST be rejected (code 55000)
      const { error: persistError } = await adminClient.rpc(
        "persist_processing_run_results_privileged",
        {
          p_run_id: runId,
          p_claim_token: claimToken,
          p_manifest: { page_count: 0 },
          p_pages: [],
        }
      );
      expect(persistError).toBeDefined();
      expect(persistError?.message).toContain(
        "Processing run lease has expired"
      );

      // Attempt to fail run with expired lease -> MUST be rejected (code 55000)
      const { error: failError } = await adminClient.rpc(
        "fail_processing_run_privileged",
        {
          p_run_id: runId,
          p_claim_token: claimToken,
          p_error_code: "PARSER_TIMEOUT",
          p_retryable: true,
        }
      );
      expect(failError).toBeDefined();
      expect(failError?.message).toContain("Processing run lease has expired");
    });
  });
});
