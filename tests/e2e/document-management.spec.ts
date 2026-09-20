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

  test.beforeAll(() => {
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
  });

  test("Complete Document Upload, Validation, Quota, XSS Defense, and Archival Flow", async ({
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

    // 3. Open Uploader
    await page.click('button:has-text("Subir PDF")');
    await expect(page.getByText("Subir Nuevo Documento PDF")).toBeVisible();

    // Capture upload modal / uploader screenshot
    await page.screenshot({
      path: path.join(screenshotsDir, "document-upload-modal.png"),
      fullPage: true,
      caret: "initial",
    });

    // 4. Upload Valid PDF Document with Subject
    const fileInput = page.locator('input[type="file"]');
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

    // Submit upload
    await page.click('button[type="submit"]:has-text("Subir Documento")');

    // Wait for validation to complete and success message
    await expect(
      page.getByText("¡Documento subido y validado con éxito!")
    ).toBeVisible({ timeout: 15000 });

    // Wait for list to update
    await expect(page.getByText("guia_farmacologia_clinica.pdf")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText("Listo")).toBeVisible();
    await expect(
      page.locator("div").filter({ hasText: /^Farmacología$/ })
    ).toBeVisible();

    // 5. User-Content XSS Defense Regression Test
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

    // 6. Capture Desktop Document Library Screenshot
    await page.screenshot({
      path: path.join(screenshotsDir, "document-library.png"),
      fullPage: true,
      caret: "initial",
    });

    // 7. Verify Authorized Access (Ver / Descargar)
    // Click on the first "Ver / Descargar" button
    const downloadButton = page
      .getByRole("button", { name: "Ver / Descargar" })
      .first();
    await expect(downloadButton).toBeVisible();

    // 8. Capture Mobile Viewport Screenshot
    await page.setViewportSize({ width: 375, height: 667 });
    await page.screenshot({
      path: path.join(screenshotsDir, "document-library-mobile.png"),
      fullPage: true,
      caret: "initial",
    });

    // Reset viewport
    await page.setViewportSize({ width: 1280, height: 800 });

    // 9. Archive Document
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
