import { expect, test } from "@playwright/test";

test("real DeepSeek Chat persists Session Timeline Groups across reload", async ({ page }) => {
  test.setTimeout(180000);
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

  await Promise.all([
    page.waitForURL(/sessionId=.*timelineId=.*/),
    page.getByText("New Session").click(),
  ]);

  const selection = new URL(page.url());
  const sessionId = selection.searchParams.get("sessionId");
  const timelineId = selection.searchParams.get("timelineId");
  expect(sessionId).toBeTruthy();
  expect(timelineId).toBeTruthy();

  await sendAndWait(page, "My name is Tom. Reply in one short sentence.");
  await expect(page.locator(".message-card.assistant", { hasText: "Tom" }).last()).toBeVisible({ timeout: 90000 });

  await sendAndWait(page, "What is my name? End with ContextOS Chat OK.");
  await expect(page.locator(".message-card.assistant", { hasText: "ContextOS Chat OK" }).last()).toBeVisible({ timeout: 90000 });
  await expect(page.locator(".message-card.assistant", { hasText: "Tom" }).last()).toBeVisible();

  await page.reload();
  await expect(page.getByText("My name is Tom. Reply in one short sentence.")).toBeVisible();
  await expect(page.getByText("What is my name? End with ContextOS Chat OK.")).toBeVisible();
  await expect(page.locator(".message-card.assistant", { hasText: "ContextOS Chat OK" }).last()).toBeVisible();

  await sendAndWait(page, "Summarize what we discussed in one sentence.");
  await expect(page.locator(".message-card.assistant", { hasText: "Tom" }).last()).toBeVisible({ timeout: 90000 });

  expect(new URL(page.url()).searchParams.get("sessionId")).toBe(sessionId);
  expect(new URL(page.url()).searchParams.get("timelineId")).toBe(timelineId);
  await expect(page.getByTestId("status-toast")).not.toContainText("Send failed");
  expect(consoleErrors).toEqual([]);
});

async function sendAndWait(page, prompt) {
  const postResponse = page.waitForResponse((response) => (
    response.request().method() === "POST"
    && response.url().includes("/api/sessions/")
    && response.url().includes("/messages")
  ));
  const streamResponse = page.waitForResponse((response) => (
    response.url().includes("/sse/sessions/")
    && response.url().includes("/chat")
  ));

  await page.getByTestId("composer-input").fill(prompt);
  await page.getByTestId("send-message").click();

  expect((await postResponse).status()).toBe(201);
  expect((await streamResponse).status()).toBe(200);
  await expect(page.getByText(prompt)).toBeVisible();
}
