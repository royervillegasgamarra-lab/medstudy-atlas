import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs";

test.describe("Phase 1B: Curriculum & Exam Target Management", () => {
  const screenshotsDir = path.resolve(process.cwd(), "docs/screenshots");
  const timestamp = Date.now();
  const userEmail = `curriculum.mgmt.${timestamp}@test.medstudy.local`;
  const userPassword = "Password123!";
  const userName = "Dra. Lucía Paredes";

  test.beforeAll(() => {
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
  });

  test("Subject and Exam Target CRUD & Archival Flow", async ({ page }) => {
    // 1. Signup & quick onboarding
    await page.goto("/auth/signup");
    await page.fill('input[name="fullName"]', userName);
    await page.fill('input[name="email"]', userEmail);
    await page.fill('input[name="password"]', userPassword);
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/onboarding/, { timeout: 15000 });
    await page.click('button:has-text("Omitir")');

    // Add initial subject in onboarding
    await page.fill("input#subjectName", "Inmunología");
    await page.click('button:has-text("Agregar")');
    await page.click('button:has-text("Continuar al Paso 3")');
    await page.click('button:has-text("Omitir y Finalizar")');

    await expect(page).toHaveURL(/\/app/, { timeout: 15000 });

    // 2. SUBJECT MANAGEMENT
    // Create new subject
    await page.click('button:has-text("+ Nueva Asignatura")');
    await page.fill("input#createSubjectInput", "Gastroenterología");
    await page.click('button:has-text("Guardar")');
    await expect(page.getByText("Gastroenterología")).toBeVisible();

    // Capture subjects screenshot
    await page.screenshot({
      path: path.join(screenshotsDir, "subjects.png"),
      fullPage: true,
      caret: "initial",
    });

    // Rename subject
    // Find the card with Gastroenterología and click Renombrar
    const gastroCard = page
      .locator("div")
      .filter({ hasText: /^Gastroenterología/ });
    await gastroCard.getByRole("button", { name: "Renombrar" }).click();
    await page.fill(
      'input[value="Gastroenterología"]',
      "Gastroenterología Clínica"
    );
    await page.click('button:has-text("Guardar")');
    await expect(page.getByText("Gastroenterología Clínica")).toBeVisible();

    // Archive subject
    page.once("dialog", async (dialog) => {
      await dialog.accept();
    });
    const renameCard = page
      .locator("div")
      .filter({ hasText: /^Gastroenterología Clínica/ });
    await renameCard.getByRole("button", { name: "Archivar" }).click();
    await expect(
      page.getByText('"Gastroenterología Clínica" ha sido archivada.')
    ).toBeVisible();
    await expect(
      page.locator("span.font-medium", { hasText: "Gastroenterología Clínica" })
    ).not.toBeVisible();

    // 3. EXAM TARGET MANAGEMENT
    // Create exam target
    await page.click('button:has-text("+ Nuevo Examen")');
    await page.fill("input#examTitleInput", "Simulacro ENAM 1");
    await page.fill("input#examDateInput", "2027-08-15");
    await page.selectOption("select#examSubjectSelect", {
      label: "Inmunología",
    });
    await page.click('button:has-text("Guardar Examen")');

    await expect(
      page.getByRole("heading", { name: "Simulacro ENAM 1" })
    ).toBeVisible();
    await expect(page.getByText("15 de agosto de 2027").first()).toBeVisible();

    // Capture exam targets screenshot
    await page.screenshot({
      path: path.join(screenshotsDir, "exam-targets.png"),
      fullPage: true,
      caret: "initial",
    });

    // Edit exam target
    const examCard = page
      .locator("div")
      .filter({ hasText: /^Simulacro ENAM 1/ });
    await examCard.getByRole("button", { name: "Editar" }).click();
    await page.fill(
      'input[value="Simulacro ENAM 1"]',
      "Simulacro Nacional ENAM 1"
    );
    await page.click('button:has-text("Guardar")');
    await expect(
      page.getByRole("heading", { name: "Simulacro Nacional ENAM 1" })
    ).toBeVisible();

    // Archive exam target
    page.once("dialog", async (dialog) => {
      await dialog.accept();
    });
    const updatedExamCard = page
      .locator("div")
      .filter({ hasText: /^Simulacro Nacional ENAM 1/ });
    await updatedExamCard.getByRole("button", { name: "Archivar" }).click();
    await expect(
      page.getByText('"Simulacro Nacional ENAM 1" ha sido archivado.')
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Simulacro Nacional ENAM 1" })
    ).not.toBeVisible();
    await expect(
      page.locator("span.font-semibold", {
        hasText: "Simulacro Nacional ENAM 1",
      })
    ).not.toBeVisible();
    await expect(
      page.getByText("No tienes exámenes programados")
    ).toBeVisible();
  });

  test("User-content XSS regression: script and html tags rendered as plain text", async ({
    page,
  }) => {
    let dialogFired = false;
    page.on("dialog", () => {
      dialogFired = true;
    });

    // 1. Signup user
    const xssUserEmail = `xss.test.${Date.now()}@test.medstudy.local`;
    await page.goto("/auth/signup");
    await page.fill('input[name="fullName"]', "XSS Test User");
    await page.fill('input[name="email"]', xssUserEmail);
    await page.fill('input[name="password"]', "Password123!");
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/onboarding/, { timeout: 15000 });
    await page.click('button:has-text("Omitir")');

    // Add subject with script/html payload
    const subjectXssPayload =
      "<script>window.__xss_subject = true;</script><b>Anatomía</b>";
    await page.fill("input#subjectName", subjectXssPayload);
    await page.click('button:has-text("Agregar")');
    await page.click('button:has-text("Continuar al Paso 3")');

    // Add exam target with script/html payload
    const examXssPayload =
      "<script>window.__xss_exam = true;</script><b>ENAM 2027</b>";
    await page.fill("input#examTitle", examXssPayload);
    await page.fill("input#examDate", "2027-11-20");
    await page.click('button:has-text("Guardar examen y finalizar")');

    await expect(page).toHaveURL(/\/app/, { timeout: 15000 });

    // Verify neither script executed
    const flags = await page.evaluate(() => {
      const win = window as unknown as {
        __xss_subject?: boolean;
        __xss_exam?: boolean;
      };
      return {
        subjectXss: win.__xss_subject,
        examXss: win.__xss_exam,
      };
    });
    expect(flags.subjectXss).toBeUndefined();
    expect(flags.examXss).toBeUndefined();
    expect(dialogFired).toBe(false);

    // Verify both contents are rendered as literal text (HTML is escaped)
    await expect(page.locator("body")).toContainText(
      "<script>window.__xss_subject = true;</script><b>Anatomía</b>"
    );
    await expect(page.locator("body")).toContainText(
      "<script>window.__xss_exam = true;</script><b>ENAM 2027</b>"
    );
  });
});
