import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs";

test.describe("MedStudy Atlas Smoke & Browser Verification", () => {
  const screenshotsDir = path.resolve(process.cwd(), "docs/screenshots");

  test.beforeAll(() => {
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
  });

  test("homepage renders successfully on desktop (light and dark)", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    const response = await page.goto("/");
    expect(response?.status()).toBe(200);

    // Verify security headers
    const cspHeader = response?.headers()["content-security-policy"];
    expect(cspHeader).toBeDefined();
    expect(cspHeader).toContain("default-src 'self'");
    expect(response?.headers()["x-content-type-options"]).toBe("nosniff");
    expect(response?.headers()["x-frame-options"]).toBe("DENY");

    // Verify main heading
    const heading = page.getByRole("heading", {
      name: "MedStudy Atlas",
      level: 1,
    });
    await expect(heading).toBeVisible();

    // Verify tagline
    await expect(
      page.getByText("Adaptive medical learning workspace")
    ).toBeVisible();

    // Verify Phase 0C badge (exact match)
    await expect(page.getByText("Phase 0C", { exact: true })).toBeVisible();

    // Verify engineering baseline operational text
    await expect(
      page.getByText("Engineering baseline operational — Phase 0C")
    ).toBeVisible();

    // Desktop screenshot - Light mode
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.screenshot({
      path: path.join(screenshotsDir, "desktop-light.png"),
      fullPage: true,
    });

    // Find and assert theme toggle button is visible
    const themeButton = page.getByRole("button", {
      name: /switch to (dark|light) mode/i,
    });
    await expect(themeButton).toBeVisible();

    // Verify bidirectional theme toggling
    const isInitiallyDark = await page.evaluate(() =>
      document.documentElement.classList.contains("dark")
    );

    if (!isInitiallyDark) {
      await themeButton.click();
      await page.waitForFunction(() =>
        document.documentElement.classList.contains("dark")
      );
      await page.screenshot({
        path: path.join(screenshotsDir, "desktop-dark.png"),
        fullPage: true,
      });

      // Toggle back to light
      await themeButton.click();
      await page.waitForFunction(
        () => !document.documentElement.classList.contains("dark")
      );
    } else {
      await page.screenshot({
        path: path.join(screenshotsDir, "desktop-dark.png"),
        fullPage: true,
      });

      // Toggle to light
      await themeButton.click();
      await page.waitForFunction(
        () => !document.documentElement.classList.contains("dark")
      );
    }

    // Assert zero console errors
    expect(consoleErrors).toEqual([]);
  });

  test("mobile viewport renders cleanly without horizontal overflow", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");

    const heading = page.getByRole("heading", {
      name: "MedStudy Atlas",
      level: 1,
    });
    await expect(heading).toBeVisible();

    // Verify no horizontal overflow
    const scrollWidth = await page.evaluate(
      () => document.documentElement.scrollWidth
    );
    const clientWidth = await page.evaluate(
      () => document.documentElement.clientWidth
    );
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

    // Mobile screenshot - Light mode
    await page.screenshot({
      path: path.join(screenshotsDir, "mobile-light.png"),
      fullPage: true,
    });
  });

  test("not-found (404) route renders gracefully", async ({ page }) => {
    const response = await page.goto("/non-existent-route-for-testing");
    expect(response?.status()).toBe(404);

    await expect(
      page.getByRole("heading", { name: "Page Not Found" })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Return to workspace" })
    ).toBeVisible();

    await page.screenshot({
      path: path.join(screenshotsDir, "not-found.png"),
    });
  });

  test("health check endpoint returns status ok", async ({ request }) => {
    const health = await request.get("/api/health");
    expect(health.status()).toBe(200);
    const body = await health.json();
    expect(body).toEqual({ status: "ok" });
  });
});
