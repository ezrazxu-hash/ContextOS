import { demoFixtures, demoTemplateManifest } from "./test/fixtures/demoRuntime.js";
import { streamSseEvents } from "./client/sseStream.js";

const ROUTES = ["/chat", "/workflow", "/template", "/debug"];
const DEFAULT_SESSION_ID = "demo-session";
const DEFAULT_TIMELINE_ID = "demo-timeline";
const app = document.querySelector("#app");

const state = {
  config: { apiBaseUrl: "http://localhost:8000", sseBaseUrl: "http://localhost:8000", mockRuntime: true },
  route: routePath(window.location.pathname),
  selection: { sessionId: DEFAULT_SESSION_ID, timelineId: DEFAULT_TIMELINE_ID, messageId: null, traceId: null },
  loading: false,
  toast: null,
  leftCollapsed: false,
  rightCollapsed: false,
  rightTab: "context",
  messages: [],
  debugIndex: null,
  contextItems: [],
  workflowNodes: demoTemplateManifest.graph.nodes.slice(0, 4).map((node, index) => ({
    ...node,
    position: { x: 60 + index * 140, y: 80 + (index % 2) * 110 },
  })),
  workflowSelectedNodeId: "planner",
  templateTab: "basic",
  sending: false,
  chatDraft: "",
};

await start();

async function start() {
  state.config = await loadConfig();
  applyUrlSelection();
  window.addEventListener("popstate", async () => {
    state.route = routePath(window.location.pathname);
    applyUrlSelection();
    await loadRouteData();
    render();
  });
  await loadRouteData();
  render();
}

async function loadConfig() {
  try {
    const response = await fetch("/__contextos/config.json");
    if (response.ok) {
      return await response.json();
    }
  } catch {
    return state.config;
  }
  return state.config;
}

async function loadRouteData() {
  state.loading = true;
  state.toast = { tone: "loading", text: "Loading runtime projection" };
  render();
  try {
    const client = runtimeClient();
    if (state.route === "/chat") {
      const [messages, debugIndex] = await Promise.all([
        client.fetchSessionMessages(state.selection.sessionId),
        client.fetchDebugIndex(state.selection.sessionId),
      ]);
      state.messages = messages.messages ?? [];
      state.debugIndex = debugIndex;
      state.contextItems = await client.fetchSessionContext(state.selection.sessionId);
      state.selection.timelineId = state.selection.timelineId ?? debugIndex.session?.current_timeline_id ?? DEFAULT_TIMELINE_ID;
    } else if (state.route === "/debug") {
      state.debugIndex = await client.fetchDebugIndex(state.selection.sessionId, {
        traceId: state.selection.traceId,
        messageId: state.selection.messageId,
      });
      state.messages = state.debugIndex.messages ?? state.messages;
      state.contextItems = contextFromDebug(state.debugIndex);
    }
    state.toast = { tone: "success", text: "Runtime projection ready" };
  } catch (error) {
    state.toast = { tone: "error", text: error.message };
  } finally {
    state.loading = false;
  }
}

function render() {
  app.innerHTML = `
    <div class="studio-app">
      ${renderTopbar()}
      <div class="workbench ${state.leftCollapsed ? "left-collapsed" : ""} ${state.rightCollapsed ? "right-collapsed" : ""}">
        ${renderLeftRail()}
        <main class="main-pane" data-testid="main-pane">${renderMainPane()}</main>
        ${renderRightRail()}
      </div>
      ${renderToast()}
    </div>
    ${styleTag()}
  `;
  bindEvents();
  scrollConversationToBottom();
}

function renderTopbar() {
  return `
    <header class="topbar">
      <div class="brand"><strong>ContextOS</strong><span>Agent Studio</span></div>
      <nav aria-label="Studio sections">
        ${ROUTES.map((path) => {
          const id = path.slice(1);
          return `<a data-action="navigate" data-path="${path}" data-testid="nav-${id}" class="${state.route === path ? "active" : ""}" href="${path}">${labelFor(path)}</a>`;
        }).join("")}
      </nav>
      <div class="runtime"><span class="dot ${state.toast?.tone === "error" ? "error" : "ok"}"></span><span data-testid="runtime-mode">${state.config.mockRuntime ? "Mock Runtime" : "Real Runtime"}</span></div>
    </header>
  `;
}

function renderLeftRail() {
  if (state.leftCollapsed) {
    return `<aside class="left-rail collapsed"><button data-action="toggle-left" aria-label="Expand navigation">></button></aside>`;
  }
  const timelines = state.debugIndex?.timelines ?? [demoFixtures.timeline];
  return `
    <aside class="left-rail">
      <div class="rail-head"><h2>Workspace</h2><button data-action="toggle-left" aria-label="Collapse navigation"><</button></div>
      <section>
        <h3>Sessions</h3>
        <button data-action="select-session" data-session-id="${DEFAULT_SESSION_ID}" data-testid="session-demo-session" aria-pressed="${state.selection.sessionId === DEFAULT_SESSION_ID}" class="nav-item selected">
          <span>demo-session</span><small>${state.config.mockRuntime ? "mock" : "runtime"}</small>
        </button>
      </section>
      <section>
        <h3>Timelines</h3>
        ${timelines.map((timeline) => `
          <button data-action="select-timeline" data-timeline-id="${escapeAttr(timeline.id)}" data-testid="timeline-${escapeAttr(timeline.id)}" aria-pressed="${state.selection.timelineId === timeline.id}" class="nav-item ${state.selection.timelineId === timeline.id ? "selected" : ""}">
            <span>${escapeHtml(timeline.id)}</span><small>${timeline.status ?? "active"}</small>
          </button>
        `).join("")}
      </section>
      <button class="secondary full" data-action="not-implemented">New Session</button>
    </aside>
  `;
}

function renderRightRail() {
  if (state.rightCollapsed) {
    return `<aside class="right-rail collapsed" data-testid="right-panel" data-collapsed="true"><button data-action="toggle-right" data-testid="toggle-right-panel" aria-label="Expand inspector"><</button></aside>`;
  }
  return `
    <aside class="right-rail" data-testid="right-panel" data-collapsed="false">
      <div class="rail-head"><h2 data-testid="right-panel-title">${titleCase(state.rightTab)}</h2><button data-action="toggle-right" data-testid="toggle-right-panel" aria-label="Collapse inspector">></button></div>
      <div class="tabs" role="tablist">
        ${["context", "impact", "trace"].map((tab) => `<button data-action="set-right-tab" data-tab="${tab}" role="tab" aria-selected="${state.rightTab === tab}" class="${state.rightTab === tab ? "active" : ""}">${titleCase(tab)}</button>`).join("")}
      </div>
      <div class="inspector-body">${renderRightTab()}</div>
    </aside>
  `;
}

function renderMainPane() {
  if (state.route === "/chat") return renderChat();
  if (state.route === "/workflow") return renderWorkflow();
  if (state.route === "/template") return renderTemplate();
  return renderDebug();
}

function renderChat() {
  return `
    <section class="chat-workbench" data-testid="chat-workbench">
      <div class="page-head">
        <div><h1 data-testid="main-title">Chat Workbench</h1><p>Session ${escapeHtml(state.selection.sessionId)} / ${escapeHtml(state.selection.timelineId ?? "timeline")}</p></div>
        <button class="secondary" data-action="refresh-route" ${state.loading ? "disabled" : ""}>Refresh</button>
      </div>
      <div class="messages" data-testid="message-list">${state.messages.map(renderMessage).join("")}</div>
      <form class="composer" data-action="send-chat">
        <textarea data-testid="composer-input" placeholder="Message the agent. Enter sends, Shift+Enter adds a line." rows="1" ${state.sending ? "disabled" : ""}>${escapeHtml(state.chatDraft)}</textarea>
        <button data-testid="send-message" type="submit" ${state.sending ? "disabled" : ""}>${state.sending ? "Sending" : "Send"}</button>
      </form>
    </section>
  `;
}

function renderMessage(message) {
  const selected = state.selection.messageId === message.id;
  const role = message.role ?? "assistant";
  const traceId = message.trace_id ?? message.traceId;
  return `
    <article class="message-card ${role} ${selected ? "selected" : ""}" data-action="select-message" data-message-id="${escapeAttr(message.id)}" data-testid="message-${escapeAttr(message.id)}" tabindex="0">
      <header><strong>${role === "assistant" ? "Assistant" : role === "user" ? "User" : titleCase(role)}</strong><span>${message.status ?? "completed"}</span></header>
      <p>${escapeHtml(message.content ?? "")}</p>
      ${message.error ? `<p class="message-error">${escapeHtml(message.error)}</p>` : ""}
      ${renderToolRelations(message)}
      ${traceId ? `<button class="trace-pill" data-action="open-trace" data-trace-id="${escapeAttr(traceId)}" type="button">Trace ${escapeHtml(traceId)}</button>` : ""}
    </article>
  `;
}

function renderToolRelations(message) {
  const callIds = message.tool_call_ids ?? message.toolCallIds ?? [];
  const resultIds = message.tool_result_ids ?? message.toolResultIds ?? [];
  if (callIds.length === 0 && resultIds.length === 0) return "";
  return `<div class="tool-strip">${callIds.map((id) => `<span class="tool-call">ToolCall ${escapeHtml(id)}</span>`).join("")}${resultIds.map((id) => `<span class="tool-result">ToolResult ${escapeHtml(id)}</span>`).join("")}</div>`;
}

function renderWorkflow() {
  const selected = state.workflowNodes.find((node) => node.id === state.workflowSelectedNodeId) ?? state.workflowNodes[0];
  return `
    <section class="workflow-page">
      <div class="page-head">
        <div><h1 data-testid="main-title">Workflow Builder</h1><p>Local manifest draft. Runtime save/validate API is not implemented in this HTTP host.</p></div>
        <div class="actions"><button class="secondary" data-action="add-workflow-node">Add Agent</button><button class="secondary" data-action="not-implemented">Validate</button><button data-action="not-implemented" data-testid="workflow-save">Save</button></div>
      </div>
      <div class="workflow-surface" data-testid="workflow-workbench">
        <div class="node-palette"><h2>Node Library</h2>${["agent", "tool", "condition", "context_operator", "output"].map((type) => `<button data-action="add-workflow-node" data-node-type="${type}">${type.replace(/_/g, " ")}</button>`).join("")}</div>
        <div class="graph-canvas">${state.workflowNodes.map((node) => `<button data-action="select-workflow-node" data-node-id="${escapeAttr(node.id)}" class="graph-node ${state.workflowSelectedNodeId === node.id ? "selected" : ""}" style="left:${node.position.x}px;top:${node.position.y}px">${escapeHtml(node.type)}</button>`).join("")}</div>
        <div class="node-config"><h2>Node Config</h2>${selected ? `<dl><dt>ID</dt><dd>${escapeHtml(selected.id)}</dd><dt>Type</dt><dd>${escapeHtml(selected.type)}</dd></dl>` : "<p>Select a node.</p>"}<button class="secondary" data-action="not-implemented">Apply Config</button></div>
      </div>
    </section>
  `;
}

function renderTemplate() {
  const manifest = demoTemplateManifest;
  const sections = {
    basic: [["ID", manifest.template.id], ["Name", manifest.template.name], ["Version", manifest.template.version]],
    model: [["Model", manifest.graph.nodes.find((node) => node.type === "agent")?.config?.model ?? ""]],
    prompt: [["Prompt", manifest.graph.nodes.find((node) => node.type === "agent")?.config?.prompt ?? ""]],
    context: [["Policy", manifest.context.policy], ["Restore", manifest.context.restore.mode]],
  };
  return `
    <section class="template-page" data-testid="template-workbench">
      <div class="page-head"><div><h1 data-testid="main-title">Template Editor</h1><p>Template HTTP APIs are not implemented in this host; fields are read-only.</p></div><button data-action="not-implemented">Save Template</button></div>
      <div class="template-layout">
        <div class="tabs vertical">${Object.keys(sections).map((tab) => `<button data-action="set-template-tab" data-tab="${tab}" class="${state.templateTab === tab ? "active" : ""}">${titleCase(tab)}</button>`).join("")}</div>
        <div class="template-fields">${(sections[state.templateTab] ?? []).map(([label, value]) => `<label>${escapeHtml(label)}<input readonly value="${escapeAttr(value)}" /></label>`).join("")}</div>
      </div>
    </section>
  `;
}

function renderDebug() {
  const traces = state.debugIndex?.traces?.items ?? [];
  return `
    <section class="debug-page" data-testid="debug-workbench">
      <div class="page-head"><div><h1 data-testid="main-title">Debug Inspector</h1><p>Trace, checkpoint, and message projections from Runtime.</p></div><button class="secondary" data-action="refresh-route">Refresh</button></div>
      <div class="debug-grid">
        <section><h2>Traces</h2>${traces.map((trace) => `<button class="trace-row ${state.selection.traceId === trace.trace_id ? "selected" : ""}" data-action="select-trace" data-trace-id="${escapeAttr(trace.trace_id)}">${escapeHtml(trace.component)} <small>${escapeHtml(trace.status ?? "ok")}</small></button>`).join("")}</section>
        <section><h2>Messages</h2>${(state.debugIndex?.messages ?? []).map((message) => `<button class="debug-message ${state.selection.messageId === message.id ? "selected" : ""}" data-action="select-message" data-message-id="${escapeAttr(message.id)}">${escapeHtml(message.content)}</button>`).join("")}</section>
      </div>
    </section>
  `;
}

function renderRightTab() {
  const message = selectedMessage();
  if (state.rightTab === "impact") {
    return `<p data-testid="impact-anchor">Anchor: ${escapeHtml(message?.id ?? "No message selected")}</p><div class="impact-list"><p>${message ? (message.role === "assistant" ? "Assistant output may affect trace replay and context." : "User prompt anchors the next agent step.") : "Select a message to inspect impact."}</p></div>`;
  }
  if (state.rightTab === "trace") {
    const trace = selectedTrace();
    return trace ? `<dl><dt>Trace</dt><dd>${escapeHtml(trace.trace_id)}</dd><dt>Component</dt><dd>${escapeHtml(trace.component)}</dd><dt>Status</dt><dd>${escapeHtml(trace.status ?? "ok")}</dd></dl>` : "<p>Select a trace or message with trace metadata.</p>";
  }
  const relatedGroupIds = new Set(message?.context_group_ids ?? []);
  const items = state.contextItems.filter((item) => relatedGroupIds.size === 0 || relatedGroupIds.has(item.group_id));
  return `<div class="context-list">${items.length === 0 ? "<p>No context API projection is available.</p>" : items.map((item) => `<article class="context-item"><strong>${escapeHtml(item.state)}</strong><p>${escapeHtml(item.effective_content ?? item.effectiveContent ?? "")}</p><button class="secondary" data-action="not-implemented">Evict</button></article>`).join("")}</div>`;
}

function renderToast() {
  return state.toast ? `<div class="toast ${state.toast.tone}" data-testid="status-toast">${escapeHtml(state.toast.text)}</div>` : "";
}

function bindEvents() {
  document.querySelectorAll("[data-action]").forEach((element) => element.addEventListener("click", handleAction));
  const composer = document.querySelector(".composer");
  composer?.addEventListener("submit", handleChatSubmit);
  const input = document.querySelector("[data-testid='composer-input']");
  input?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      composer.requestSubmit();
    }
  });
  input?.addEventListener("input", () => {
    state.chatDraft = input.value;
  });
}

async function handleAction(event) {
  const target = event.currentTarget;
  const action = target.dataset.action;
  if (action === "navigate") {
    event.preventDefault();
    await navigate(target.dataset.path);
  } else if (action === "toggle-left") {
    state.leftCollapsed = !state.leftCollapsed;
    render();
  } else if (action === "toggle-right") {
    state.rightCollapsed = !state.rightCollapsed;
    render();
  } else if (action === "set-right-tab") {
    state.rightTab = target.dataset.tab;
    render();
  } else if (action === "set-template-tab") {
    state.templateTab = target.dataset.tab;
    state.toast = { tone: "success", text: `${titleCase(state.templateTab)} section selected` };
    render();
  } else if (action === "select-session") {
    state.selection.sessionId = target.dataset.sessionId;
    state.selection.messageId = null;
    state.selection.traceId = null;
    await loadRouteData();
    render();
  } else if (action === "select-timeline") {
    state.selection.timelineId = target.dataset.timelineId;
    state.toast = { tone: "success", text: `Timeline ${state.selection.timelineId} selected` };
    render();
  } else if (action === "select-message") {
    state.selection.messageId = target.dataset.messageId;
    const message = selectedMessage();
    state.selection.traceId = message?.trace_id ?? message?.traceId ?? state.selection.traceId;
    state.rightTab = "impact";
    render();
  } else if (action === "open-trace" || action === "select-trace") {
    event.stopPropagation();
    state.selection.traceId = target.dataset.traceId;
    state.rightTab = "trace";
    if (action === "open-trace") {
      await navigate(`/debug?sessionId=${encodeURIComponent(state.selection.sessionId)}&traceId=${encodeURIComponent(state.selection.traceId)}`);
    } else {
      render();
    }
  } else if (action === "refresh-route") {
    await loadRouteData();
    render();
  } else if (action === "add-workflow-node") {
    addWorkflowNode(target.dataset.nodeType ?? "agent");
    render();
  } else if (action === "select-workflow-node") {
    state.workflowSelectedNodeId = target.dataset.nodeId;
    render();
  } else if (action === "not-implemented") {
    state.toast = { tone: "warning", text: "Not implemented in the current HTTP Runtime" };
    render();
  }
}

async function handleChatSubmit(event) {
  event.preventDefault();
  const input = document.querySelector("[data-testid='composer-input']");
  state.chatDraft = input?.value ?? state.chatDraft;
  const content = state.chatDraft.trim();
  if (!content || state.sending) return;
  const client = runtimeClient();
  state.sending = true;
  state.chatDraft = "";
  state.toast = { tone: "loading", text: "Sending message to Runtime" };
  render();
  try {
    const created = await client.postSessionMessage(state.selection.sessionId, content);
    state.messages.push(created);
    render();
    await streamAssistantReply(client);
    state.toast = { tone: "success", text: "Sent" };
  } catch (error) {
    state.chatDraft = content;
    markStreamingMessageFailed(error);
    state.toast = { tone: "error", text: `Send failed: ${error.message}` };
  } finally {
    state.sending = false;
    render();
  }
}

async function streamAssistantReply(client) {
  for await (const event of client.streamChatEvents(state.selection.sessionId, state.selection.timelineId ?? DEFAULT_TIMELINE_ID)) {
    if (event.type === "token") applyToken(event.data);
    if (event.type === "done") completeStreamMessage(event.data);
    if (event.type === "tool_call") attachTool(event.data, "tool_call_ids");
    if (event.type === "tool_result") attachTool(event.data, "tool_result_ids");
    render();
  }
}

function applyToken(data) {
  const id = data.message_id;
  let message = state.messages.find((item) => item.id === id);
  if (!message) {
    message = { id, role: data.role ?? "assistant", content: "", status: "streaming", checkpoint_id: null, trace_id: data.trace_id ?? "trace-send-report-email", context_group_ids: [], tool_call_ids: [], tool_result_ids: [] };
    state.messages.push(message);
  }
  message.content += data.content ?? "";
}

function completeStreamMessage(data) {
  let message = state.messages.find((item) => item.id === data.message_id);
  if (!message) {
    message = [...state.messages].reverse().find((item) => item.role === "assistant" && item.status === "streaming");
    if (message && data.message_id) {
      if (state.selection.messageId === message.id) {
        state.selection.messageId = data.message_id;
      }
      message.id = data.message_id;
    }
  }
  if (message) {
    message.status = "completed";
    message.checkpoint_id = data.checkpoint_id ?? message.checkpoint_id;
    message.trace_id = data.trace_id ?? message.trace_id ?? "trace-chat-response";
  }
}

function markStreamingMessageFailed(error) {
  const message = [...state.messages].reverse().find((item) => item.role === "assistant" && item.status === "streaming");
  if (message) {
    message.status = "failed";
    message.error = error.message;
  }
}

function attachTool(data, field) {
  const message = state.messages.find((item) => item.id === data.message_id);
  const id = data.call_id ?? data.tool_call_id;
  if (message && id && !message[field].includes(id)) message[field].push(id);
}

async function navigate(path) {
  const parsed = new URL(path, window.location.origin);
  state.route = routePath(parsed.pathname);
  history.pushState({}, "", `${state.route}${parsed.search}`);
  applyUrlSelection();
  await loadRouteData();
  render();
}

function addWorkflowNode(type) {
  const id = `${type}-${state.workflowNodes.length + 1}`.replace(/_/g, "-");
  state.workflowNodes.push({ id, type, config: {}, position: { x: 80 + (state.workflowNodes.length % 4) * 150, y: 80 + Math.floor(state.workflowNodes.length / 4) * 120 } });
  state.workflowSelectedNodeId = id;
  state.toast = { tone: "success", text: `${titleCase(type.replace(/_/g, " "))} node added` };
}

function runtimeClient() {
  return state.config.mockRuntime ? mockClient() : realClient();
}

function realClient() {
  return {
    fetchSessionMessages: (sessionId) => getJson(`/api/sessions/${encodeURIComponent(sessionId)}/messages`),
    postSessionMessage: (sessionId, content) => postJson(`/api/sessions/${encodeURIComponent(sessionId)}/messages`, { role: "user", content, token_count: tokenEstimate(content) }),
    fetchDebugIndex(sessionId, params = {}) {
      const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value)).toString();
      return getJson(`/api/debug/sessions/${encodeURIComponent(sessionId)}${query ? `?${query}` : ""}`);
    },
    async fetchSessionContext(sessionId) {
      try {
        const body = await getJson(`/api/sessions/${encodeURIComponent(sessionId)}/context`);
        return body.items ?? body;
      } catch {
        return contextFromDebug(state.debugIndex);
      }
    },
    streamChatEvents: (sessionId, timelineId) => streamSse(`/sse/sessions/${encodeURIComponent(sessionId)}/chat?timelineId=${encodeURIComponent(timelineId)}`),
  };
}

function mockClient() {
  const contextItems = demoFixtures.context.map(clone);
  return {
    async fetchSessionMessages() {
      return { messages: demoFixtures.messages.map(clone), next_cursor: null };
    },
    async postSessionMessage(sessionId, content) {
      return { id: `local-user-${Date.now()}`, session_id: sessionId, role: "user", content, status: "completed", token_count: tokenEstimate(content), context_group_ids: [], checkpoint_id: null, trace_id: null, tool_call_ids: [], tool_result_ids: [] };
    },
    async fetchDebugIndex() {
      return { session: clone(demoFixtures.session), timelines: [clone(demoFixtures.timeline)], checkpoints: [clone(demoFixtures.checkpoint)], messages: demoFixtures.messages.map(clone), traces: { items: [{ trace_id: "trace-send-report-email", component: "send_report_email", status: "blocked", message_id: "demo-assistant-message" }] }, context: { items: contextItems.map(clone) } };
    },
    async fetchSessionContext() {
      return contextItems.map(clone);
    },
    async *streamChatEvents() {
      yield { type: "token", data: { message_id: "message-stream", role: "assistant", content: "Report" } };
      yield { type: "token", data: { message_id: "message-stream", role: "assistant", content: " sent" } };
      yield { type: "done", data: { message_id: "message-stream", checkpoint_id: "demo-checkpoint" } };
    },
  };
}

async function getJson(path) {
  const response = await fetch(path);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message ?? `Runtime request failed with ${response.status}`);
  return body;
}

async function postJson(path, payload) {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message ?? `Runtime request failed with ${response.status}`);
  return body;
}

async function* streamSse(path) {
  const response = await fetch(path, { headers: { accept: "text/event-stream" } });
  if (!response.ok) throw new Error(`Runtime stream failed with ${response.status}`);
  for await (const event of streamSseEvents(response)) {
    if (event?.type === "error") throw new Error(event.data?.message ?? "Runtime stream failed");
    if (event) yield event;
  }
}

function selectedMessage() {
  return state.messages.find((message) => message.id === state.selection.messageId) ?? null;
}

function selectedTrace() {
  const traces = state.debugIndex?.traces?.items ?? [];
  if (state.selection.traceId) return traces.find((trace) => trace.trace_id === state.selection.traceId) ?? null;
  const traceId = selectedMessage()?.trace_id ?? selectedMessage()?.traceId;
  return traces.find((trace) => trace.trace_id === traceId) ?? null;
}

function contextFromDebug(debugIndex) {
  return debugIndex?.context?.items ?? [];
}

function applyUrlSelection() {
  const params = new URLSearchParams(window.location.search);
  state.selection.sessionId = params.get("sessionId") ?? state.selection.sessionId ?? DEFAULT_SESSION_ID;
  state.selection.timelineId = params.get("timelineId") ?? state.selection.timelineId ?? DEFAULT_TIMELINE_ID;
  state.selection.messageId = params.get("messageId");
  state.selection.traceId = params.get("traceId");
}

function scrollConversationToBottom() {
  const list = document.querySelector("[data-testid='message-list']");
  if (list) list.scrollTop = list.scrollHeight;
}

function routePath(pathname) {
  return ROUTES.includes(pathname) ? pathname : "/chat";
}

function labelFor(path) {
  return titleCase(path.slice(1));
}

function titleCase(value) {
  return String(value).replace(/\b\w/g, (char) => char.toUpperCase());
}

function tokenEstimate(content) {
  return Math.max(1, content.trim().split(/\s+/).length);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

function styleTag() {
  return `<style>
    :root { --bg:#f5f7fa; --panel:#fff; --line:#d7dee8; --line-strong:#b8c4d2; --text:#162033; --muted:#637083; --accent:#2563eb; --accent-soft:#e8f0ff; --success:#0f8a5f; --warning:#9a5b00; --error:#c0342b; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.45 Inter, "Segoe UI", Arial, sans-serif; }
    button, textarea, input { font: inherit; }
    button { border: 1px solid var(--line-strong); background: var(--panel); color: var(--text); border-radius: 7px; padding: 8px 12px; cursor: pointer; }
    button:hover:not(:disabled), a:hover { border-color: var(--accent); color: var(--accent); }
    button:disabled { cursor: not-allowed; opacity: .55; }
    .secondary { background: #f8fafc; }
    .full { width: 100%; }
    .topbar { height: 56px; display: grid; grid-template-columns: 280px 1fr 220px; align-items: center; gap: 16px; padding: 0 18px; background: #111a27; color: #fff; border-bottom: 1px solid #263244; }
    .brand { display: flex; gap: 12px; align-items: baseline; }
    .brand strong { font-size: 17px; letter-spacing: 0; }
    .brand span, .runtime { color: #aeb9c7; }
    nav { display: flex; gap: 4px; justify-content: center; }
    nav a { color: #dce4ee; text-decoration: none; padding: 7px 12px; border: 1px solid transparent; border-radius: 7px; }
    nav a.active { background: #243246; border-color: #3a4b63; color: #fff; }
    .runtime { justify-self: end; display: flex; align-items: center; gap: 8px; }
    .dot { width: 8px; height: 8px; border-radius: 999px; background: var(--success); }
    .dot.error { background: var(--error); }
    .workbench { height: calc(100vh - 56px); display: grid; grid-template-columns: 250px minmax(520px, 1fr) 330px; overflow: hidden; }
    .workbench.left-collapsed { grid-template-columns: 48px minmax(520px, 1fr) 330px; }
    .workbench.right-collapsed { grid-template-columns: 250px minmax(520px, 1fr) 48px; }
    .workbench.left-collapsed.right-collapsed { grid-template-columns: 48px minmax(520px, 1fr) 48px; }
    .left-rail, .right-rail { min-width: 0; overflow: auto; background: var(--panel); border-right: 1px solid var(--line); padding: 14px; }
    .right-rail { border-right: 0; border-left: 1px solid var(--line); }
    .collapsed { display: flex; align-items: flex-start; justify-content: center; padding: 12px 6px; }
    .rail-head, .page-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 14px; }
    h1, h2, h3, p { margin-top: 0; }
    h1 { font-size: 24px; margin-bottom: 4px; letter-spacing: 0; }
    h2 { font-size: 13px; color: var(--muted); text-transform: uppercase; margin-bottom: 10px; letter-spacing: 0; }
    h3 { font-size: 12px; color: var(--muted); text-transform: uppercase; margin: 18px 0 8px; letter-spacing: 0; }
    .main-pane { min-width: 0; overflow: hidden; padding: 18px; }
    .chat-workbench, .workflow-page, .template-page, .debug-page { height: 100%; display: flex; flex-direction: column; min-height: 0; }
    .page-head { flex: 0 0 auto; }
    .page-head p { color: var(--muted); margin: 0; }
    .messages { flex: 1 1 auto; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 12px; padding: 4px 4px 16px; }
    .message-card { width: min(820px, 92%); border: 1px solid var(--line); background: var(--panel); border-radius: 10px; padding: 13px 14px; cursor: pointer; }
    .message-card.user { align-self: flex-end; border-color: #c2d7cd; background: #f3fbf7; }
    .message-card.assistant { align-self: flex-start; border-color: #bfd0ec; background: #f8fbff; }
    .message-card.selected { outline: 2px solid var(--accent); }
    .message-card header { display: flex; justify-content: space-between; gap: 12px; color: var(--muted); margin-bottom: 8px; }
    .message-card p { margin-bottom: 10px; white-space: pre-wrap; }
    .message-error { color: var(--error); font-size: 13px; }
    .tool-strip { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
    .tool-call, .tool-result, .trace-pill { display: inline-flex; align-items: center; border-radius: 999px; padding: 4px 8px; font-size: 12px; }
    .tool-call { background: #fff4e5; color: #875300; }
    .tool-result { background: #e8f7ef; color: #0f6a49; }
    .trace-pill { background: var(--accent-soft); border-color: #b9cdfa; color: #1d4ed8; }
    .composer { flex: 0 0 auto; display: grid; grid-template-columns: 1fr auto; gap: 10px; padding: 12px; border: 1px solid var(--line); background: var(--panel); border-radius: 12px; }
    textarea { resize: none; min-height: 42px; max-height: 140px; border: 0; outline: 0; background: transparent; padding: 8px; }
    .nav-item { width: 100%; display: grid; grid-template-columns: 1fr auto; gap: 8px; text-align: left; margin-bottom: 8px; }
    .nav-item small { color: var(--muted); }
    .selected { border-color: var(--accent); box-shadow: inset 3px 0 0 var(--accent); }
    .tabs { display: flex; gap: 6px; margin-bottom: 12px; }
    .tabs.vertical { flex-direction: column; width: 180px; }
    .tabs .active { background: var(--accent-soft); border-color: #b9cdfa; color: #1d4ed8; }
    .context-item { border: 1px solid var(--line); border-radius: 8px; padding: 10px; margin-bottom: 10px; background: #fbfcfe; }
    .workflow-surface { flex: 1; min-height: 0; display: grid; grid-template-columns: 180px 1fr 240px; gap: 12px; }
    .node-palette, .node-config, .template-fields, .debug-grid section { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 12px; overflow: auto; }
    .node-palette button { width: 100%; margin-bottom: 8px; text-align: left; }
    .graph-canvas { position: relative; min-height: 0; border: 1px solid var(--line); border-radius: 10px; background: linear-gradient(#e8edf3 1px, transparent 1px), linear-gradient(90deg, #e8edf3 1px, transparent 1px), #fff; background-size: 28px 28px; overflow: auto; }
    .graph-node { position: absolute; min-width: 112px; height: 56px; background: #fff; }
    .template-layout { display: flex; gap: 14px; min-height: 0; }
    .template-fields { flex: 1; display: grid; align-content: start; gap: 12px; }
    label { display: grid; gap: 6px; color: var(--muted); }
    input { border: 1px solid var(--line); border-radius: 7px; padding: 9px 10px; color: var(--text); background: #f8fafc; }
    .debug-grid { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(260px, .9fr) 1.2fr; gap: 12px; }
    .trace-row, .debug-message { width: 100%; display: flex; justify-content: space-between; gap: 12px; text-align: left; margin-bottom: 8px; }
    .toast { position: fixed; right: 18px; bottom: 18px; max-width: 420px; padding: 10px 12px; border-radius: 9px; background: #111a27; color: #fff; box-shadow: 0 8px 24px rgba(16, 24, 40, .16); }
    .toast.success { background: var(--success); }
    .toast.error { background: var(--error); }
    .toast.warning { background: var(--warning); }
    .toast.loading { background: #334155; }
    dt { color: var(--muted); font-size: 12px; }
    dd { margin: 0 0 10px; }
    @media (max-width: 980px) {
      .topbar { height: auto; grid-template-columns: 1fr; padding: 12px; }
      nav { justify-content: flex-start; flex-wrap: wrap; }
      .runtime { justify-self: start; }
      .workbench, .workbench.left-collapsed, .workbench.right-collapsed, .workbench.left-collapsed.right-collapsed { height: auto; min-height: calc(100vh - 56px); grid-template-columns: 1fr; }
      .left-rail, .right-rail { border: 0; border-bottom: 1px solid var(--line); }
      .main-pane { min-height: 680px; }
      .workflow-surface, .debug-grid { grid-template-columns: 1fr; }
      .message-card { width: 100%; }
    }
  </style>`;
}
