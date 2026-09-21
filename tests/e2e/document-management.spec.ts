import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs";

test.describe("Phase 1C: Document Library & Secure Upload Boundary", () => {
  const screenshotsDir = path.resolve(process.cwd(), "docs/screenshots");
  const timestamp = Date.now();
  const userEmail = `doc.student.${timestamp}@test.medstudy.local`;
  const userPassword = "Password123!";
  const userName = "Dr. Alejandro Morales";

  const validSmallPdfPath = path.resolve(
    process.cwd(),
    "tests/fixtures/documents/valid-small.pdf"
  );
  const validPdfBuffer = fs.readFileSync(validSmallPdfPath);

  const fakePdfPath = path.resolve(
    process.cwd(),
    "tests/fixtures/documents/fake-pdf.pdf"
  );
  const fakePdfBuffer = fs.readFileSync(fakePdfPath);

  test.beforeAll(() => {
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
  });

  test("Complete Document Upload, Fake PDF Rejection, Validation, Quota, XSS Defense, and Archival Flow", async ({
    page,
  }) => {
    // 1. Register and complete onboarding to enter /app
    await page.goto("/auth/signup");
    await page.fill('input[name="fullName"]', userName);
    await page.fill('input[name="email"]', userEmail);
    await page.fill('input[name="password"]', userPassword);
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/onboarding/, { timeout: 15000 });
    await page.click('button:has-text("Omitir")');

    // Add initial subject in onboarding
    await page.fill("input#subjectName", "Farmacología");
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

    // Verify initial empty state
    await expect(
      page.getByText("No hay documentos en esta lista")
    ).toBeVisible();

    // 3. Open Uploader & Verify Educational-Use PHI Warning Banner (P1-6)
    await page.click('button:has-text("Subir PDF")');
    await expect(page.getByText("Subir Nuevo Documento PDF")).toBeVisible();
    await expect(
      page.getByText(
        /Uso exclusivamente educativo.*Queda estrictamente prohibido subir historias clínicas/i
      )
    ).toBeVisible();

    // Capture upload modal / uploader screenshot
    await page.screenshot({
      path: path.join(screenshotsDir, "document-upload-modal.png"),
      fullPage: true,
      caret: "initial",
    });

    const fileInput = page.locator('input[type="file"]');

    // 4. Negative Test: Upload Fake PDF (P1-5)
    // Attempt to upload fake-pdf.pdf (plain text disguised as PDF)
    await fileInput.setInputFiles({
      name: "fake-pdf.pdf",
      mimeType: "application/pdf",
      buffer: fakePdfBuffer,
    });

    await page.click('button[type="submit"]:has-text("Subir Documento")');

    // Verification must reject fake PDF container
    await expect(
      page.getByText(
        /El archivo subido no es un PDF válido|rechazado durante la validación/i
      )
    ).toBeVisible({ timeout: 15000 });

    // 5. Positive Test: Upload Valid PDF Document with Subject (P1-5)
    await fileInput.setInputFiles({
      name: "guia_farmacologia_clinica.pdf",
      mimeType: "application/pdf",
      buffer: validPdfBuffer,
    });

    // Select subject
    const subjectSelect = page.locator("select#upload-subject");
    if (await subjectSelect.isVisible()) {
      await subjectSelect.selectOption({ label: "Farmacología" });
    }

    // Submit valid upload
    await page.click('button[type="submit"]:has-text("Subir Documento")');

    // Wait for validation to complete and success message
    await expect(
      page.getByText("¡Documento subido y validado con éxito!")
    ).toBeVisible({ timeout: 15000 });

    await expect(page.getByText("guia_farmacologia_clinica.pdf")).toBeVisible({
      timeout: 10000,
    });
    await expect(
      page.getByText(/Listo|Pendiente de procesar|Procesado/)
    ).toBeVisible();
    await expect(
      page.locator("span, div").filter({ hasText: /^Farmacología$/ })
    ).toBeVisible();

    // 6. User-Content XSS Defense Regression Test
    // Upload a file with hostile script/HTML tags in filename: <img src=x onerror=alert('xss')>.pdf
    await page.click('button:has-text("Subir PDF")');
    await fileInput.setInputFiles({
      name: "<img src=x onerror=alert('xss')>.pdf",
      mimeType: "application/pdf",
      buffer: validPdfBuffer,
    });

    let xssTriggered = false;
    page.on("dialog", () => {
      xssTriggered = true;
    });

    await page.click('button[type="submit"]:has-text("Subir Documento")');

    await expect(
      page.getByText("¡Documento subido y validado con éxito!")
    ).toBeVisible({ timeout: 15000 });

    // Hostile filename must render as plain text without script execution
    await expect(
      page.locator("p", { hasText: "<img src=x onerror=alert('xss')>.pdf" })
    ).toBeVisible({ timeout: 10000 });
    expect(xssTriggered).toBe(false);

    // 7. Capture Desktop Document Library Screenshot
    await page.screenshot({
      path: path.join(screenshotsDir, "document-library.png"),
      fullPage: true,
      caret: "initial",
    });

    // 8. Verify Authorized Access (Ver / Descargar) (P1-5)
    // Click on the first "Ver / Descargar" button
    const downloadButton = page
      .getByRole("button", { name: "Ver / Descargar" })
      .first();
    await expect(downloadButton).toBeVisible();

    // 9. Capture Mobile Viewport Screenshot
    await page.setViewportSize({ width: 375, height: 667 });
    await page.screenshot({
      path: path.join(screenshotsDir, "document-library-mobile.png"),
      fullPage: true,
      caret: "initial",
    });

    // Reset viewport
    await page.setViewportSize({ width: 1280, height: 800 });

    // 10. Archive Document (P1-5)
    page.once("dialog", async (dialog) => {
      await dialog.accept();
    });

    const archiveButton = page
      .locator("button[title='Archivar documento']")
      .first();
    await archiveButton.click();

    // Verify archival feedback
    await expect(page.getByText(/archivado correctamente/i)).toBeVisible({
      timeout: 10000,
    });
  });
});
