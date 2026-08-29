import { expect, test } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\e2e$/, "");
const repoRoot = dirname(studioRoot);
const executablePath = systemChromiumPath();

if (executablePath) {
  test.use({ launchOptions: { executablePath }, video: "off" });
} else {
  test.use({ video: "off" });
}

test("Studio app has working navigation chat send selection and disabled action feedback", async ({ page }) => {
  const backendPort = await freePort();
  const studioPort = await freePort();
  const backend = await startBackend(backendPort);
  const studio = await startStudio(studioPort, backendPort);

  try {
    await page.goto(`${studio.url}/chat?sessionId=demo-session&timelineId=demo-timeline`);
    await expect(page.getByTestId("main-title")).toHaveText("Chat Workbench");
    await expect(page.getByTestId("session-demo-session")).toHaveAttribute("aria-pressed", "true");

    const postRequest = page.waitForRequest((request) => {
      return request.method() === "POST" && request.url().includes("/api/sessions/demo-session/messages");
    });
    const streamResponse = page.waitForResponse((response) => {
      return response.url().includes("/sse/sessions/demo-session/chat") && response.status() === 200;
    });

    await page.getByTestId("composer-input").fill("Hello, please reply with OK");
    const contextRefresh = page.waitForResponse((response) => {
      return response.url().includes("/api/sessions/demo-session/context?timelineId=demo-timeline") && response.status() === 200;
    });
    await page.getByTestId("send-message").click();

    const request = await postRequest;
    expect(request.postDataJSON()).toMatchObject({ role: "user", content: "Hello, please reply with OK" });
    await streamResponse;
    const contextResponse = await contextRefresh;
    const context = await contextResponse.json();
    expect(context.items.some((item) => item.effective_content.includes("Hello, please reply with OK"))).toBe(true);
    await expect(page.locator(".message-card.user").getByText("Hello, please reply with OK", { exact: true })).toBeVisible();
    await expect(page.locator(".message-card.assistant").getByText("OK", { exact: true })).toBeVisible();
    await expect(page.getByTestId("status-toast")).toContainText("Sent");

    await page.reload();
    await expect(page.locator(".message-card.assistant").getByText("OK", { exact: true })).toBeVisible();

    await page.locator(".message-card.assistant", { hasText: "OK" }).click();
    await expect(page.getByTestId("right-panel-title")).toHaveText("Impact");
    await expect(page.getByTestId("impact-anchor")).toContainText("message_");
    await page.getByRole("tab", { name: "Context" }).click();
    await expect(page.locator(".context-item", { hasText: "Hello, please reply with OK" })).toBeVisible();

    await page.getByTestId("nav-workflow").click();
    await expect(page.getByTestId("main-title")).toHaveText("Workflow Builder");
    await page.getByTestId("workflow-save").click();
    await expect(page.getByTestId("status-toast")).toContainText("Workflow saved");

    await page.getByTestId("nav-debug").click();
    await expect(page.getByTestId("main-title")).toHaveText("Debug Inspector");
    await page.getByTestId("toggle-right-panel").click();
    await expect(page.getByTestId("right-panel")).toHaveAttribute("data-collapsed", "true");
  } finally {
    await studio.close();
    await backend.close();
  }
});

test("Workflow page lists saves reloads and preserves dragged node positions", async ({ page }) => {
  const backendPort = await freePort();
  const studioPort = await freePort();
  const backend = await startBackend(backendPort);
  const studio = await startStudio(studioPort, backendPort);

  try {
    await page.goto(`${studio.url}/workflow`);
    await expect(page.getByTestId("main-title")).toHaveText("Workflow Builder");
    await page.getByTestId("workflow-new").click();
    await page.getByTestId("workflow-name").fill("My Workflow A");
    await page.getByRole("button", { name: "agent", exact: true }).click();
    await page.getByRole("button", { name: "tool", exact: true }).click();

    const node = page.locator(".graph-node", { hasText: "agent" }).first();
    const otherNode = page.locator(".graph-node", { hasText: "tool" }).first();
    const before = await node.boundingBox();
    const otherBefore = await otherNode.boundingBox();
    await node.hover();
    await page.mouse.down();
    await page.mouse.move((before?.x ?? 0) + 180, (before?.y ?? 0) + 90, { steps: 8 });
    await page.mouse.up();
    const after = await node.boundingBox();
    const otherAfter = await otherNode.boundingBox();

    expect(after?.x).toBeGreaterThan((before?.x ?? 0) + 80);
    expect(after?.y).toBeGreaterThan((before?.y ?? 0) + 40);
    expect(otherAfter?.x).toBe(otherBefore?.x);
    expect(otherAfter?.y).toBe(otherBefore?.y);

    await page.getByTestId("workflow-save").click();
    await expect(page.getByTestId("status-toast")).toContainText("Workflow saved");
    await expect(page.getByTestId("workflow-list")).toContainText("My Workflow A");

    const templates = await (await page.request.get(`${studio.url}/api/templates`)).json();
    const saved = templates.templates.find((template) => template.name === "My Workflow A");
    expect(saved).toBeTruthy();
    const loaded = await (await page.request.get(`${studio.url}/api/templates/${saved.id}`)).json();
    expect(loaded.manifest.graph.nodes[0].position.x).toBeGreaterThan(120);
    expect(loaded.manifest.graph.nodes[0].position.y).toBeGreaterThan(80);

    await page.reload();
    await expect(page.getByTestId("workflow-list")).toContainText("My Workflow A");
    await page.getByRole("button", { name: /My Workflow A/ }).click();
    const reopened = page.locator(".graph-node", { hasText: "agent" });
    await expect(reopened).toBeVisible();
    const reopenedBox = await reopened.boundingBox();
    expect(reopenedBox?.x).toBeCloseTo(after?.x ?? 0, 1);
    expect(reopenedBox?.y).toBeCloseTo(after?.y ?? 0, 1);
  } finally {
    await studio.close();
    await backend.close();
  }
});

test("Message edit textarea accepts user assistant and Chinese drafts", async ({ page }) => {
  const backendPort = await freePort();
  const studioPort = await freePort();
  const backend = await startBackend(backendPort);
  const studio = await startStudio(studioPort, backendPort);

  try {
    await page.goto(`${studio.url}/chat?sessionId=demo-session&timelineId=demo-timeline`);

    const userCard = page.locator(".message-card.user").first();
    const originalUserText = (await userCard.locator("p").innerText()).trim();
    await startEditing(page, userCard);
    const userEditor = page.locator("[data-message-edit-input]").first();
    await userEditor.click();
    await expect(userEditor).toBeFocused();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.keyboard.type("User edit middle text", { delay: 5 });
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Backspace");
    await expect(userEditor).toHaveValue("User edit middle txt");
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(userCard.locator("p")).toHaveText(originalUserText);

    await startEditing(page, userCard);
    const chineseEditor = page.locator("[data-message-edit-input]").first();
    await chineseEditor.click();
    await expect(chineseEditor).toBeFocused();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await chineseEditor.dispatchEvent("compositionstart");
    await page.keyboard.type("这是一段测试文字", { delay: 5 });
    await chineseEditor.dispatchEvent("compositionend");
    await expect(chineseEditor).toHaveValue("这是一段测试文字");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(userCard.locator("p")).toHaveText("这是一段测试文字");

    const assistantCard = page.locator(".message-card.assistant").first();
    await startEditing(page, assistantCard);
    const assistantEditor = page.locator("[data-message-edit-input]").first();
    await assistantEditor.click();
    await expect(assistantEditor).toBeFocused();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.keyboard.type("Assistant edited response", { delay: 5 });
    await expect(assistantEditor).toHaveValue("Assistant edited response");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(assistantCard.locator("p")).toHaveText("Assistant edited response");
  } finally {
    await studio.close();
    await backend.close();
  }
});

async function startBackend(port) {
  const stateDir = await mkdtemp(join(tmpdir(), "contextos-studio-app-"));
  const storagePath = join(stateDir, "runtime-state.json");
  const child = spawn("python", ["-m", "contextos.api", "--host", "127.0.0.1", "--port", String(port)], {
    cwd: repoRoot,
    env: { ...process.env, PYTHONPATH: "backend/src", CONTEXTOS_DISABLE_LLM: "1", CONTEXTOS_RUNTIME_STATE_PATH: storagePath },
    stdio: "ignore",
  });
  const url = `http://127.0.0.1:${port}`;
  await waitForServer(`${url}/health`);
  return {
    url,
    async close() {
      child.kill();
      await once(child, "exit").catch(() => {});
      await rm(stateDir, { recursive: true, force: true });
    },
  };
}

async function startEditing(page, card) {
  await card.hover();
  await card.locator(".message-menu-trigger").click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  await expect(card.locator("[data-message-edit-input]")).toBeVisible();
}

async function startStudio(port, backendPort) {
  const child = spawn(process.execPath, ["scripts/dev-server.mjs", "--real"], {
    cwd: studioRoot,
    env: {
      ...process.env,
      CONTEXTOS_STUDIO_PORT: String(port),
      CONTEXTOS_STUDIO_API_BASE_URL: `http://127.0.0.1:${backendPort}`,
      CONTEXTOS_STUDIO_SSE_BASE_URL: `http://127.0.0.1:${backendPort}`,
    },
    stdio: "ignore",
  });
  const url = `http://127.0.0.1:${port}`;
  await waitForServer(`${url}/__contextos/config.json`);
  return {
    url,
    close() {
      child.kill();
      return once(child, "exit").catch(() => {});
    },
  };
}

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForServer(url) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`Server did not start at ${url}`);
}

function systemChromiumPath() {
  const candidates = [
    process.env.CONTEXTOS_PLAYWRIGHT_EXECUTABLE,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}
