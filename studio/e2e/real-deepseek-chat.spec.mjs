import { expect, test } from "@playwright/test";

test("real DeepSeek Chat path sends through Backend and renders assistant response", async ({ page }) => {
  test.setTimeout(120000);
  const url = process.env.CONTEXTOS_STUDIO_REAL_CHAT_URL;
  test.skip(!url, "Set CONTEXTOS_STUDIO_REAL_CHAT_URL to run the real DeepSeek chat verification.");

  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto(url);
  await expect(page.getByTestId("runtime-mode")).toHaveText("Real Runtime");
  await expect(page.getByTestId("status-toast")).toContainText("Runtime projection ready");

  const prompt = `Analyze in five numbered points why AI Chat benefits from streaming for complex questions, then end with ContextOS Chat OK. Verification id: ${Date.now()}`;

  const postResponse = page.waitForResponse((response) => (
    response.request().method() === "POST"
    && response.url().includes("/api/sessions/demo-session/messages")
  ));
  const streamResponse = page.waitForResponse((response) => (
    response.url().includes("/sse/sessions/demo-session/chat")
  ));

  await page.getByTestId("composer-input").fill(prompt);
  await page.getByTestId("send-message").click();

  expect((await postResponse).status()).toBe(201);
  expect((await streamResponse).status()).toBe(200);
  await expect(page.getByText(prompt)).toBeVisible();
  await expect(page.locator(".message-card.assistant", { hasText: "ContextOS Chat OK" }).last()).toBeVisible({ timeout: 90000 });
  await expect(page.getByTestId("status-toast")).not.toContainText("Send failed");
  expect(consoleErrors).toEqual([]);
});
