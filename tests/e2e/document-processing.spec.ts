import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { execSync } from "child_process";
import { createClient } from "@supabase/supabase-js";

// Load local environment variables for Playwright runner
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

test.describe("Phase 1D: Secure Document Processing & Provenance UI", () => {
  const screenshotsDir = path.resolve(process.cwd(), "docs/screenshots");
  const timestamp = Date.now();
  const userEmail = `proc.student.${timestamp}@test.medstudy.local`;
  const userPassword = "Password123!";
  const userName = "Dra. Sofia Mendoza";

  const validSmallPdfPath = path.resolve(
    process.cwd(),
    "tests/fixtures/documents/valid_text.pdf"
  );
  const validPdfBuffer = fs.readFileSync(validSmallPdfPath);

  test.beforeAll(() => {
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
  });

  test("Document Library displays processing lifecycle status and retry capability", async ({
    page,
  }) => {
    // 1. Register and complete onboarding
    await page.goto("/auth/signup");
    await page.fill('input[name="fullName"]', userName);
    await page.fill('input[name="email"]', userEmail);
    await page.fill('input[name="password"]', userPassword);
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/onboarding/, { timeout: 15000 });
    await page.click('button:has-text("Omitir")');

    // Add initial subject
    await page.fill("input#subjectName", "Cardiología");
    await page.click('button:has-text("Agregar")');
    await page.click('button:has-text("Continuar al Paso 3")');
    await page.click('button:has-text("Omitir y Finalizar")');

    await expect(page).toHaveURL(/\/app/, { timeout: 15000 });

    // 2. Navigate to /app/documents
    await page.click('a[href="/app/documents"]');
    await expect(page).toHaveURL(/\/app\/documents/);
    await expect(
      page.getByRole("heading", { name: "Biblioteca de Documentos" })
    ).toBeVisible();

    // 3. Upload a document
    await page.click('button:has-text("Subir PDF")');
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: "fisiopatologia_cardiaca.pdf",
      mimeType: "application/pdf",
      buffer: validPdfBuffer,
    });

    await page.click('button[type="submit"]:has-text("Subir Documento")');

    // Wait for successful upload and page reload
    await expect(page.getByText("fisiopatologia_cardiaca.pdf")).toBeVisible({
      timeout: 20000,
    });

    // Verify initial processing status is "Pendiente de procesar"
    await expect(
      page.getByText(/Pendiente de procesar|Procesando/)
    ).toBeVisible();

    // 4. Process queued documents until our document transitions to SUCCEEDED
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        execSync("pnpm worker:documents --once", { stdio: "inherit" });
      } catch {
        // worker may exit with 1 if an earlier corrupt document failed, continue processing queue
      }
      await page.reload();
      const isDone = await page.getByText(/Procesado/).isVisible();
      if (isDone) break;
      await page.waitForTimeout(1000);
    }

    // 5. Verify status transitions to "Procesado"
    await page.reload();
    await expect(page.getByText(/Procesado/)).toBeVisible({ timeout: 15000 });

    // Capture screenshot of processed document in library
    await page.screenshot({
      path: path.join(screenshotsDir, "document-processing-status.png"),
      fullPage: true,
      caret: "initial",
    });

    // 6. Create a separate document and run that fails legitimately via fail_processing_run_privileged
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321",
      process.env.SUPABASE_SECRET_KEY!
    );

    const { data: firstDoc } = await supabaseAdmin
      .from("documents")
      .select("id, user_id, subject_id")
      .eq("original_filename", "fisiopatologia_cardiaca.pdf")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    expect(firstDoc?.user_id).toBeDefined();

    const retryDocId = crypto.randomUUID();
    const retryStorageKey = `${firstDoc!.user_id}/${retryDocId}.pdf`;

    // Upload PDF to storage
    await supabaseAdmin.storage
      .from("documents")
      .upload(retryStorageKey, validPdfBuffer, {
        contentType: "application/pdf",
        upsert: true,
      });

    // Insert READY document
    await supabaseAdmin.from("documents").insert({
      id: retryDocId,
      user_id: firstDoc!.user_id,
      subject_id: firstDoc!.subject_id,
      original_filename: "documento_fallido_reintento.pdf",
      storage_bucket: "documents",
      storage_key: retryStorageKey,
      size_bytes: validPdfBuffer.length,
      mime_type: "application/pdf",
      status: "READY",
    });

    // Enqueue processing run
    const { data: enqueueData } = await supabaseAdmin.rpc(
      "enqueue_document_processing_privileged",
      {
        p_document_id: retryDocId,
        p_user_id: firstDoc!.user_id,
      }
    );
    const retryRunId = (enqueueData as unknown as Array<{ run_id: string }>)[0]
      .run_id;

    // Claim run via claim_next_processing_run
    const { data: claimData } = await supabaseAdmin.rpc(
      "claim_next_processing_run",
      {
        p_worker_id: "e2e-worker-sim",
        p_lease_seconds: 900,
      }
    );
    const claimToken = (
      claimData as unknown as Array<{ claim_token: string }>
    )[0].claim_token;

    // Call legitimate fail_processing_run_privileged RPC with matching claim_token and retryable=true
    const { error: failRpcError } = await supabaseAdmin.rpc(
      "fail_processing_run_privileged",
      {
        p_run_id: retryRunId,
        p_claim_token: claimToken,
        p_error_code: "PREFLIGHT_TIMEOUT",
        p_retryable: true,
      }
    );
    expect(failRpcError).toBeNull();

    await page.reload();
    await expect(page.getByText("documento_fallido_reintento.pdf")).toBeVisible(
      {
        timeout: 10000,
      }
    );

    const failedDocRow = page
      .locator("div")
      .filter({ hasText: "documento_fallido_reintento.pdf" })
      .filter({ has: page.getByRole("button", { name: /Archivar/i }) })
      .first();
    await expect(failedDocRow.getByText("Error al procesar")).toBeVisible({
      timeout: 10000,
    });
    const retryBtn = failedDocRow.getByRole("button", { name: /Reintentar/i });
    await expect(retryBtn).toBeVisible();

    // Capture screenshot of failed processing state with retry button
    await page.screenshot({
      path: path.join(screenshotsDir, "document-processing-retry.png"),
      fullPage: true,
      caret: "initial",
    });

    // 7. Click retry button and verify status returns to "Pendiente de procesar"
    await retryBtn.click();
    await expect(
      page.getByText("Procesamiento reencolado exitosamente.")
    ).toBeVisible({ timeout: 10000 });
    await expect(failedDocRow.getByText("Pendiente de procesar")).toBeVisible();

    // 8. Auto-enqueue recovery: delete processing run for this document to verify "Procesar" recovery UI
    await supabaseAdmin
      .from("document_processing_runs")
      .delete()
      .eq("document_id", retryDocId);

    await page.reload();

    const recoveryDocRow = page
      .locator("div")
      .filter({ hasText: "documento_fallido_reintento.pdf" })
      .filter({ has: page.getByRole("button", { name: /Archivar/i }) })
      .first();

    // Verify "Procesar" recovery button is visible
    const procesarBtn = recoveryDocRow.getByRole("button", {
      name: /Procesar/i,
    });
    await expect(procesarBtn).toBeVisible({ timeout: 10000 });

    // Click "Procesar" to trigger auto-enqueue recovery
    await procesarBtn.click();
    await expect(
      page.getByText("Procesamiento reencolado exitosamente.")
    ).toBeVisible({ timeout: 10000 });
    await expect(
      recoveryDocRow.getByText("Pendiente de procesar")
    ).toBeVisible();
  });
});
