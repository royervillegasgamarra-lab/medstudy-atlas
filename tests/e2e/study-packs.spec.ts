import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs";
import { execSync } from "child_process";

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

test.describe("Phase 1E: Study Pack Generation & Citation Evidence UI", () => {
  const screenshotsDir = path.resolve(process.cwd(), "docs/screenshots");
  const timestamp = Date.now();
  const userEmail = `studypack.student.${timestamp}@test.medstudy.local`;
  const userPassword = "Password123!";
  const userName = "Dr. Alejandro Morales";

  const validPdfPath = path.resolve(
    process.cwd(),
    "tests/fixtures/documents/valid_text.pdf"
  );
  const validPdfBuffer = fs.readFileSync(validPdfPath);

  test.beforeAll(() => {
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
  });

  test("end-to-end Study Pack generation, citation badges, and document library badge", async ({
    page,
  }) => {
    // 1. Sign up and complete onboarding
    await page.goto("/auth/signup");
    await page.fill('input[name="fullName"]', userName);
    await page.fill('input[name="email"]', userEmail);
    await page.fill('input[name="password"]', userPassword);
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/onboarding/, { timeout: 15000 });
    await page.click('button:has-text("Omitir")');

    // Add subject
    await page.fill("input#subjectName", "Farmacología Clínica");
    await page.click('button:has-text("Agregar")');
    await page.click('button:has-text("Continuar al Paso 3")');
    await page.click('button:has-text("Omitir y Finalizar")');

    await expect(page).toHaveURL(/\/app/, { timeout: 15000 });

    // 2. Navigate to documents library and upload PDF
    await page.click('a[href="/app/documents"]');
    await expect(page).toHaveURL(/\/app\/documents/);

    await page.click('button:has-text("Subir PDF")');
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: "antibioticos_resistencia.pdf",
      mimeType: "application/pdf",
      buffer: validPdfBuffer,
    });

    await page.click('button[type="submit"]:has-text("Subir Documento")');

    // Wait for upload completion and automatic reload
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("antibioticos_resistencia.pdf")).toBeVisible({
      timeout: 20000,
    });

    // 3. Process document extraction
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        execSync("pnpm worker:documents --once", { stdio: "inherit" });
      } catch {
        // worker may exit 1 if an earlier corrupt run is in queue, continue
      }
      await page.waitForTimeout(1000);
      await page.reload();
      const isProcessed = await page.getByText(/Procesado/).isVisible();
      if (isProcessed) break;
    }

    await expect(page.getByText(/Procesado/)).toBeVisible();

    // 4. Document should initially show "Sin Study Pack" or "Study Pack" CTA button
    const studyPackButton = page.getByRole("button", { name: "Study Pack" });
    await expect(studyPackButton).toBeVisible();

    // Click to go to the Study Pack page
    await studyPackButton.click();
    await expect(page).toHaveURL(/\/app\/documents\/[0-9a-f-]+\/study-pack/);

    // 5. On Study Pack page, verify empty state with CTA
    await expect(
      page.getByRole("heading", {
        name: "Generar Study Pack de Alto Rendimiento",
      })
    ).toBeVisible();
    await expect(page.getByText("100% Fundamentado")).toBeVisible();

    // Click "Comenzar Generación Manual"
    const generateButton = page.getByRole("button", {
      name: "Comenzar Generación Manual",
    });
    await generateButton.click();
    await page.waitForTimeout(1000);

    // 6. Run the Study Pack worker once
    try {
      execSync("pnpm worker:study-packs --once", { stdio: "inherit" });
    } catch (err) {
      console.warn("worker:study-packs --once warning/error:", err);
    }

    await page.waitForTimeout(1000);
    // Refresh the page to view the generated Study Pack
    await page.reload();

    // 7. Verify Study Pack sections are visible
    await expect(page.getByText("Respaldo y Cobertura Evidencial")).toBeVisible(
      { timeout: 15000 }
    );
    await expect(
      page.getByRole("heading", { name: "Resumen General" })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Objetivos de Aprendizaje" })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Conceptos Clave" })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Puntos de Alto Rendimiento/ })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Glosario de Términos Clave" })
    ).toBeVisible();

    // Verify citation badge (e.g. Pág. 1)
    await expect(page.getByText(/Pág\.\s*1/).first()).toBeVisible();

    // Capture screenshot for evidence
    await page.screenshot({
      path: path.join(screenshotsDir, "phase-01e-study-pack-view.png"),
      fullPage: true,
    });

    // 8. Navigate back to documents library
    await page.click('a[href="/app/documents"]');
    await expect(page).toHaveURL(/\/app\/documents/);

    // Verify "Study Pack Listo" badge is visible on the document card
    await expect(page.getByText("Study Pack Listo")).toBeVisible();
  });
});
