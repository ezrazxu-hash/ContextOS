import { expect, test } from "@playwright/test";

const studioUrl = process.env.CONTEXTOS_STUDIO_TEST_URL ?? "http://127.0.0.1:5173";

for (const route of ["chat", "workflow", "template", "debug"]) {
  test(`${route} uses the compact light workbench without horizontal overflow`, async ({ page }) => {
    await page.goto(`${studioUrl}/${route}`);
    await expect(page.getByTestId("main-title")).toBeVisible();

    const result = await page.evaluate(() => {
      const topbar = document.querySelector(".topbar");
      const primaryButton = document.querySelector("button");
      const mainPane = document.querySelector(".main-pane");
      const topbarStyle = getComputedStyle(topbar);
      const buttonStyle = getComputedStyle(primaryButton);
      return {
        topbarBackground: topbarStyle.backgroundColor,
        topbarHeight: topbar.getBoundingClientRect().height,
        buttonHeight: primaryButton.getBoundingClientRect().height,
        bodyOverflows: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        mainOverflows: mainPane.scrollWidth > mainPane.clientWidth + 1,
      };
    });

    expect(result.topbarBackground).toBe("rgb(255, 255, 255)");
    expect(result.topbarHeight).toBeLessThanOrEqual(52);
    expect(result.buttonHeight).toBeLessThanOrEqual(34);
    expect(result.bodyOverflows).toBe(false);
    expect(result.mainOverflows).toBe(false);
  });
}

test("Debug exposes compact searchable sections with source counts", async ({ page }) => {
  await page.goto(`${studioUrl}/debug`);
  await expect(page.getByRole("searchbox", { name: "Search debug data" })).toBeVisible();
  await expect(page.getByTestId("debug-trace-count")).toHaveText(/^\d+$/);
  await expect(page.getByTestId("debug-message-count")).toHaveText(/^\d+$/);
});

test("The workbench stays within a common 1024px desktop viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto(`${studioUrl}/chat`);

  const overflow = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    main: document.querySelector(".main-pane").scrollWidth > document.querySelector(".main-pane").clientWidth + 1,
  }));

  expect(overflow).toEqual({ page: false, main: false });
});

test("Core Chat Workflow Template and Debug interactions remain usable", async ({ page }) => {
  await page.goto(`${studioUrl}/chat`);
  await expect(page.getByTestId("session-demo-session")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("composer-input").fill("UI verification draft");
  await expect(page.getByTestId("composer-input")).toHaveValue("UI verification draft");
  await page.getByTestId("toggle-right-panel").click();
  await expect(page.getByTestId("right-panel")).toHaveAttribute("data-collapsed", "true");

  await page.goto(`${studioUrl}/workflow`);
  await page.locator("[data-node-id='analyze-request']").click();
  await expect(page.getByTestId("workflow-v2-agent-instruction")).toBeVisible();
  await page.getByTestId("workflow-v2-bottom-tab-execution-trace").click();
  await expect(page.getByTestId("workflow-v2-execution-trace")).toBeVisible();
  await page.getByTestId("workflow-v2-bottom-tab-edge-relations").click();
  await expect(page.getByTestId("workflow-v2-edge-panel")).toBeVisible();

  await page.goto(`${studioUrl}/template`);
  await page.getByRole("button", { name: "Model", exact: true }).click();
  await expect(page.getByRole("button", { name: "Model", exact: true })).toHaveClass(/active/);

  await page.goto(`${studioUrl}/debug`);
  await page.getByRole("searchbox", { name: "Search debug data" }).fill("assistant");
  await expect(page.locator(".debug-message")).toHaveCount(1);
  await page.getByRole("searchbox", { name: "Search debug data" }).fill("");
  await expect(page.locator(".debug-message")).toHaveCount(2);
});
