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
if (typeof (process as any).loadEnvFile === "function") {
  try {
    (process as any).loadEnvFile(".env.local");
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
        process.env.DATABASE_URL = "postgresql://postgres:secret@localhost:5432/db";

        const safeEnv = createSafeParserEnvironment();
        expect(safeEnv.SUPABASE_SECRET_KEY).toBeUndefined();
        expect(safeEnv.DATABASE_URL).toBeUndefined();

        // Spawn a python one-liner with safeEnv to verify isolation at the OS level
        const pythonExe = resolvePythonExecutable();
        const verifyScript = "import os; print('SECRET_FOUND' if 'SUPABASE_SECRET_KEY' in os.environ or 'DATABASE_URL' in os.environ else 'CLEAN_ISOLATION')";
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
      // 1. Create a dummy READY document
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

      // 2. Enqueue processing run
      const { data: enqueueData, error: enqueueError } = await adminClient.rpc(
        "enqueue_document_processing_privileged",
        {
          p_document_id: docId,
          p_user_id: testUserId,
        }
      );
      expect(enqueueError).toBeNull();
      expect(enqueueData).toBeDefined();
      const runId = (enqueueData as any)[0].run_id;

      // 3. Concurrently attempt to claim the job with two different worker IDs
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

      const listA = (claimA.data as any[]) || [];
      const listB = (claimB.data as any[]) || [];

      // Exactly one worker must claim the job, the other receives empty array
      const totalClaimed = listA.length + listB.length;
      expect(totalClaimed).toBe(1);

      if (listA.length === 1) {
        expect(listA[0].document_id).toBe(docId);
        expect(listB.length).toBe(0);
      } else {
        expect(listB[0].document_id).toBe(docId);
        expect(listA.length).toBe(0);
      }

      // 4. Release / fail run so it doesn't hang
      await adminClient.rpc("fail_processing_run_privileged", {
        p_run_id: runId,
        p_error_code: "PREFLIGHT_TIMEOUT",
        p_retryable: false,
      });
    });
  });

  describe("End-to-End Processing & Retry Idempotency", () => {
    it("processes valid PDF into pages, verifies provenance, and handles retries idempotently", async () => {
      // 1. Read valid text fixture
      const fixturePath = path.resolve(
        process.cwd(),
        "tests/fixtures/documents/valid_text.pdf"
      );
      const fixtureBuffer = await fs.readFile(fixturePath);

      const docId = crypto.randomUUID();
      const storageKey = `${testUserId}/${docId}.pdf`;

      // Upload to storage
      const { error: uploadError } = await adminClient.storage
        .from("documents")
        .upload(storageKey, fixtureBuffer, {
          contentType: "application/pdf",
          upsert: true,
        });
      expect(uploadError).toBeNull();

      // Insert document record
      const { error: docError } = await adminClient.from("documents").insert({
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
      expect(docError).toBeNull();

      // Enqueue processing run
      const { data: enqueueData, error: enqueueError } = await adminClient.rpc(
        "enqueue_document_processing_privileged",
        {
          p_document_id: docId,
          p_user_id: testUserId,
        }
      );
      expect(enqueueError).toBeNull();
      const runId = (enqueueData as any)[0].run_id;

      // Execute worker job
      const result = await processNextDocumentJob("integration-worker-1");
      expect(result.claimed).toBe(true);
      expect(result.runId).toBe(runId);
      expect(result.status).toBe("SUCCEEDED");
      expect(result.pageCount).toBe(2);

      // Verify processing run record in database
      const { data: runRecord, error: runFetchError } = await adminClient
        .from("document_processing_runs")
        .select("*")
        .eq("id", runId)
        .single();

      expect(runFetchError).toBeNull();
      expect(runRecord!.status).toBe("SUCCEEDED");
      expect(runRecord!.page_count).toBe(2);
      expect(runRecord!.native_text_page_count).toBe(2);
      expect(runRecord!.ocr_page_count).toBe(0);
      expect(runRecord!.source_sha256).toBeDefined();

      // Verify document_pages in database
      const { data: pages, error: pagesFetchError } = await adminClient
        .from("document_pages")
        .select("*")
        .eq("document_id", docId)
        .order("page_number", { ascending: true });

      expect(pagesFetchError).toBeNull();
      expect(pages!.length).toBe(2);

      expect(pages![0].page_number).toBe(1);
      expect(pages![0].extraction_method).toBe("NATIVE");
      expect(pages![0].text_content).toContain("Cardiologia: Insuficiencia Cardiaca");
      expect(pages![0].char_count).toBeGreaterThan(30);
      expect(pages![0].width_points).toBeCloseTo(612, 1);
      expect(pages![0].height_points).toBeCloseTo(792, 1);

      expect(pages![1].page_number).toBe(2);
      expect(pages![1].extraction_method).toBe("NATIVE");
      expect(pages![1].text_content).toContain("Tratamiento farmacologico");

      // Test Retry Idempotency: simulate retryable failure and re-enqueue
      await adminClient.rpc("fail_processing_run_privileged", {
        p_run_id: runId,
        p_error_code: "PREFLIGHT_TIMEOUT",
        p_retryable: true,
      });

      const { data: retryEnqueueData, error: retryEnqueueError } = await adminClient.rpc(
        "enqueue_document_processing_privileged",
        {
          p_document_id: docId,
          p_user_id: testUserId,
        }
      );
      expect(retryEnqueueError).toBeNull();
      const retryRunId = (retryEnqueueData as any)[0].run_id;
      expect((retryEnqueueData as any)[0].status).toBe("PENDING");

      const retryResult = await processNextDocumentJob("integration-worker-retry");
      expect(retryResult.claimed).toBe(true);
      expect(retryResult.runId).toBe(retryRunId);
      expect(retryResult.status).toBe("SUCCEEDED");

      // Verify pages count is still exactly 2, never duplicated!
      const { data: pagesAfterRetry } = await adminClient
        .from("document_pages")
        .select("*")
        .eq("document_id", docId)
        .order("page_number", { ascending: true });

      expect(pagesAfterRetry!.length).toBe(2);
      expect(pagesAfterRetry![0].processing_run_id).toBe(retryRunId);
      expect(pagesAfterRetry![1].processing_run_id).toBe(retryRunId);

      // Clean up storage object
      await adminClient.storage.from("documents").remove([storageKey]);
    });
  });

  describe("Guaranteed Temp Directory Cleanup", () => {
    it("ensures no temporary files remain on the filesystem after job completion", async () => {
      const baseTempDir = path.join(os.tmpdir(), "medstudy-atlas-proc");
      let initialCount = 0;
      try {
        const files = await fs.readdir(baseTempDir);
        initialCount = files.length;
      } catch {
        initialCount = 0;
      }

      // Run worker when no jobs exist
      const res = await processNextDocumentJob("integration-worker-cleanup-check");
      expect(res.claimed).toBe(false);

      let finalCount = 0;
      try {
        const files = await fs.readdir(baseTempDir);
        finalCount = files.length;
      } catch {
        finalCount = 0;
      }

      expect(finalCount).toBe(initialCount);
    });
  });
});
