import { test, expect } from "@playwright/test";
import path from "path";

test.describe("Phase 1A & 1B: Identity, Auth & Two-User Isolation", () => {
  const screenshotsDir = path.resolve(process.cwd(), "docs/screenshots");
  const timestamp = Date.now();
  const user1Email = `ana.vega.${timestamp}@test.medstudy.local`;
  const user1Password = "MedicalPass123!";
  const user1Name = "Dra. Ana Vega";
  const user1School = "UNMSM";
  const user1Year = "5";

  const user2Email = `carlos.mendoza.${timestamp}@test.medstudy.local`;
  const user2Password = "ClinicalPass456!";
  const user2Name = "Dr. Carlos Mendoza";
  const user2School = "UPCH";
  const user2Year = "3";

  test("unauthenticated user is redirected from /app to /auth/login with redirect query", async ({
    page,
  }) => {
    await page.goto("/app");
    await expect(page).toHaveURL(/\/auth\/login\?redirect=%2Fapp/);
    await expect(
      page.locator("h2, .text-2xl").filter({ hasText: "Iniciar Sesión" })
    ).toBeVisible();
  });

  test("open-redirect protection: malicious redirect query is sanitized to /app", async ({
    page,
  }) => {
    const redirectUserEmail = `redirect.test.${Date.now()}@test.medstudy.local`;
    const redirectUserPassword = "RedirectPass123!";

    // Signup and complete onboarding
    await page.goto("/auth/signup");
    await page.fill('input[name="fullName"]', "Dra. Redirect Test");
    await page.fill('input[name="email"]', redirectUserEmail);
    await page.fill('input[name="password"]', redirectUserPassword);
    await page.fill('input[name="medicalSchool"]', "UNMSM");
    await page.fill('input[name="yearOfStudy"]', "4");
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/onboarding/, { timeout: 15000 });
    const step1Btn = page.getByRole("button", {
      name: "Continuar",
      exact: true,
    });
    if (await step1Btn.isVisible()) {
      await step1Btn.click();
    }
    await page.fill("input#subjectName", "Cirugía");
    await page.click('button:has-text("Agregar")');
    await page.click('button:has-text("Continuar al Paso 3")');
    await page.click('button:has-text("Omitir y Finalizar")');
    await expect(page).toHaveURL(/\/app/, { timeout: 15000 });

    // Logout
    await page.click("button:has-text('Cerrar Sesión')");
    await expect(page).toHaveURL(/\/auth\/login/, { timeout: 10000 });

    // Attempt to login with protocol-relative open redirect: //attacker.com
    await page.goto("/auth/login?redirect=%2F%2Fattacker.com");
    await page.fill('input[name="email"]', redirectUserEmail);
    await page.fill('input[name="password"]', redirectUserPassword);
    await page.click('button[type="submit"]');

    // Must be sanitized and redirected to /app, NOT //attacker.com
    await expect(page).toHaveURL(/\/app/, { timeout: 15000 });
    await expect(page).not.toHaveURL(/attacker\.com/);
  });

  test("complete auth lifecycle: signup -> onboarding -> /app -> edit profile -> logout -> login", async ({
    page,
  }) => {
    // 1. Signup Flow
    await page.goto("/auth/signup");
    await expect(
      page.locator("h2, .text-2xl").filter({ hasText: "Crear Cuenta" })
    ).toBeVisible();

    await page.fill('input[name="fullName"]', user1Name);
    await page.fill('input[name="email"]', user1Email);
    await page.fill('input[name="password"]', user1Password);
    await page.fill('input[name="medicalSchool"]', user1School);
    await page.fill('input[name="yearOfStudy"]', user1Year);

    await page.click('button[type="submit"]');

    // Should land on /onboarding
    await expect(page).toHaveURL(/\/onboarding/, { timeout: 15000 });

    // Step 1 or 2: If medicalSchool/yearOfStudy are already set, it advances to Step 2
    // If on Step 1, click Continuar
    const step1Btn = page.getByRole("button", {
      name: "Continuar",
      exact: true,
    });
    if (await step1Btn.isVisible()) {
      await step1Btn.click();
    }

    // Step 2: Add Subject
    await expect(
      page.getByText("¿Qué estás estudiando actualmente?")
    ).toBeVisible({
      timeout: 10000,
    });
    await page.fill("input#subjectName", "Anatomía");
    await page.click('button:has-text("Agregar")');
    await expect(page.getByText("Anatomía")).toBeVisible();

    // Proceed to Step 3
    await page.click('button:has-text("Continuar al Paso 3")');

    // Step 3: Skip Exam and Finish
    await expect(page.getByText("¿Tienes un examen próximo?")).toBeVisible({
      timeout: 10000,
    });
    await page.click('button:has-text("Omitir y Finalizar")');

    // Should land on /app
    await expect(page).toHaveURL(/\/app/, { timeout: 15000 });
    await expect(page.locator("h1")).toContainText(`Bienvenido, ${user1Name}`);
    await expect(page.locator("body")).toContainText(user1School);
    await expect(page.locator("body")).toContainText("Anatomía");

    // Capture authenticated app screenshot
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.screenshot({
      path: path.join(screenshotsDir, "authenticated-app.png"),
      fullPage: true,
      caret: "initial",
    });

    // 2. Profile Editing Flow
    await page.click('a[href="/app/profile"]');
    await expect(page).toHaveURL(/\/app\/profile/);
    await expect(page.locator("input#fullName")).toHaveValue(user1Name);

    // Capture profile screenshot
    await page.screenshot({
      path: path.join(screenshotsDir, "profile.png"),
      fullPage: true,
      caret: "initial",
    });

    // Update medical school
    await page.fill(
      "input#medicalSchool",
      "Universidad Peruana Cayetano Heredia"
    );
    await page.click('button[type="submit"]');

    // Expect success message
    await expect(page.locator('div[role="status"]')).toContainText(
      "¡Perfil actualizado con éxito!"
    );

    // Return to /app and verify updated data
    await page.click('a[href="/app"]');
    await expect(page).toHaveURL(/\/app/);
    await expect(page.locator("body")).toContainText(
      "Universidad Peruana Cayetano Heredia"
    );

    // Capture mobile authenticated view screenshot
    await page.setViewportSize({ width: 375, height: 667 });
    await page.screenshot({
      path: path.join(screenshotsDir, "mobile-authenticated.png"),
      fullPage: true,
      caret: "initial",
    });
    await page.setViewportSize({ width: 1280, height: 800 });

    // 3. Logout Flow
    await page.click("button:has-text('Cerrar Sesión')");
    await expect(page).toHaveURL(/\/auth\/login/, { timeout: 10000 });

    // Attempting to visit /app now must redirect back to login
    await page.goto("/app");
    await expect(page).toHaveURL(/\/auth\/login\?redirect=%2Fapp/);

    // 4. Login Flow
    await page.fill('input[name="email"]', user1Email);
    await page.fill('input[name="password"]', user1Password);
    await page.click('button[type="submit"]');

    // User has completed onboarding, so lands directly on /app
    await expect(page).toHaveURL(/\/app/, { timeout: 15000 });
    await expect(page.locator("h1")).toContainText(`Bienvenido, ${user1Name}`);
  });

  test("two-user isolation: User A and User B operate independently", async ({
    browser,
  }) => {
    // Context A: User 1
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();

    // Signup User 1
    await pageA.goto("/auth/signup");
    await pageA.fill('input[name="fullName"]', user1Name);
    await pageA.fill('input[name="email"]', user1Email + ".iso");
    await pageA.fill('input[name="password"]', user1Password);
    await pageA.fill('input[name="medicalSchool"]', user1School);
    await pageA.fill('input[name="yearOfStudy"]', user1Year);
    await pageA.click('button[type="submit"]');

    await expect(pageA).toHaveURL(/\/onboarding/, { timeout: 15000 });
    const step1BtnA = pageA.getByRole("button", {
      name: "Continuar",
      exact: true,
    });
    if (await step1BtnA.isVisible()) {
      await step1BtnA.click();
    }
    await pageA.fill("input#subjectName", "Cardiología UserA");
    await pageA.click('button:has-text("Agregar")');
    await pageA.click('button:has-text("Continuar al Paso 3")');
    await pageA.click('button:has-text("Omitir y Finalizar")');
    await expect(pageA).toHaveURL(/\/app/, { timeout: 15000 });
    await expect(pageA.locator("h1")).toContainText(user1Name);

    // Context B: User 2 (completely separate browser session)
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();

    // Signup User 2
    await pageB.goto("/auth/signup");
    await pageB.fill('input[name="fullName"]', user2Name);
    await pageB.fill('input[name="email"]', user2Email);
    await pageB.fill('input[name="password"]', user2Password);
    await pageB.fill('input[name="medicalSchool"]', user2School);
    await pageB.fill('input[name="yearOfStudy"]', user2Year);
    await pageB.click('button[type="submit"]');

    await expect(pageB).toHaveURL(/\/onboarding/, { timeout: 15000 });
    const step1BtnB = pageB.getByRole("button", {
      name: "Continuar",
      exact: true,
    });
    if (await step1BtnB.isVisible()) {
      await step1BtnB.click();
    }
    await pageB.fill("input#subjectName", "Neumología UserB");
    await pageB.click('button:has-text("Agregar")');
    await pageB.click('button:has-text("Continuar al Paso 3")');
    await pageB.click('button:has-text("Omitir y Finalizar")');
    await expect(pageB).toHaveURL(/\/app/, { timeout: 15000 });
    await expect(pageB.locator("h1")).toContainText(user2Name);

    // Verify User 2 sees only their own data
    await expect(pageB.locator("body")).toContainText(user2School);
    await expect(pageB.locator("body")).toContainText("Neumología UserB");
    await expect(pageB.locator("body")).not.toContainText(user1Name);
    await expect(pageB.locator("body")).not.toContainText("Cardiología UserA");

    // Verify User 1 sees only their own data
    await expect(pageA.locator("body")).toContainText(user1Name);
    await expect(pageA.locator("body")).toContainText("Cardiología UserA");
    await expect(pageA.locator("body")).not.toContainText(user2Name);
    await expect(pageA.locator("body")).not.toContainText("Neumología UserB");

    await contextA.close();
    await contextB.close();
  });
});
