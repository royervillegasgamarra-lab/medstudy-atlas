import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import * as crypto from "crypto";
import type { Database } from "@/types/database";
import {
  processNextStudyPackJob,
  claimNextStudyPackJob,
} from "@/workers/study-packs-worker";
import {
  requestStudyPackGeneration,
  getStudyPack,
} from "@/modules/study-packs/service";
import { MockAIProvider } from "@/modules/ai/mock-provider";

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

describe("Study Pack Worker & Evidence Layer Integration (Phase 1E)", () => {
  let adminClient: SupabaseClient<Database>;
  let testUserId: string;
  let testSubjectId: string;
  let mockAiProvider: MockAIProvider;

  const testEmail = `study.pack.test.${Date.now()}@test.local`;
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
        name: "Farmacologia Integrada",
      })
      .select("id")
      .single();
    expect(subjectError).toBeNull();
    testSubjectId = subject!.id;

    mockAiProvider = new MockAIProvider();
  });

  afterAll(async () => {
    if (testUserId) {
      await adminClient.auth.admin.deleteUser(testUserId);
    }
  });

  // Helper to create a complete document with a SUCCEEDED processing run and pages
  async function createSucceededDocumentWithPages(
    pageTexts: string[] = [
      "Página 1: Los betalactámicos inhiben la síntesis de la pared celular bacteriana uniendo transpeptidasas PBPs.",
      "Página 2: La resistencia a meticilina en S. aureus está mediada por el gen mecA que codifica la PBP2a.",
    ]
  ) {
    const docId = crypto.randomUUID();
    const runId = crypto.randomUUID();

    // 1. Insert document
    const { error: docErr } = await adminClient.from("documents").insert({
      id: docId,
      user_id: testUserId,
      subject_id: testSubjectId,
      original_filename: `farmaco-lecture-${Date.now()}.pdf`,
      storage_provider: "supabase_s3",
      storage_bucket: "documents",
      storage_key: `${testUserId}/${docId}.pdf`,
      mime_type: "application/pdf",
      size_bytes: 1024 * 50,
      status: "READY",
    });
    expect(docErr).toBeNull();

    // 2. Insert SUCCEEDED processing run
    const { error: runErr } = await adminClient
      .from("document_processing_runs")
      .insert({
        id: runId,
        document_id: docId,
        user_id: testUserId,
        status: "SUCCEEDED",
        attempt_count: 1,
        page_count: pageTexts.length,
      });
    expect(runErr).toBeNull();

    // 3. Insert document pages
    const pageRows = pageTexts.map((text, idx) => ({
      id: crypto.randomUUID(),
      document_id: docId,
      processing_run_id: runId,
      user_id: testUserId,
      page_number: idx + 1,
      text_content: text,
      char_count: text.length,
      native_char_count: text.length,
      ocr_char_count: 0,
      classification: "TEXT_BASED",
      extraction_method: "NATIVE",
      width_points: 595,
      height_points: 842,
      rotation_degrees: 0,
      text_sha256: crypto
        .createHash("sha256")
        .update(text, "utf8")
        .digest("hex"),
    }));

    const { error: pagesErr } = await adminClient
      .from("document_pages")
      .insert(pageRows);
    expect(pagesErr).toBeNull();

    return { docId, runId, pageRows };
  }

  it("claims a pending study pack, generates chunks, runs 2-call pipeline, and persists results", async () => {
    const { docId } = await createSucceededDocumentWithPages();

    // 1. Enqueue generation
    const enqueueRes = await requestStudyPackGeneration(docId, testUserId);
    expect(enqueueRes.studyPackId).toBeDefined();
    expect(enqueueRes.status).toBe("PENDING");

    // 2. Process job via worker with MockAIProvider
    const workerRes = await processNextStudyPackJob({
      aiProvider: mockAiProvider,
    });

    expect(workerRes.claimed).toBe(true);
    expect(workerRes.studyPackId).toBe(enqueueRes.studyPackId);
    expect(workerRes.status).toBe("READY");

    // 3. Verify database state
    const { data: pack, error: packErr } = await adminClient
      .from("study_packs")
      .select("*")
      .eq("id", enqueueRes.studyPackId)
      .single();

    expect(packErr).toBeNull();
    expect(pack).not.toBeNull();
    expect(pack!.status).toBe("READY");
    expect(pack!.error_code).toBeNull();
    expect(pack!.source_page_count).toBe(2);
    expect(pack!.source_chunk_count).toBe(2);
    expect(pack!.evidence_chunk_count).toBeGreaterThan(0);

    // Verify items were persisted
    const { data: items } = await adminClient
      .from("study_pack_items")
      .select("*")
      .eq("study_pack_id", enqueueRes.studyPackId);

    expect(items).toBeDefined();
    expect(items!.length).toBeGreaterThanOrEqual(5);

    // Verify citations were persisted with chunk FK
    const { data: citations } = await adminClient
      .from("study_pack_item_citations")
      .select("*")
      .eq("study_pack_id", enqueueRes.studyPackId);

    expect(citations).toBeDefined();
    expect(citations!.length).toBeGreaterThanOrEqual(items!.length);
  });

  it("serves cached Study Pack with zero AI provider calls on subsequent reads", async () => {
    const { docId } = await createSucceededDocumentWithPages();
    await requestStudyPackGeneration(docId, testUserId);

    await processNextStudyPackJob({ aiProvider: mockAiProvider });

    const aiCallsBefore = mockAiProvider.callCount;

    // Fetch Study Pack via service
    const packView = await getStudyPack(docId, testUserId);
    expect(packView).not.toBeNull();
    expect(packView?.status).toBe("READY");
    expect(packView?.items.length).toBeGreaterThanOrEqual(5);
    expect(packView?.items[0].citations.length).toBeGreaterThan(0);

    // Verify AI call count did NOT increase
    expect(mockAiProvider.callCount).toBe(aiCallsBefore);
  });

  it("denies worker persistence when lease expires (fencing invariant)", async () => {
    const { docId } = await createSucceededDocumentWithPages();
    const enqueueRes = await requestStudyPackGeneration(docId, testUserId);

    // Claim the job manually
    const workerId = `test-worker-${Date.now()}`;
    const claim = await claimNextStudyPackJob(workerId, 60);
    expect(claim).not.toBeNull();
    expect(claim?.study_pack_id).toBe(enqueueRes.studyPackId);

    // Simulate lease expiration by updating lease_expires_at to the past
    await adminClient
      .from("study_packs")
      .update({ lease_expires_at: new Date(Date.now() - 5000).toISOString() })
      .eq("id", enqueueRes.studyPackId);

    // Attempt to persist results with expired lease
    const { error: persistErr } = await adminClient.rpc(
      "persist_study_pack_results_privileged",
      {
        p_study_pack_id: enqueueRes.studyPackId,
        p_claim_token: claim!.claim_token,
        p_provider: "mock-provider",
        p_model: "mock-model",
        p_input_tokens: 100,
        p_output_tokens: 50,
        p_cached_tokens: 0,
        p_estimated_cost_usd: 0,
        p_source_page_count: 2,
        p_source_chunk_count: 2,
        p_evidence_chunk_count: 2,
        p_evidence_char_count: 200,
        p_items: [] as unknown as import("@/types/database").Json,
        p_citations: [] as unknown as import("@/types/database").Json,
      }
    );

    expect(persistErr).not.toBeNull();
    expect(persistErr?.code).toBe("55000"); // Object not in prerequisite state
    expect(persistErr?.message).toContain(
      "Worker lease expired or null; write revoked"
    );
  });

  it("cancels active study pack when document is archived and revokes worker writes", async () => {
    const { docId } = await createSucceededDocumentWithPages();
    const enqueueRes = await requestStudyPackGeneration(docId, testUserId);

    const workerId = `test-worker-archive-${Date.now()}`;
    const claim = await claimNextStudyPackJob(workerId, 60);
    expect(claim).not.toBeNull();

    // Archive document while job is claimed
    const { error: archiveErr } = await adminClient.rpc(
      "archive_document_privileged",
      {
        p_document_id: docId,
        p_user_id: testUserId,
      }
    );
    expect(archiveErr).toBeNull();

    // Verify study pack status was set to FAILED_FINAL (DOCUMENT_ARCHIVED)
    const { data: pack } = await adminClient
      .from("study_packs")
      .select("status, error_code")
      .eq("id", enqueueRes.studyPackId)
      .single();

    expect(pack?.status).toBe("FAILED_FINAL");
    expect(pack?.error_code).toBe("DOCUMENT_ARCHIVED");

    // Attempt to persist results from stale worker
    const { error: persistErr } = await adminClient.rpc(
      "persist_study_pack_results_privileged",
      {
        p_study_pack_id: enqueueRes.studyPackId,
        p_claim_token: claim!.claim_token,
        p_provider: "mock-provider",
        p_model: "mock-model",
        p_input_tokens: 100,
        p_output_tokens: 50,
        p_cached_tokens: 0,
        p_estimated_cost_usd: 0,
        p_source_page_count: 2,
        p_source_chunk_count: 2,
        p_evidence_chunk_count: 2,
        p_evidence_char_count: 200,
        p_items: [] as unknown as import("@/types/database").Json,
        p_citations: [] as unknown as import("@/types/database").Json,
      }
    );

    expect(persistErr).not.toBeNull();
    expect(persistErr?.code).toBe("55000");
  });

  it("transitions to FAILED_RETRYABLE on transient errors up to attempt budget (3)", async () => {
    const { docId } = await createSucceededDocumentWithPages();
    const enqueueRes = await requestStudyPackGeneration(docId, testUserId);

    // Enqueue an AI rate limit error
    mockAiProvider.enqueueError("AI_RATE_LIMITED", "Rate limit reached", true);

    const workerRes = await processNextStudyPackJob({
      aiProvider: mockAiProvider,
    });

    expect(workerRes.claimed).toBe(true);
    expect(workerRes.status).toBe("FAILED");
    expect(workerRes.errorCode).toBe("AI_RATE_LIMITED");

    const { data: pack } = await adminClient
      .from("study_packs")
      .select("status, error_code, attempt_count")
      .eq("id", enqueueRes.studyPackId)
      .single();

    expect(pack?.status).toBe("FAILED_RETRYABLE");
    expect(pack?.error_code).toBe("AI_RATE_LIMITED");
    expect(pack?.attempt_count).toBe(1);
  });

  it("fails immediately as FAILED_FINAL when AI generation is disabled (kill switch)", async () => {
    const { docId } = await createSucceededDocumentWithPages();
    const enqueueRes = await requestStudyPackGeneration(docId, testUserId);

    const { serverEnv } = await import("@/config/server-env");
    const originalEnabled = serverEnv.AI_GENERATION_ENABLED;

    try {
      // Trip the kill switch
      (serverEnv as Record<string, unknown>).AI_GENERATION_ENABLED = false;

      // Process job without passing forced provider so it attempts getAIProvider()
      const workerRes = await processNextStudyPackJob();

      expect(workerRes.claimed).toBe(true);
      expect(workerRes.status).toBe("FAILED");
      expect(workerRes.errorCode).toBe("AI_DISABLED");

      // Verify the study pack transitioned immediately to FAILED_FINAL
      const { data: pack } = await adminClient
        .from("study_packs")
        .select("status, error_code")
        .eq("id", enqueueRes.studyPackId)
        .single();

      expect(pack?.status).toBe("FAILED_FINAL");
      expect(pack?.error_code).toBe("AI_DISABLED");
    } finally {
      (serverEnv as Record<string, unknown>).AI_GENERATION_ENABLED =
        originalEnabled;
    }
  });

  it("rejects version mismatch immediately with STUDY_PACK_VERSION_UNSUPPORTED", async () => {
    const { docId } = await createSucceededDocumentWithPages();
    const enqueueRes = await requestStudyPackGeneration(docId, testUserId);

    // Tamper with job version in database
    await adminClient
      .from("study_packs")
      .update({ chunking_version: "chunk-v999" })
      .eq("id", enqueueRes.studyPackId);

    const workerRes = await processNextStudyPackJob({
      aiProvider: mockAiProvider,
    });

    expect(workerRes.claimed).toBe(true);
    expect(workerRes.status).toBe("FAILED");
    expect(workerRes.errorCode).toBe("STUDY_PACK_VERSION_UNSUPPORTED");

    const { data: pack } = await adminClient
      .from("study_packs")
      .select("status, error_code")
      .eq("id", enqueueRes.studyPackId)
      .single();

    expect(pack?.status).toBe("FAILED_FINAL");
    expect(pack?.error_code).toBe("STUDY_PACK_VERSION_UNSUPPORTED");
  });
});
