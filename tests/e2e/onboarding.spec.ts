import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs";

test.describe("Phase 1B: Student Onboarding Flow & Resumability", () => {
  const screenshotsDir = path.resolve(process.cwd(), "docs/screenshots");
  const timestamp = Date.now();

  test.beforeAll(() => {
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
  });

  test("Scenario 1: Onboarding with subject and skipped exam reaches /app", async ({
    page,
  }) => {
    const email = `onboarding.skip.${timestamp}@test.medstudy.local`;
    const password = "Password123!";
    const name = "Dr. Pedro Alva";

    // 1. Signup
    await page.goto("/auth/signup");
    await page.fill('input[name="fullName"]', name);
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', password);
    await page.click('button[type="submit"]');

    // Lands on /onboarding
    await expect(page).toHaveURL(/\/onboarding/, { timeout: 15000 });
    await expect(page.locator("h1")).toContainText(
      "Bienvenido a MedStudy Atlas"
    );

    // Capture Desktop Onboarding Screenshot
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.screenshot({
      path: path.join(screenshotsDir, "onboarding-desktop.png"),
      fullPage: true,
      caret: "initial",
    });

    // Capture Mobile Onboarding Screenshot
    await page.setViewportSize({ width: 375, height: 667 });
    await page.screenshot({
      path: path.join(screenshotsDir, "onboarding-mobile.png"),
      fullPage: true,
      caret: "initial",
    });
    await page.setViewportSize({ width: 1280, height: 800 });

    // Step 1: Academic context
    await page.fill("input#medicalSchool", "Universidad Nacional de Trujillo");
    await page.selectOption("select#yearOfStudy", "4");
    await page.click('button:has-text("Continuar")');

    // Step 2: What are you studying?
    await expect(
      page.getByText("¿Qué estás estudiando actualmente?")
    ).toBeVisible();
    await page.fill("input#subjectName", "Farmacología Clínica");
    await page.click('button:has-text("Agregar")');
    await expect(page.getByText("Farmacología Clínica")).toBeVisible();

    await page.click('button:has-text("Continuar al Paso 3")');

    // Step 3: Skip Exam
    await expect(page.getByText("¿Tienes un examen próximo?")).toBeVisible();
    await page.click('button:has-text("Omitir y Finalizar")');

    // Lands on /app
    await expect(page).toHaveURL(/\/app/, { timeout: 15000 });
    await expect(page.locator("h1")).toContainText(`Bienvenido, ${name}`);
    await expect(page.locator("body")).toContainText("Farmacología Clínica");
    await expect(page.locator("body")).toContainText(
      "Sin exámenes próximos programados"
    );

    // Completed user visiting /onboarding must redirect to /app
    await page.goto("/onboarding");
    await expect(page).toHaveURL(/\/app/, { timeout: 10000 });
  });

  test("Scenario 2: Onboarding with subject and exam target displays countdown on dashboard", async ({
    page,
  }) => {
    const email = `onboarding.exam.${timestamp}@test.medstudy.local`;
    const password = "Password123!";
    const name = "Dra. Elena Ramos";

    // 1. Signup
    await page.goto("/auth/signup");
    await page.fill('input[name="fullName"]', name);
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', password);
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/onboarding/, { timeout: 15000 });

    // Step 1: Skip
    await page.click('button:has-text("Omitir")');

    // Step 2: Add Subject
    await expect(
      page.getByText("¿Qué estás estudiando actualmente?")
    ).toBeVisible();
    await page.fill("input#subjectName", "Pediatría Integral");
    await page.click('button:has-text("Agregar")');
    await expect(page.getByText("Pediatría Integral")).toBeVisible();

    await page.click('button:has-text("Continuar al Paso 3")');

    // Step 3: Add Exam Target
    await expect(page.getByText("¿Tienes un examen próximo?")).toBeVisible();
    await page.fill("input#examTitle", "Examen Final de Pediatría");
    await page.fill("input#examDate", "2027-06-25");
    await page.selectOption("select#examSubject", {
      label: "Pediatría Integral",
    });

    await page.click('button:has-text("Guardar examen y finalizar")');

    // Lands on /app
    await expect(page).toHaveURL(/\/app/, { timeout: 15000 });
    await expect(page.locator("h1")).toContainText(`Bienvenido, ${name}`);
    await expect(page.locator("body")).toContainText("Pediatría Integral");
    await expect(page.locator("body")).toContainText(
      "Examen Final de Pediatría"
    );
    await expect(page.locator("body")).toContainText("25 de junio de 2027");

    // Capture Dashboard Screenshot with subjects and exam target
    await page.screenshot({
      path: path.join(screenshotsDir, "dashboard.png"),
      fullPage: true,
      caret: "initial",
    });
  });

  test("Scenario 3: Resumability preserves state on page reload", async ({
    page,
  }) => {
    const email = `onboarding.resume.${timestamp}@test.medstudy.local`;
    const password = "Password123!";
    const name = "Dr. Javier Quispe";

    await page.goto("/auth/signup");
    await page.fill('input[name="fullName"]', name);
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', password);
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/onboarding/, { timeout: 15000 });

    // Save Step 1
    await page.fill(
      "input#medicalSchool",
      "Universidad Privada Antenor Orrego"
    );
    await page.selectOption("select#yearOfStudy", "3");
    await page.click('button:has-text("Continuar")');

    // In Step 2, add a subject
    await expect(
      page.getByText("¿Qué estás estudiando actualmente?")
    ).toBeVisible();
    await page.fill("input#subjectName", "Bioquímica Médica");
    await page.click('button:has-text("Agregar")');
    await expect(page.getByText("Bioquímica Médica")).toBeVisible();

    // Now reload page midway through onboarding
    await page.reload();

    // Because user already has a subject in DB, it safely resumes at Step 3 (or shows subjects)
    await expect(page.locator("h1")).toContainText(
      "Bienvenido a MedStudy Atlas"
    );
    // The subject already created is preserved
    await page.click('button:has-text("Omitir y Finalizar")');

    await expect(page).toHaveURL(/\/app/, { timeout: 15000 });
    await expect(page.locator("body")).toContainText("Bioquímica Médica");
  });

  test("Scenario 4: Partial exam input is not silently discarded and requires both fields", async ({
    page,
  }) => {
    const email = `onboarding.partial.${Date.now()}@test.medstudy.local`;
    const password = "Password123!";
    const name = "Dra. Sofía Castro";

    await page.goto("/auth/signup");
    await page.fill('input[name="fullName"]', name);
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', password);
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/onboarding/, { timeout: 15000 });

    // Step 1: Skip
    await page.click('button:has-text("Omitir")');

    // Step 2: Add subject
    await expect(
      page.getByText("¿Qué estás estudiando actualmente?")
    ).toBeVisible();
    await page.fill("input#subjectName", "Neurología");
    await page.click('button:has-text("Agregar")');
    await expect(page.getByText("Neurología")).toBeVisible();
    await page.click('button:has-text("Continuar al Paso 3")');

    // Step 3: Verify partial input handling
    await expect(page.getByText("¿Tienes un examen próximo?")).toBeVisible();
    const saveButton = page.getByRole("button", {
      name: "Guardar examen y finalizar",
    });

    // Case 1: Both empty -> Save button disabled
    await expect(saveButton).toBeDisabled();

    // Case 2: Only title filled -> Save button disabled
    await page.fill("input#examTitle", "Examen Parcial de Neurología");
    await expect(saveButton).toBeDisabled();

    // Case 3: Clear title, only date filled -> Save button disabled
    await page.fill("input#examTitle", "");
    await page.fill("input#examDate", "2027-10-15");
    await expect(saveButton).toBeDisabled();

    // Case 4: Both filled -> Save button enabled
    await page.fill("input#examTitle", "Examen Parcial de Neurología");
    await expect(saveButton).toBeEnabled();

    // Save exam and complete onboarding
    await saveButton.click();

    // Lands on /app with both subject and exam target preserved
    await expect(page).toHaveURL(/\/app/, { timeout: 15000 });
    await expect(page.locator("h1")).toContainText(`Bienvenido, ${name}`);
    await expect(page.locator("body")).toContainText("Neurología");
    await expect(page.locator("body")).toContainText(
      "Examen Parcial de Neurología"
    );
    await expect(page.locator("body")).toContainText("15 de octubre de 2027");
  });
});
