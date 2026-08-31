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

test("Composer refocuses after assistant reply finishes without stealing focus during streaming", async ({ page }) => {
  const backendPort = await freePort();
  const studioPort = await freePort();
  const backend = await startBackend(backendPort);
  const studio = await startStudio(studioPort, backendPort);

  try {
    await page.goto(`${studio.url}/chat?sessionId=demo-session&timelineId=demo-timeline`);
    let releaseStream;
    const streamHeld = new Promise((resolve) => {
      releaseStream = resolve;
    });
    await page.route("**/sse/sessions/demo-session/chat**", async (route) => {
      await streamHeld;
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: [
          'event: token\ndata: {"message_id":"focus-stream","role":"assistant","content":"OK"}',
          'event: done\ndata: {"message_id":"focus-stream","checkpoint_id":"focus-checkpoint"}',
          "",
        ].join("\n\n"),
      });
    });

    const composer = page.getByTestId("composer-input");
    await composer.fill("Hello, please reply with OK");

    const streamResponse = page.waitForResponse((response) => {
      return response.url().includes("/sse/sessions/demo-session/chat") && response.status() === 200;
    });
    await page.getByTestId("send-message").click();
    await expect(composer).toBeDisabled();

    await page.waitForTimeout(150);
    await expect(composer).toBeDisabled();
    releaseStream();
    await streamResponse;
    await expect(page.locator(".message-card.assistant").getByText("OK", { exact: true })).toBeVisible();
    await expect(composer).toBeEnabled();
    await expect(composer).toBeFocused();
    await page.keyboard.type("Second turn");
    await expect(composer).toHaveValue("Second turn");

    const secondStream = page.waitForResponse((response) => {
      return response.url().includes("/sse/sessions/demo-session/chat") && response.status() === 200;
    });
    await page.getByTestId("send-message").click();
    await secondStream;
    await expect(composer).toBeEnabled();
    await expect(composer).toBeFocused();
  } finally {
    await studio.close();
    await backend.close();
  }
});

test("Composer refocus is suppressed when the user edits during assistant reply", async ({ page }) => {
  const backendPort = await freePort();
  const studioPort = await freePort();
  const backend = await startBackend(backendPort);
  const studio = await startStudio(studioPort, backendPort);

  try {
    await page.goto(`${studio.url}/chat?sessionId=demo-session&timelineId=demo-timeline`);
    let releaseStream;
    const streamHeld = new Promise((resolve) => {
      releaseStream = resolve;
    });
    await page.route("**/sse/sessions/demo-session/chat**", async (route) => {
      await streamHeld;
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: [
          'event: token\ndata: {"message_id":"focus-stream","role":"assistant","content":"OK"}',
          'event: done\ndata: {"message_id":"focus-stream","checkpoint_id":"focus-checkpoint"}',
          "",
        ].join("\n\n"),
      });
    });

    const composer = page.getByTestId("composer-input");
    await composer.fill("Hello, please reply with OK");
    const streamResponse = page.waitForResponse((response) => {
      return response.url().includes("/sse/sessions/demo-session/chat") && response.status() === 200;
    });
    await page.getByTestId("send-message").click();
    await expect(composer).toBeDisabled();

    const userCard = page.locator(".message-card.user").first();
    await startEditing(page, userCard);
    const editor = page.locator("[data-message-edit-input]").first();
    await editor.fill("Draft during stream");

    releaseStream();
    await streamResponse;
    await expect(composer).toBeEnabled();
    await expect(composer).not.toBeFocused();
    await expect(editor).toHaveValue("Draft during stream");
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
    await page.locator("[data-node-type='prompt']").click();
    await page.locator("[data-node-type='tool']").click();
    await page.locator(".workflow-edge", { hasText: "prompt-1 -> END" }).getByRole("button", { name: /Delete edge/ }).click();
    await page.locator("#workflow-edge-source").selectOption("prompt-1");
    await page.locator("#workflow-edge-target").selectOption("tool-2");
    await page.getByTestId("workflow-connect-edge").click();
    await page.locator("#workflow-edge-source").selectOption("tool-2");
    await page.locator("#workflow-edge-target").selectOption("END");
    await page.getByTestId("workflow-connect-edge").click();
    await expect(page.getByTestId("workflow-edge-list")).toContainText("prompt-1 -> tool-2");
    await expect(page.locator(".workflow-edge")).toHaveCount(3);

    const node = page.locator(".graph-node", { hasText: "prompt" }).first();
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
    const loadedNodes = loaded.manifest.graph?.nodes ?? loaded.manifest.runtime.nodes.map((node) => ({
      ...node,
      position: loaded.manifest.ui?.nodes?.[node.id]?.position,
    }));
    expect(loadedNodes[0].position.x).toBeGreaterThan(120);
    expect(loadedNodes[0].position.y).toBeGreaterThan(80);
    const loadedEdges = (loaded.manifest.graph?.edges ?? loaded.manifest.runtime?.edges).map((edge) => ({
      source: edge.source ?? edge.from,
      target: edge.target ?? edge.to,
    }));
    expect(loadedEdges).toContainEqual({ source: "START", target: "prompt-1" });
    expect(loadedEdges).toContainEqual({ source: "prompt-1", target: "tool-2" });
    expect(loadedEdges).toContainEqual({ source: "tool-2", target: "END" });

    await page.reload();
    await expect(page.getByTestId("workflow-list")).toContainText("My Workflow A");
    await page.getByTestId("workflow-list").getByRole("button", { name: /My Workflow A/ }).click();
    const reopened = page.locator(".graph-node", { hasText: "prompt" });
    await expect(reopened).toBeVisible();
    await expect(page.getByTestId("workflow-edge-list")).toContainText("prompt-1 -> tool-2");
    const reopenedBox = await reopened.boundingBox();
    expect(reopenedBox?.x).toBeCloseTo(after?.x ?? 0, 1);
    expect(reopenedBox?.y).toBeCloseTo(after?.y ?? 0, 1);
  } finally {
    await studio.close();
    await backend.close();
  }
});

test("Workflow canvas zooms only with Ctrl wheel and keeps dragged positions stable", async ({ page }) => {
  const backendPort = await freePort();
  const studioPort = await freePort();
  const backend = await startBackend(backendPort);
  const studio = await startStudio(studioPort, backendPort);

  try {
    await page.goto(`${studio.url}/workflow`);
    await page.getByTestId("workflow-new").click();
    await page.locator("[data-node-type='prompt']").click();

    const canvas = page.getByTestId("workflow-canvas");
    await expect(canvas).toHaveAttribute("data-zoom", "1");
    const startScroll = await canvas.evaluate((element) => {
      element.scrollLeft = 80;
      element.scrollTop = 70;
      return { left: element.scrollLeft, top: element.scrollTop };
    });
    await canvas.evaluate((element) => {
      window.__workflowContextMenusAllowed = 0;
      element.addEventListener("contextmenu", (event) => {
        if (!event.defaultPrevented) {
          window.__workflowContextMenusAllowed += 1;
        }
      });
    });
    const canvasBox = await canvas.boundingBox();
    await page.mouse.move((canvasBox?.x ?? 0) + 140, (canvasBox?.y ?? 0) + 140);
    await page.mouse.down({ button: "right" });
    await page.mouse.move((canvasBox?.x ?? 0) + 80, (canvasBox?.y ?? 0) + 95, { steps: 6 });
    await page.mouse.up({ button: "right" });
    const pannedScroll = await canvas.evaluate((element) => ({
      left: element.scrollLeft,
      top: element.scrollTop,
      contextMenusAllowed: window.__workflowContextMenusAllowed,
    }));
    expect(pannedScroll.left).toBeGreaterThan(startScroll.left);
    expect(pannedScroll.top).toBeGreaterThanOrEqual(startScroll.top);
    expect(pannedScroll.contextMenusAllowed).toBe(0);

    await page.mouse.move((canvasBox?.x ?? 0) + 120, (canvasBox?.y ?? 0) + 120);
    await page.mouse.down({ button: "right" });
    await page.mouse.up({ button: "right" });

    await canvas.dispatchEvent("wheel", { deltaY: -120, ctrlKey: false, bubbles: true, cancelable: true });
    await expect(canvas).toHaveAttribute("data-zoom", "1");

    await canvas.dispatchEvent("wheel", { deltaY: -240, ctrlKey: true, bubbles: true, cancelable: true });
    const zoomed = Number(await canvas.getAttribute("data-zoom"));
    expect(zoomed).toBeGreaterThan(1);

    const node = page.locator(".graph-node", { hasText: "prompt" }).first();
    const before = await node.boundingBox();
    await node.hover();
    await page.mouse.down();
    await page.mouse.move((before?.x ?? 0) + 110, (before?.y ?? 0) + 70, { steps: 8 });
    await page.mouse.up();

    await page.getByTestId("workflow-name").fill("Zoom Drag Workflow");
    await page.getByTestId("workflow-save").click();
    await expect(page.getByTestId("status-toast")).toContainText("Workflow saved");

    const templates = await (await page.request.get(`${studio.url}/api/templates`)).json();
    const saved = templates.templates.find((template) => template.name === "Zoom Drag Workflow");
    const loaded = await (await page.request.get(`${studio.url}/api/templates/${saved.id}`)).json();
    const savedPosition = loaded.manifest.ui.nodes["prompt-1"].position;
    expect(savedPosition.x).toBeGreaterThan(120);
    expect(savedPosition.y).toBeGreaterThan(110);
    expect(savedPosition.x).toBeLessThan(220);
    expect(savedPosition.y).toBeLessThan(190);
  } finally {
    await studio.close();
    await backend.close();
  }
});

test("Workflow canvas edge selection deletes only the selected edge and persists after reload", async ({ page }) => {
  const backendPort = await freePort();
  const studioPort = await freePort();
  const backend = await startBackend(backendPort);
  const studio = await startStudio(studioPort, backendPort);

  try {
    await page.goto(`${studio.url}/workflow`);
    await page.getByTestId("workflow-new").click();
    await page.getByTestId("workflow-name").fill("Edge Delete Workflow");
    await page.locator("[data-node-type='prompt']").click();
    await page.locator("[data-node-type='tool']").click();
    await page.locator("[data-node-type='output']").click();
    await page.locator("#workflow-edge-source").selectOption("prompt-1");
    await page.locator("#workflow-edge-target").selectOption("tool-2");
    await page.getByTestId("workflow-connect-edge").click();
    await page.locator("#workflow-edge-source").selectOption("tool-2");
    await page.locator("#workflow-edge-target").selectOption("output-3");
    await page.getByTestId("workflow-connect-edge").click();
    await expect(page.getByTestId("workflow-edge-list")).toContainText("prompt-1 -> tool-2");
    await expect(page.getByTestId("workflow-edge-list")).toContainText("tool-2 -> output-3");

    await clickWorkflowEdge(page, "prompt-1", "tool-2");
    await expect(page.locator("[data-testid='workflow-edge-hit'][data-edge-source='prompt-1'][data-edge-target='tool-2']")).toHaveClass(/selected/);
    await page.keyboard.press("Delete");

    await expect(page.getByTestId("workflow-edge-list")).not.toContainText("prompt-1 -> tool-2");
    await expect(page.getByTestId("workflow-edge-list")).toContainText("tool-2 -> output-3");
    await expect(page.locator(".graph-node", { hasText: "prompt" })).toBeVisible();
    await expect(page.locator(".graph-node", { hasText: "tool" })).toBeVisible();
    await expect(page.locator(".graph-node", { hasText: "output" })).toBeVisible();

    await clickWorkflowEdge(page, "tool-2", "output-3");
    await expect(page.locator("[data-testid='workflow-edge-hit'][data-edge-source='tool-2'][data-edge-target='output-3']")).toHaveClass(/selected/);
    await page.keyboard.press("Backspace");
    await expect(page.getByTestId("workflow-edge-list")).not.toContainText("tool-2 -> output-3");
    await expect(page.locator(".graph-node")).toHaveCount(3);

    await page.getByTestId("workflow-save").click();
    await expect(page.getByTestId("status-toast")).toContainText("Workflow saved");
    await page.reload();
    await expect(page.getByTestId("workflow-list")).toContainText("Edge Delete Workflow");
    await page.getByTestId("workflow-list").getByRole("button", { name: /Edge Delete Workflow/ }).click();
    await expect(page.getByTestId("workflow-edge-list")).not.toContainText("prompt-1 -> tool-2");
    await expect(page.getByTestId("workflow-edge-list")).not.toContainText("tool-2 -> output-3");
    await expect(page.locator(".graph-node")).toHaveCount(3);
  } finally {
    await studio.close();
    await backend.close();
  }
});

test("Workflow rename and delete menu updates persisted list and current selection", async ({ page }) => {
  const backendPort = await freePort();
  const studioPort = await freePort();
  const backend = await startBackend(backendPort);
  const studio = await startStudio(studioPort, backendPort);

  try {
    await page.goto(`${studio.url}/workflow`);

    await page.getByTestId("workflow-new").click();
    page.once("dialog", (dialog) => dialog.accept("Draft Renamed Workflow"));
    await page.getByRole("button", { name: "Workflow actions for New Workflow" }).click();
    await page.getByRole("menuitem", { name: "Rename" }).click();
    await expect(page.getByTestId("workflow-name")).toHaveValue("Draft Renamed Workflow");

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Workflow actions for Draft Renamed Workflow" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await expect(page.getByTestId("workflow-name")).toHaveValue("");
    expect(new URL(page.url()).search).toBe("");

    await page.getByTestId("workflow-new").click();
    await page.getByTestId("workflow-name").fill("Workflow To Rename");
    await page.locator("[data-node-type='prompt']").click();
    await page.getByTestId("workflow-save").click();
    await expect(page.getByTestId("workflow-list")).toContainText("Workflow To Rename");

    await openWorkflowMenu(page, "Workflow To Rename");
    await expect(page.locator("[data-testid^='workflow-menu-']").getByRole("menuitem")).toHaveText(["Delete", "Rename"]);
    const patchResponse = page.waitForResponse((response) => {
      return response.request().method() === "PATCH" && response.url().includes("/api/templates/") && response.status() === 200;
    });
    page.once("dialog", (dialog) => dialog.accept("Renamed Workflow"));
    await page.getByRole("menuitem", { name: "Rename" }).click();
    await patchResponse;

    await expect(page.getByTestId("workflow-list")).toContainText("Renamed Workflow");
    await page.reload();
    await expect(page.getByTestId("workflow-list")).toContainText("Renamed Workflow");

    await page.getByTestId("workflow-new").click();
    await page.getByTestId("workflow-name").fill("Workflow To Delete");
    await page.locator("[data-node-type='tool']").click();
    await page.getByTestId("workflow-save").click();
    await expect(page.getByTestId("workflow-list")).toContainText("Workflow To Delete");
    const deletingId = new URL(page.url()).searchParams.get("templateId");

    page.once("dialog", (dialog) => dialog.accept());
    const deleteResponse = page.waitForResponse((response) => {
      return response.request().method() === "DELETE" && response.url().includes(`/api/templates/${deletingId}`) && response.status() === 200;
    });
    await openWorkflowMenu(page, "Workflow To Delete");
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await deleteResponse;

    await expect(page.getByTestId("workflow-list")).not.toContainText("Workflow To Delete");
    await expect(page.getByTestId("workflow-list")).toContainText("Renamed Workflow");
    expect(new URL(page.url()).searchParams.get("templateId")).not.toBe(deletingId);
    await page.reload();
    await expect(page.getByTestId("workflow-list")).not.toContainText("Workflow To Delete");
    await expect(page.getByTestId("workflow-list")).toContainText("Renamed Workflow");
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
    const chineseDraft = "\u8fd9\u662f\u4e00\u6bb5\u6d4b\u8bd5\u6587\u5b57";
    await chineseEditor.dispatchEvent("compositionstart");
    await page.keyboard.type(chineseDraft, { delay: 5 });
    await chineseEditor.dispatchEvent("compositionend");
    await expect(chineseEditor).toHaveValue(chineseDraft);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(userCard.locator("p")).toHaveText(chineseDraft);

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

test("Editing a user message forks timeline and streams a new assistant reply", async ({ page }) => {
  const backendPort = await freePort();
  const studioPort = await freePort();
  const backend = await startBackend(backendPort);
  const studio = await startStudio(studioPort, backendPort);

  try {
    await page.goto(`${studio.url}/chat?sessionId=demo-session&timelineId=demo-timeline`);
    const userCard = page.locator(".message-card.user").first();
    await startEditing(page, userCard);
    const editor = page.locator("[data-message-edit-input]").first();
    await editor.click();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await editor.fill("Hello, please reply with OK");

    const patchResponse = page.waitForResponse((response) => {
      return response.request().method() === "PATCH" && response.url().includes("/api/messages/") && response.status() === 200;
    });
    const streamResponse = page.waitForResponse((response) => {
      return response.url().includes("/sse/sessions/demo-session/chat") && response.status() === 200;
    }, { timeout: 5000 });
    await page.getByRole("button", { name: "Save" }).click();

    const patchBody = await (await patchResponse).json();
    const childTimelineId = patchBody.timeline.id;
    const stream = await streamResponse;

    expect(stream.url()).toContain(`timelineId=${childTimelineId}`);
    await expect(page.locator(`[data-testid="timeline-${childTimelineId}"]`)).toHaveAttribute("data-current", "true");
    await expect(page.locator(".message-card.user").getByText("Hello, please reply with OK", { exact: true })).toBeVisible();
    await expect(page.locator(".message-card.assistant").getByText("OK", { exact: true })).toBeVisible();
    await expect(page.getByTestId("composer-input")).toBeFocused();
    const childMessages = await (await page.request.get(`${studio.url}/api/sessions/demo-session/messages?timelineId=${childTimelineId}`)).json();
    expect(childMessages.messages.map((message) => message.content)).toContain("OK");
  } finally {
    await studio.close();
    await backend.close();
  }
});

test("Timeline delete menu removes the current timeline and activates the adjacent timeline", async ({ page }) => {
  const backendPort = await freePort();
  const studioPort = await freePort();
  const backend = await startBackend(backendPort);
  const studio = await startStudio(studioPort, backendPort);

  try {
    await page.goto(`${studio.url}/chat?sessionId=demo-session&timelineId=demo-timeline`);
    const childTimelineId = await forkUserTimeline(page, "Hello, please reply with OK");
    page.once("dialog", (dialog) => dialog.accept());
    const deleteResponse = page.waitForResponse((response) => {
      return response.request().method() === "DELETE" && response.url().includes(`/api/timelines/${childTimelineId}`) && response.status() === 200;
    });

    await openTimelineMenu(page, childTimelineId);
    await page.locator(`[data-delete-timeline-id="${childTimelineId}"]`).click();
    await deleteResponse;

    await expect(page.getByTestId("status-toast")).toContainText("Timeline deleted");
    await expect(page.locator(`[data-testid="timeline-${childTimelineId}"]`)).toHaveCount(0);
    await expect(page.getByTestId("timeline-demo-timeline")).toHaveAttribute("data-current", "true");
    await page.reload();
    await expect(page.locator(`[data-testid="timeline-${childTimelineId}"]`)).toHaveCount(0);
    await expect(page.getByTestId("timeline-demo-timeline")).toHaveAttribute("data-current", "true");
  } finally {
    await studio.close();
    await backend.close();
  }
});

test("Timeline delete menu hides a parent timeline without breaking the current child", async ({ page }) => {
  const backendPort = await freePort();
  const studioPort = await freePort();
  const backend = await startBackend(backendPort);
  const studio = await startStudio(studioPort, backendPort);

  try {
    await page.goto(`${studio.url}/chat?sessionId=demo-session&timelineId=demo-timeline`);
    const childTimelineId = await forkUserTimeline(page, "Hello, please reply with OK");
    page.once("dialog", (dialog) => dialog.accept());
    const deleteResponse = page.waitForResponse((response) => {
      return response.request().method() === "DELETE" && response.url().includes("/api/timelines/demo-timeline") && response.status() === 200;
    });

    await openTimelineMenu(page, "demo-timeline");
    await page.locator('[data-delete-timeline-id="demo-timeline"]').click();
    await deleteResponse;

    await expect(page.getByTestId("status-toast")).toContainText("Timeline deleted");
    await expect(page.getByTestId("timeline-demo-timeline")).toHaveCount(0);
    await expect(page.locator(`[data-testid="timeline-${childTimelineId}"]`)).toHaveAttribute("data-current", "true");
    await expect(page.locator(".message-card.assistant").getByText("OK", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("timeline-demo-timeline")).toHaveCount(0);
    await expect(page.locator(`[data-testid="timeline-${childTimelineId}"]`)).toHaveAttribute("data-current", "true");
  } finally {
    await studio.close();
    await backend.close();
  }
});

test("Timeline delete failure keeps the list current marker and messages unchanged", async ({ page }) => {
  const backendPort = await freePort();
  const studioPort = await freePort();
  const backend = await startBackend(backendPort);
  const studio = await startStudio(studioPort, backendPort);

  try {
    await page.goto(`${studio.url}/chat?sessionId=demo-session&timelineId=demo-timeline`);
    const childTimelineId = await forkUserTimeline(page, "Hello, please reply with OK");
    await page.route(`**/api/timelines/${childTimelineId}`, (route) => {
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: { message: "delete failed" } }),
      });
    });
    page.once("dialog", (dialog) => dialog.accept());

    await openTimelineMenu(page, childTimelineId);
    await page.locator(`[data-delete-timeline-id="${childTimelineId}"]`).click();

    await expect(page.getByTestId("status-toast")).toContainText("delete failed");
    await expect(page.locator(`[data-testid="timeline-${childTimelineId}"]`)).toHaveAttribute("data-current", "true");
    await expect(page.locator(".message-card.assistant").getByText("OK", { exact: true })).toBeVisible();
  } finally {
    await studio.close();
    await backend.close();
  }
});

test("Session and timeline rename menus update labels without changing active ids", async ({ page }) => {
  const backendPort = await freePort();
  const studioPort = await freePort();
  const backend = await startBackend(backendPort);
  const studio = await startStudio(studioPort, backendPort);

  try {
    await page.goto(`${studio.url}/chat?sessionId=demo-session&timelineId=demo-timeline`);

    await openSessionMenu(page, "demo-session");
    await expect(page.getByTestId("session-menu-demo-session").getByRole("menuitem")).toHaveText(["Delete", "Rename"]);
    const sessionPatch = page.waitForResponse((response) => {
      return response.request().method() === "PATCH" && response.url().includes("/api/sessions/demo-session") && response.status() === 200;
    });
    page.once("dialog", (dialog) => dialog.accept("Project Chat"));
    await page.getByTestId("session-menu-demo-session").getByRole("menuitem", { name: "Rename" }).click();
    await sessionPatch;

    await expect(page.getByTestId("session-demo-session")).toContainText("Project Chat");
    await expect(page.getByTestId("session-demo-session")).toHaveAttribute("aria-pressed", "true");
    expect(new URL(page.url()).searchParams.get("sessionId")).toBe("demo-session");

    await openTimelineMenu(page, "demo-timeline");
    await expect(page.getByTestId("timeline-menu-demo-timeline").getByRole("menuitem")).toHaveText(["Delete", "Rename"]);
    const timelinePatch = page.waitForResponse((response) => {
      return response.request().method() === "PATCH" && response.url().includes("/api/timelines/demo-timeline") && response.status() === 200;
    });
    page.once("dialog", (dialog) => dialog.accept("Before Edit"));
    await page.getByTestId("timeline-menu-demo-timeline").getByRole("menuitem", { name: "Rename" }).click();
    await timelinePatch;

    await expect(page.getByTestId("timeline-demo-timeline")).toContainText("Before Edit");
    await expect(page.getByTestId("timeline-demo-timeline")).toHaveAttribute("data-current", "true");
    expect(new URL(page.url()).searchParams.get("timelineId")).toBe("demo-timeline");

    await page.reload();
    await expect(page.getByTestId("session-demo-session")).toContainText("Project Chat");
    await expect(page.getByTestId("timeline-demo-timeline")).toContainText("Before Edit");
    await expect(page.getByTestId("timeline-demo-timeline")).toHaveAttribute("data-current", "true");
  } finally {
    await studio.close();
    await backend.close();
  }
});

test("Timeline rename failure keeps the previous label and current marker", async ({ page }) => {
  const backendPort = await freePort();
  const studioPort = await freePort();
  const backend = await startBackend(backendPort);
  const studio = await startStudio(studioPort, backendPort);

  try {
    await page.goto(`${studio.url}/chat?sessionId=demo-session&timelineId=demo-timeline`);
    await page.route("**/api/timelines/demo-timeline", (route) => {
      if (route.request().method() === "PATCH") {
        route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: { message: "rename failed" } }),
        });
      } else {
        route.continue();
      }
    });

    await openTimelineMenu(page, "demo-timeline");
    page.once("dialog", (dialog) => dialog.accept("Broken Name"));
    await page.getByTestId("timeline-menu-demo-timeline").getByRole("menuitem", { name: "Rename" }).click();

    await expect(page.getByTestId("status-toast")).toContainText("rename failed");
    await expect(page.getByTestId("timeline-demo-timeline")).toContainText("demo-timeline");
    await expect(page.getByTestId("timeline-demo-timeline")).toHaveAttribute("data-current", "true");
  } finally {
    await studio.close();
    await backend.close();
  }
});

test("Forked timeline rename updates the current timeline label immediately", async ({ page }) => {
  const backendPort = await freePort();
  const studioPort = await freePort();
  const backend = await startBackend(backendPort);
  const studio = await startStudio(studioPort, backendPort);

  try {
    await page.goto(`${studio.url}/chat?sessionId=demo-session&timelineId=demo-timeline`);
    const childTimelineId = await forkUserTimeline(page, "Hello, please reply with OK");

    await openTimelineMenu(page, childTimelineId);
    const timelinePatch = page.waitForResponse((response) => {
      return response.request().method() === "PATCH" && response.url().includes(`/api/timelines/${childTimelineId}`) && response.status() === 200;
    });
    page.once("dialog", (dialog) => dialog.accept("Branch Before Edit"));
    await page.getByTestId(`timeline-menu-${childTimelineId}`).getByRole("menuitem", { name: "Rename" }).click();

    const response = await timelinePatch;
    const body = await response.json();
    expect(body).toMatchObject({ id: childTimelineId, title: "Branch Before Edit" });
    await expect(page.getByTestId(`timeline-${childTimelineId}`)).toContainText("Branch Before Edit");
    await expect(page.getByTestId(`timeline-${childTimelineId}`)).toHaveAttribute("data-current", "true");
    expect(new URL(page.url()).searchParams.get("timelineId")).toBe(childTimelineId);

    await page.reload();
    await expect(page.getByTestId(`timeline-${childTimelineId}`)).toContainText("Branch Before Edit");
    await expect(page.getByTestId(`timeline-${childTimelineId}`)).toHaveAttribute("data-current", "true");
  } finally {
    await studio.close();
    await backend.close();
  }
});

test("Timeline rename is not overwritten by an older route projection", async ({ page }) => {
  const backendPort = await freePort();
  const studioPort = await freePort();
  const backend = await startBackend(backendPort);
  const studio = await startStudio(studioPort, backendPort);

  try {
    await page.goto(`${studio.url}/chat?sessionId=demo-session&timelineId=demo-timeline`);
    const staleDebugIndex = await (await page.request.get(`${studio.url}/api/debug/sessions/demo-session`)).json();
    let releaseProjection;
    const projectionHeld = new Promise((resolve) => {
      releaseProjection = resolve;
    });
    await page.route("**/api/debug/sessions/demo-session**", async (route) => {
      await projectionHeld;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(staleDebugIndex),
      });
    });

    const projectionRequest = page.waitForRequest((request) => {
      return request.method() === "GET" && request.url().includes("/api/debug/sessions/demo-session");
    });
    const projectionResponse = page.waitForResponse((response) => {
      return response.url().includes("/api/debug/sessions/demo-session") && response.status() === 200;
    });
    await page.getByTestId("timeline-demo-timeline").click();
    await projectionRequest;

    await openTimelineMenu(page, "demo-timeline");
    const timelinePatch = page.waitForResponse((response) => {
      return response.request().method() === "PATCH" && response.url().includes("/api/timelines/demo-timeline") && response.status() === 200;
    });
    page.once("dialog", (dialog) => dialog.accept("Before Edit"));
    await page.getByTestId("timeline-menu-demo-timeline").getByRole("menuitem", { name: "Rename" }).click();
    await timelinePatch;

    await expect(page.getByTestId("timeline-demo-timeline")).toContainText("Before Edit");
    releaseProjection();
    await projectionResponse;
    await expect(page.getByTestId("timeline-demo-timeline")).toContainText("Before Edit");
  } finally {
    await studio.close();
    await backend.close();
  }
});

test("Blank session rename does not submit a PATCH request", async ({ page }) => {
  const backendPort = await freePort();
  const studioPort = await freePort();
  const backend = await startBackend(backendPort);
  const studio = await startStudio(studioPort, backendPort);
  let patchCount = 0;

  try {
    await page.goto(`${studio.url}/chat?sessionId=demo-session&timelineId=demo-timeline`);
    page.on("request", (request) => {
      if (request.method() === "PATCH" && request.url().includes("/api/sessions/demo-session")) {
        patchCount += 1;
      }
    });

    await openSessionMenu(page, "demo-session");
    page.once("dialog", (dialog) => dialog.accept("   "));
    await page.getByTestId("session-menu-demo-session").getByRole("menuitem", { name: "Rename" }).click();

    await expect(page.getByTestId("status-toast")).toContainText("Name is required");
    expect(patchCount).toBe(0);
    await expect(page.getByTestId("session-demo-session")).toContainText("demo-session");
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

async function forkUserTimeline(page, content) {
  const userCard = page.locator(".message-card.user").first();
  await startEditing(page, userCard);
  const editor = page.locator("[data-message-edit-input]").first();
  await editor.click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await editor.fill(content);

  const patchResponse = page.waitForResponse((response) => {
    return response.request().method() === "PATCH" && response.url().includes("/api/messages/") && response.status() === 200;
  });
  const streamResponse = page.waitForResponse((response) => {
    return response.url().includes("/sse/sessions/demo-session/chat") && response.status() === 200;
  });
  await page.getByRole("button", { name: "Save" }).click();

  const patchBody = await (await patchResponse).json();
  const childTimelineId = patchBody.timeline.id;
  await streamResponse;
  await expect(page.locator(`[data-testid="timeline-${childTimelineId}"]`)).toHaveAttribute("data-current", "true");
  await expect(page.locator(".message-card.assistant").getByText("OK", { exact: true })).toBeVisible();
  return childTimelineId;
}

async function openTimelineMenu(page, timelineId) {
  await page.locator(`[data-testid="timeline-${timelineId}"]`).hover();
  await page.locator(`[data-menu-timeline-id="${timelineId}"]`).click();
  await expect(page.getByTestId(`timeline-menu-${timelineId}`)).toBeVisible();
}

async function openSessionMenu(page, sessionId) {
  await page.locator(`[data-testid="session-${sessionId}"]`).hover();
  await page.locator(`[data-menu-session-id="${sessionId}"]`).click();
  await expect(page.getByTestId(`session-menu-${sessionId}`)).toBeVisible();
}

async function openWorkflowMenu(page, workflowName) {
  const workflowButton = page.locator("[data-action='open-workflow']", { hasText: workflowName }).first();
  await workflowButton.hover();
  const workflowId = await workflowButton.getAttribute("data-workflow-id");
  await page.getByTestId("workflow-list").locator(`[data-menu-workflow-id="${workflowId}"]`).click();
  await expect(page.getByTestId(`workflow-menu-${workflowId}`)).toBeVisible();
}

async function clickWorkflowEdge(page, source, target) {
  const edge = page.locator(`[data-testid='workflow-edge-hit'][data-edge-source='${source}'][data-edge-target='${target}']`);
  const point = await edge.evaluate((element) => {
    const canvas = element.closest("[data-testid='workflow-canvas']");
    const box = element.getBBox();
    if (canvas) {
      canvas.scrollLeft = Math.max(0, box.x + box.width / 2 - canvas.clientWidth / 2);
      canvas.scrollTop = Math.max(0, box.y + box.height / 2 - canvas.clientHeight / 2);
    }
    const rect = element.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  });
  await page.mouse.click(point.x, point.y);
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
