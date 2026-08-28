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

test("New Session adds the created session to Workspace and keeps long ids compact", async ({ page }) => {
  const backendPort = await freePort();
  const studioPort = await freePort();
  const backend = await startBackend(backendPort);
  const studio = await startStudio(studioPort, backendPort);

  try {
    await page.goto(`${studio.url}/chat?sessionId=demo-session&timelineId=demo-timeline`);
    await expect(page.getByTestId("runtime-mode")).toHaveText("Real Runtime");
    const beforeCount = await page.locator("[data-action='select-session']").count();

    await Promise.all([
      page.waitForURL(/sessionId=session_/),
      page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/api/sessions") && response.status() === 201),
      page.getByRole("button", { name: "New Session" }).click(),
    ]);
    await expect(page.getByTestId("status-toast")).toContainText("Session created");

    const currentUrl = new URL(page.url());
    const sessionId = currentUrl.searchParams.get("sessionId");
    const timelineId = currentUrl.searchParams.get("timelineId");
    expect(sessionId).toMatch(/^session_/);
    expect(timelineId).toMatch(/^timeline_/);

    await expect(page.locator("[data-action='select-session']")).toHaveCount(beforeCount + 1);
    const createdSession = page.locator(`[data-session-id='${sessionId}']`);
    await expect(createdSession).toHaveAttribute("aria-pressed", "true");
    await expect(createdSession).toHaveAttribute("title", sessionId);
    await expect(createdSession.locator("[data-testid='workspace-item-label']")).not.toHaveText(sessionId);
    await expect(createdSession.locator("[data-testid='workspace-item-label']")).toContainText(sessionId.slice(0, "session_".length + 8));
    await expect(page.locator(`[data-action='toggle-session-menu'][data-menu-session-id='${sessionId}']`)).toHaveText("...");
    await expect(page.locator(`[data-action='toggle-session-menu'][data-menu-session-id='${sessionId}']`)).toHaveAttribute("aria-expanded", "false");

    const createdTimeline = page.locator(`[data-timeline-id='${timelineId}']`);
    await expect(createdTimeline).toHaveAttribute("title", timelineId);
    await expect(createdTimeline.locator("[data-testid='workspace-item-label']")).not.toHaveText(timelineId);
    await expect(createdTimeline.locator("[data-testid='workspace-item-label']")).toContainText(timelineId.slice(0, "timeline_".length + 8));
    expect(await page.locator(".left-rail").evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  } finally {
    await studio.close();
    await backend.close();
  }
});

test("failed New Session restores the button and leaves the Workspace session list unchanged", async ({ page }) => {
  const runtime = await startRuntime((request, response) => {
    if (request.method === "GET" && request.url === "/api/sessions") {
      sendJson(response, 200, {
        sessions: [
          {
            id: "session_123456789012345678901234567890123456",
            agent_template_id: "research-agent",
            workspace_id: "studio",
            current_timeline_id: "timeline_123456789012345678901234567890123456",
            status: "active",
          },
        ],
      });
      return;
    }
    if (request.method === "GET" && request.url?.startsWith("/api/sessions/session_123456789012345678901234567890123456/messages")) {
      sendJson(response, 200, { messages: [], next_cursor: null });
      return;
    }
    if (request.method === "GET" && request.url === "/api/debug/sessions/session_123456789012345678901234567890123456") {
      sendJson(response, 200, {
        session: {
          id: "session_123456789012345678901234567890123456",
          current_timeline_id: "timeline_123456789012345678901234567890123456",
        },
        timelines: [{ id: "timeline_123456789012345678901234567890123456", session_id: "session_123456789012345678901234567890123456", status: "active" }],
        checkpoints: [],
        messages: [],
        traces: { items: [] },
        context: { items: [] },
      });
      return;
    }
    if (request.method === "GET" && request.url === "/api/sessions/session_123456789012345678901234567890123456/context") {
      sendJson(response, 200, { items: [] });
      return;
    }
    if (request.method === "POST" && request.url === "/api/sessions") {
      sendJson(response, 500, { error: { code: "session.create_failed", message: "Create failed from test runtime" } });
      return;
    }
    response.writeHead(404).end();
  });
  const studioPort = await freePort();
  const studio = await startStudio(studioPort, runtime.port);

  try {
    await page.goto(`${studio.url}/chat?sessionId=session_123456789012345678901234567890123456&timelineId=timeline_123456789012345678901234567890123456`);
    await expect(page.locator("[data-action='select-session']")).toHaveCount(1);
    const beforeCount = await page.locator("[data-action='select-session']").count();
    const currentSession = page.locator("[data-session-id='session_123456789012345678901234567890123456']");
    await expect(currentSession.locator("[data-testid='workspace-item-label']")).not.toHaveText("session_123456789012345678901234567890123456");
    expect(await page.locator(".left-rail").evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);

    await page.getByRole("button", { name: "New Session" }).click();
    await expect(page.getByTestId("status-toast")).toContainText("Create failed from test runtime");
    await expect(page.locator("[data-action='select-session']")).toHaveCount(beforeCount);
    await expect(page.getByRole("button", { name: "New Session" })).toBeEnabled();

    await page.getByRole("button", { name: "New Session" }).click();
    await expect(page.getByTestId("status-toast")).toContainText("Create failed from test runtime");
  } finally {
    await studio.close();
    await runtime.close();
  }
});

test("rapid New Session clicks issue one create request while creation is in flight", async ({ page }) => {
  let createRequests = 0;
  const sessions = [sessionRecord("demo-session", "demo-timeline")];
  const runtime = await startRuntime(async (request, response) => {
    if (request.method === "GET" && request.url === "/api/sessions") {
      sendJson(response, 200, { sessions });
      return;
    }
    if (request.method === "POST" && request.url === "/api/sessions") {
      createRequests += 1;
      await new Promise((resolve) => setTimeout(resolve, 250));
      const session = sessionRecord("session_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "timeline_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
      sessions.push(session);
      sendJson(response, 201, session);
      return;
    }
    const match = request.url?.match(/^\/api\/sessions\/([^/]+)\/(messages|context)$/);
    if (request.method === "GET" && match?.[2] === "messages") {
      sendJson(response, 200, { messages: [], next_cursor: null });
      return;
    }
    if (request.method === "GET" && match?.[2] === "context") {
      sendJson(response, 200, { items: [] });
      return;
    }
    const debugMatch = request.url?.match(/^\/api\/debug\/sessions\/([^?]+)/);
    if (request.method === "GET" && debugMatch) {
      const session = sessions.find((item) => item.id === decodeURIComponent(debugMatch[1])) ?? sessions[0];
      sendJson(response, 200, {
        session,
        timelines: [{ id: session.current_timeline_id, session_id: session.id, status: "active" }],
        checkpoints: [],
        messages: [],
        traces: { items: [] },
        context: { items: [] },
      });
      return;
    }
    response.writeHead(404).end();
  });
  const studioPort = await freePort();
  const studio = await startStudio(studioPort, runtime.port);

  try {
    await page.goto(`${studio.url}/chat?sessionId=demo-session&timelineId=demo-timeline`);
    const createButton = page.getByRole("button", { name: "New Session" });
    const createResponse = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/api/sessions"));
    await createButton.click();
    await expect(page.getByRole("button", { name: "Creating" })).toBeDisabled();
    await page.locator("[data-action='create-session']").click({ trial: true, timeout: 500 }).catch(() => {});
    await createResponse;
    await expect(page.locator("[data-action='select-session']")).toHaveCount(2);
    expect(createRequests).toBe(1);
  } finally {
    await studio.close();
    await runtime.close();
  }
});

test("switching sessions reloads messages with each session active timeline", async ({ page }) => {
  const backendPort = await freePort();
  const studioPort = await freePort();
  const backend = await startBackend(backendPort);
  const studio = await startStudio(studioPort, backendPort);

  try {
    await page.goto(`${studio.url}/chat?sessionId=demo-session&timelineId=demo-timeline`);
    await expect(page.getByText("Summarize the incident report and email the team.")).toBeVisible();

    await Promise.all([
      page.waitForURL(/sessionId=session_/),
      page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/api/sessions") && response.status() === 201),
      page.getByRole("button", { name: "New Session" }).click(),
    ]);
    const sessionB = new URL(page.url()).searchParams.get("sessionId");
    await expect(page.getByTestId("status-toast")).toContainText("Session created");

    await page.getByTestId("composer-input").fill("Session B message");
    await page.getByTestId("send-message").click();
    await expect(page.locator(".message-card.user", { hasText: "Session B message" })).toBeVisible();
    await expect(page.getByTestId("status-toast")).toContainText("Sent");

    await page.locator("[data-session-id='demo-session']").click();
    await expect(page).toHaveURL(/sessionId=demo-session/);
    await expect(page.locator("[data-session-id='demo-session']")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Summarize the incident report and email the team.")).toBeVisible();
    await expect(page.getByText("Session B message")).toHaveCount(0);

    const sessionBButton = page.locator(`[data-session-id='${sessionB}']`);
    await expect(sessionBButton).toBeVisible();
    const sessionBMessages = page.waitForResponse((response) => response.url().includes(`/api/sessions/${sessionB}/messages`));
    await sessionBButton.click();
    const sessionBMessagesBody = await (await sessionBMessages).json();
    expect(sessionBMessagesBody.messages.map((message) => message.content)).toContain("Session B message");
    await expect(page).toHaveURL(new RegExp(`sessionId=${sessionB}`));
    await expect(sessionBButton).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".message-card.user", { hasText: "Session B message" })).toBeVisible();
    await expect(page.getByText("Summarize the incident report and email the team.")).toHaveCount(0);
  } finally {
    await studio.close();
    await backend.close();
  }
});

test("rapid session switching does not let stale message loads overwrite the active session", async ({ page }) => {
  const sessions = [
    sessionRecord("session-a", "timeline-a"),
    sessionRecord("session-b", "timeline-b"),
  ];
  const runtime = await startRuntime(async (request, response) => {
    if (request.method === "GET" && request.url === "/api/sessions") {
      sendJson(response, 200, { sessions });
      return;
    }
    const debugMatch = request.url?.match(/^\/api\/debug\/sessions\/([^?]+)/);
    if (request.method === "GET" && debugMatch) {
      const session = sessions.find((item) => item.id === decodeURIComponent(debugMatch[1])) ?? sessions[0];
      sendJson(response, 200, {
        session,
        timelines: [{ id: session.current_timeline_id, session_id: session.id, status: "active" }],
        checkpoints: [],
        messages: [],
        traces: { items: [] },
        context: { items: [] },
      });
      return;
    }
    const messageMatch = request.url?.match(/^\/api\/sessions\/([^/]+)\/messages/);
    if (request.method === "GET" && messageMatch) {
      const sessionId = decodeURIComponent(messageMatch[1]);
      if (sessionId === "session-b") {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      sendJson(response, 200, {
        messages: [
          {
            id: `${sessionId}-message`,
            session_id: sessionId,
            role: "user",
            content: sessionId === "session-a" ? "Message from Session A" : "Message from Session B",
            status: "completed",
            token_count: 4,
            context_group_ids: [],
            checkpoint_id: null,
            trace_id: null,
            tool_call_ids: [],
            tool_result_ids: [],
          },
        ],
        next_cursor: null,
      });
      return;
    }
    const contextMatch = request.url?.match(/^\/api\/sessions\/([^/]+)\/context$/);
    if (request.method === "GET" && contextMatch) {
      sendJson(response, 200, { items: [] });
      return;
    }
    response.writeHead(404).end();
  });
  const studioPort = await freePort();
  const studio = await startStudio(studioPort, runtime.port);

  try {
    await page.goto(`${studio.url}/chat?sessionId=session-a&timelineId=timeline-a`);
    await expect(page.getByText("Message from Session A")).toBeVisible();

    await page.locator("[data-session-id='session-b']").click();
    await page.locator("[data-session-id='session-a']").click();
    await page.waitForTimeout(500);

    await expect(page.locator("[data-session-id='session-a']")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Message from Session A")).toBeVisible();
    await expect(page.getByText("Message from Session B")).toHaveCount(0);
  } finally {
    await studio.close();
    await runtime.close();
  }
});

test("refresh restores all persisted sessions instead of only the active one", async ({ page }) => {
  const backendPort = await freePort();
  const studioPort = await freePort();
  const backend = await startBackend(backendPort);
  const studio = await startStudio(studioPort, backendPort);

  try {
    await page.goto(`${studio.url}/chat?sessionId=demo-session&timelineId=demo-timeline`);
    await sendMessage(page, "Message from Session A");

    const sessionB = await createSession(page);
    await sendMessage(page, "Message from Session B");

    const sessionC = await createSession(page);
    await sendMessage(page, "Message from Session C");

    await page.reload();
    await expect(page.locator("[data-action='select-session']")).toHaveCount(3);
    await expect(page.locator("[data-session-id='demo-session']")).toBeVisible();
    await expect(page.locator(`[data-session-id='${sessionB}']`)).toBeVisible();
    await expect(page.locator(`[data-session-id='${sessionC}']`)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".message-card.user", { hasText: "Message from Session C" })).toBeVisible();

    await page.locator("[data-session-id='demo-session']").click();
    await expect(page.locator(".message-card.user", { hasText: "Message from Session A" })).toBeVisible();

    await page.locator(`[data-session-id='${sessionB}']`).click();
    await expect(page.locator(".message-card.user", { hasText: "Message from Session B" })).toBeVisible();

    await page.reload();
    await page.reload();
    await expect(page.locator("[data-action='select-session']")).toHaveCount(3);
  } finally {
    await studio.close();
    await backend.close();
  }
});

test("Session overflow menu opens closes and allows only one menu at a time", async ({ page }) => {
  const backendPort = await freePort();
  const studioPort = await freePort();
  const backend = await startBackend(backendPort);
  const studio = await startStudio(studioPort, backendPort);

  try {
    await page.goto(`${studio.url}/chat?sessionId=demo-session&timelineId=demo-timeline`);
    const sessionB = await createSession(page);
    const sessionC = await createSession(page);

    const leftRail = page.locator(".left-rail");
    const sessionBButton = page.locator(`[data-session-id='${sessionB}']`);
    const sessionCButton = page.locator(`[data-session-id='${sessionC}']`);
    const menuB = page.locator(`[data-action='toggle-session-menu'][data-menu-session-id='${sessionB}']`);
    const menuC = page.locator(`[data-action='toggle-session-menu'][data-menu-session-id='${sessionC}']`);
    await expect(menuB).toBeHidden();
    const beforeRailBox = await leftRail.boundingBox();
    const beforeSessionBox = await sessionBButton.boundingBox();
    const beforeSessionCTop = (await sessionCButton.boundingBox())?.y;

    await sessionBButton.hover();
    await expect(menuB).toBeVisible();
    await menuB.click();
    await expect(menuB).toHaveAttribute("aria-expanded", "true");
    const floatingMenuB = page.locator(`[data-testid='session-menu-${sessionB}']`);
    await expect(floatingMenuB).toBeVisible();
    await expect(page.locator(`[data-action='delete-session'][data-delete-session-id='${sessionB}']`)).toHaveText("Delete");
    const afterRailBox = await leftRail.boundingBox();
    const afterSessionBox = await sessionBButton.boundingBox();
    const afterSessionCTop = (await sessionCButton.boundingBox())?.y;
    const menuBox = await floatingMenuB.boundingBox();
    expect(afterRailBox?.width).toBe(beforeRailBox?.width);
    expect(afterSessionBox?.height).toBe(beforeSessionBox?.height);
    expect(afterSessionCTop).toBe(beforeSessionCTop);
    expect(menuBox?.width).toBeLessThanOrEqual(140);
    expect(menuBox?.height).toBeLessThanOrEqual(48);

    await page.getByTestId("main-title").click();
    await expect(page.locator(`[data-testid='session-menu-${sessionB}']`)).toHaveCount(0);
    await expect(menuB).toBeHidden();

    await sessionBButton.hover();
    await menuB.click();
    await sessionCButton.hover();
    await menuC.click();
    await expect(page.locator(`[data-testid='session-menu-${sessionB}']`)).toHaveCount(0);
    await expect(page.locator(`[data-testid='session-menu-${sessionC}']`)).toBeVisible();
  } finally {
    await studio.close();
    await backend.close();
  }
});

test("deleting an inactive session removes it without changing the active session", async ({ page }) => {
  const backendPort = await freePort();
  const studioPort = await freePort();
  const backend = await startBackend(backendPort);
  const studio = await startStudio(studioPort, backendPort);

  try {
    await page.goto(`${studio.url}/chat?sessionId=demo-session&timelineId=demo-timeline`);
    const sessionB = await createSession(page);
    const sessionC = await createSession(page);
    await page.locator("[data-session-id='demo-session']").click();
    await expect(page.locator("[data-session-id='demo-session']")).toHaveAttribute("aria-pressed", "true");

    await acceptNextConfirm(page);
    await openSessionMenu(page, sessionB);
    await page.locator(`[data-action='delete-session'][data-delete-session-id='${sessionB}']`).click();

    await expect(page.locator(`[data-session-id='${sessionB}']`)).toHaveCount(0);
    await expect(page.locator("[data-session-id='demo-session']")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(`[data-session-id='${sessionC}']`)).toBeVisible();

    const sessions = await (await page.request.get(`http://127.0.0.1:${backendPort}/api/sessions`)).json();
    expect(sessions.sessions.map((session) => session.id)).not.toContain(sessionB);

    await page.reload();
    await expect(page.locator("[data-action='select-session']")).toHaveCount(2);
    await expect(page.locator(`[data-session-id='${sessionB}']`)).toHaveCount(0);
  } finally {
    await studio.close();
    await backend.close();
  }
});

test("deleting the active session switches to a remaining session and clears deleted messages", async ({ page }) => {
  const backendPort = await freePort();
  const studioPort = await freePort();
  const backend = await startBackend(backendPort);
  const studio = await startStudio(studioPort, backendPort);

  try {
    await page.goto(`${studio.url}/chat?sessionId=demo-session&timelineId=demo-timeline`);
    const sessionB = await createSession(page);
    await sendMessage(page, "Message before deleting active session");
    const sessionC = await createSession(page);

    await page.locator(`[data-session-id='${sessionB}']`).click();
    await expect(page.locator(".message-card.user", { hasText: "Message before deleting active session" })).toBeVisible();

    await acceptNextConfirm(page);
    await openSessionMenu(page, sessionB);
    await page.locator(`[data-action='delete-session'][data-delete-session-id='${sessionB}']`).click();

    await expect(page.locator(`[data-session-id='${sessionB}']`)).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`sessionId=${sessionC}`));
    await expect(page.locator(`[data-session-id='${sessionC}']`)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".message-card.user", { hasText: "Message before deleting active session" })).toHaveCount(0);
  } finally {
    await studio.close();
    await backend.close();
  }
});

test("deleting the only session leaves Workspace and chat empty", async ({ page }) => {
  let sessions = [sessionRecord("session-only", "timeline-only")];
  const runtime = await startRuntime((request, response) => {
    if (request.method === "GET" && request.url === "/api/sessions") {
      sendJson(response, 200, { sessions });
      return;
    }
    if (request.method === "GET" && request.url === "/api/debug/sessions/session-only") {
      sendJson(response, 200, {
        session: sessions[0],
        timelines: [{ id: "timeline-only", session_id: "session-only", status: "active" }],
        checkpoints: [],
        messages: [],
        traces: { items: [] },
        context: { items: [] },
      });
      return;
    }
    if (request.method === "GET" && request.url?.startsWith("/api/sessions/session-only/messages")) {
      sendJson(response, 200, {
        messages: [
          {
            id: "message-only",
            session_id: "session-only",
            role: "user",
            content: "Only session message",
            status: "completed",
            token_count: 3,
            context_group_ids: [],
            checkpoint_id: null,
            trace_id: null,
            tool_call_ids: [],
            tool_result_ids: [],
          },
        ],
        next_cursor: null,
      });
      return;
    }
    if (request.method === "GET" && request.url === "/api/sessions/session-only/context") {
      sendJson(response, 200, { items: [] });
      return;
    }
    if (request.method === "DELETE" && request.url === "/api/sessions/session-only") {
      const [deleted] = sessions;
      sessions = [];
      sendJson(response, 200, deleted);
      return;
    }
    response.writeHead(404).end();
  });
  const studioPort = await freePort();
  const studio = await startStudio(studioPort, runtime.port);

  try {
    await page.goto(`${studio.url}/chat?sessionId=session-only&timelineId=timeline-only`);
    await expect(page.locator(".message-card.user", { hasText: "Only session message" })).toBeVisible();

    await acceptNextConfirm(page);
    await openSessionMenu(page, "session-only");
    await page.locator("[data-action='delete-session'][data-delete-session-id='session-only']").click();

    await expect(page.locator("[data-action='select-session']")).toHaveCount(0);
    await expect(page.locator(".message-card.user", { hasText: "Only session message" })).toHaveCount(0);
    await expect(page.getByTestId("send-message")).toBeDisabled();
    await expect(page.getByText("Session none / timeline")).toBeVisible();
  } finally {
    await studio.close();
    await runtime.close();
  }
});

test("failed session delete keeps Workspace and active chat unchanged", async ({ page }) => {
  const sessions = [sessionRecord("session-a", "timeline-a"), sessionRecord("session-b", "timeline-b")];
  const runtime = await startRuntime((request, response) => {
    if (request.method === "GET" && request.url === "/api/sessions") {
      sendJson(response, 200, { sessions });
      return;
    }
    const debugMatch = request.url?.match(/^\/api\/debug\/sessions\/([^?]+)/);
    if (request.method === "GET" && debugMatch) {
      const session = sessions.find((item) => item.id === decodeURIComponent(debugMatch[1])) ?? sessions[0];
      sendJson(response, 200, {
        session,
        timelines: [{ id: session.current_timeline_id, session_id: session.id, status: "active" }],
        checkpoints: [],
        messages: [],
        traces: { items: [] },
        context: { items: [] },
      });
      return;
    }
    if (request.method === "GET" && request.url?.includes("/messages")) {
      sendJson(response, 200, { messages: [], next_cursor: null });
      return;
    }
    if (request.method === "GET" && request.url?.includes("/context")) {
      sendJson(response, 200, { items: [] });
      return;
    }
    if (request.method === "DELETE" && request.url === "/api/sessions/session-b") {
      sendJson(response, 500, { error: { code: "session.delete_failed", message: "Delete failed from test runtime" } });
      return;
    }
    response.writeHead(404).end();
  });
  const studioPort = await freePort();
  const studio = await startStudio(studioPort, runtime.port);

  try {
    await page.goto(`${studio.url}/chat?sessionId=session-a&timelineId=timeline-a`);
    await acceptNextConfirm(page);
    await openSessionMenu(page, "session-b");
    await page.locator("[data-action='delete-session'][data-delete-session-id='session-b']").click();

    await expect(page.getByTestId("status-toast")).toContainText("Delete failed from test runtime");
    await expect(page.locator("[data-session-id='session-b']")).toBeVisible();
    await expect(page.locator("[data-session-id='session-a']")).toHaveAttribute("aria-pressed", "true");
  } finally {
    await studio.close();
    await runtime.close();
  }
});

async function startBackend(port) {
  const stateDir = await mkdtemp(join(tmpdir(), "contextos-workspace-"));
  const storagePath = join(stateDir, "runtime-state.json");
  const child = spawn("python", ["-m", "contextos.api", "--host", "127.0.0.1", "--port", String(port)], {
    cwd: repoRoot,
    env: { ...process.env, PYTHONPATH: "backend/src", CONTEXTOS_DISABLE_LLM: "1", CONTEXTOS_RUNTIME_STATE_PATH: storagePath },
    stdio: "ignore",
  });
  const url = `http://127.0.0.1:${port}`;
  await waitForServer(`${url}/health`);
  return {
    async close() {
      child.kill();
      await once(child, "exit").catch(() => {});
      await rm(stateDir, { recursive: true, force: true });
    },
  };
}

async function createSession(page) {
  const beforeUrl = page.url();
  await Promise.all([
    page.waitForURL((url) => url.href !== beforeUrl && url.searchParams.get("sessionId")?.startsWith("session_")),
    page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/api/sessions") && response.status() === 201),
    page.getByRole("button", { name: "New Session" }).click(),
  ]);
  await expect(page.getByTestId("status-toast")).toContainText("Session created");
  return new URL(page.url()).searchParams.get("sessionId");
}

async function sendMessage(page, content) {
  await page.getByTestId("composer-input").fill(content);
  await page.getByTestId("send-message").click();
  await expect(page.locator(".message-card.user", { hasText: content })).toBeVisible();
  await expect(page.getByTestId("status-toast")).toContainText("Sent");
}

async function acceptNextConfirm(page) {
  page.once("dialog", (dialog) => dialog.accept());
}

async function openSessionMenu(page, sessionId) {
  await page.locator(`[data-session-id='${sessionId}']`).hover();
  await page.locator(`[data-action='toggle-session-menu'][data-menu-session-id='${sessionId}']`).click();
  await expect(page.locator(`[data-testid='session-menu-${sessionId}']`)).toBeVisible();
}

async function startRuntime(handler) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  return {
    port,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
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
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`Server did not start at ${url}`);
}

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function sessionRecord(id, timelineId) {
  return {
    id,
    agent_template_id: "research-agent",
    workspace_id: "studio",
    current_timeline_id: timelineId,
    status: "active",
  };
}

function systemChromiumPath() {
  const candidates = [
    process.env.CONTEXTOS_PLAYWRIGHT_EXECUTABLE,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}
