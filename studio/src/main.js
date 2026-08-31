import { demoFixtures, demoTemplateManifest } from "./test/fixtures/demoRuntime.js";
import { streamSseEvents } from "./client/sseStream.js";
import { deserializeGraph, serializeGraph } from "./workflow/manifest/model.js";
import {
  createSessionWithSelectedAgent,
  fetchPublishedAgentOptions,
  sessionAgentLabel,
  switchSessionAgent,
} from "./session/agentSelector.js";

const ROUTES = ["/chat", "/workflow", "/template", "/debug"];
const DEFAULT_SESSION_ID = "demo-session";
const DEFAULT_TIMELINE_ID = "demo-timeline";
const WORKFLOW_MIN_ZOOM = 0.4;
const WORKFLOW_MAX_ZOOM = 2;
const WORKFLOW_ZOOM_STEP = 0.1;
const app = document.querySelector("#app");
let routeLoadVersion = 0;
const demoWorkflowGraph = deserializeGraph(demoTemplateManifest);
const WORKFLOW_NODE_TYPES = ["prompt", "llm", "tool", "condition", "output"];
const WORKFLOW_CONFIG_FIELDS = {
  prompt: ["role", "template", "variables", "input_mapping", "output_key"],
  llm: ["provider", "model", "max_tokens", "system_prompt", "prompt", "temperature", "input_mapping", "output_key"],
  tool: ["tool_name", "args", "output_key"],
  condition: ["source", "operator", "value", "state_key"],
  output: ["source"],
};
const WORKFLOW_JSON_CONFIG_FIELDS = new Set(["variables", "input_mapping", "args"]);
const WORKFLOW_NUMBER_CONFIG_FIELDS = new Set(["temperature", "max_tokens"]);

const state = {
  config: { apiBaseUrl: "http://localhost:18000", sseBaseUrl: "http://localhost:18000", mockRuntime: true },
  route: routePath(window.location.pathname),
  selection: { sessionId: DEFAULT_SESSION_ID, timelineId: DEFAULT_TIMELINE_ID, messageId: null, traceId: null },
  loading: false,
  creatingSession: false,
  deletingSessionId: null,
  deletingTimelineId: null,
  deletingWorkflowId: null,
  renamingSessionId: null,
  renamingTimelineId: null,
  renamingWorkflowId: null,
  openSessionMenuId: null,
  sessionMenuPosition: null,
  openTimelineMenuId: null,
  timelineMenuPosition: null,
  openWorkflowMenuId: null,
  workflowMenuPosition: null,
  openMessageMenuId: null,
  messageMenuPosition: null,
  editingMessageId: null,
  editingMessageDraft: "",
  messageMutationId: null,
  toast: null,
  leftCollapsed: false,
  rightCollapsed: false,
  rightTab: "context",
  messages: [],
  sessions: [demoFixtures.session],
  agentOptions: [{ id: "legacy", label: "Legacy / Default", agentVersionId: null, agentTemplateId: null }],
  selectedAgentOptionId: "legacy",
  switchingAgent: false,
  debugIndex: null,
  contextItems: [],
  workflowNodes: demoWorkflowGraph.nodes.map((node, index) => ({
    ...node,
    position: node.position ?? { x: 60 + index * 140, y: 80 + (index % 2) * 110 },
  })),
  workflowEdges: demoWorkflowGraph.edges.map((edge) => ({
    from: edge.source,
    to: edge.target,
    ...(edge.route ? { condition: edge.route } : {}),
  })),
  workflowTemplates: [],
  workflowSelectedTemplateId: demoTemplateManifest.template.id,
  workflowName: demoTemplateManifest.template.name,
  workflowDirty: false,
  workflowSaving: false,
  workflowDrag: null,
  workflowCanvasPan: null,
  workflowSelectedNodeId: "planner",
  workflowSelectedEdgeIndex: null,
  workflowEdgeSourceId: null,
  workflowCanvasZoom: 1,
  workflowGraphPreview: null,
  workflowPreviewing: false,
  workflowToolCatalog: [],
  workflowPublishedVersion: null,
  workflowPublishing: false,
  workflowTestInput: "",
  workflowTesting: false,
  workflowTestRun: null,
  workflowRuntimeEvents: [],
  templateTab: "basic",
  sending: false,
  chatDraft: "",
  shouldRefocusComposer: false,
  suppressComposerRefocus: false,
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
  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("keydown", handleWorkflowKeyDown);
  document.addEventListener("pointerdown", handleFocusIntentDuringSend, true);
  document.addEventListener("focusin", handleFocusIntentDuringSend, true);
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
  const loadVersion = ++routeLoadVersion;
  const requestedRoute = state.route;
  const requestedSessionId = state.selection.sessionId;
  state.loading = true;
  state.toast = { tone: "loading", text: "Loading runtime projection" };
  render();
  try {
    const client = runtimeClient();
    if (requestedRoute === "/chat") {
      const [debugIndex, sessions, agentOptions] = await Promise.all([
        client.fetchDebugIndex(requestedSessionId),
        fetchWorkspaceSessions(client),
        loadAgentOptions(client),
      ]);
      if (!isCurrentRouteLoad(loadVersion, requestedRoute, requestedSessionId)) return;
      state.debugIndex = debugIndex;
      state.agentOptions = agentOptions;
      updateWorkspaceSessions(sessions?.sessions ?? [], debugIndex.session, { replace: true });
      state.selectedAgentOptionId = agentOptionIdForSession(debugIndex.session);
      state.selection.timelineId = resolveTimelineId(debugIndex, state.selection.timelineId);

      if (!state.selection.timelineId) {
        state.messages = [];
        state.contextItems = [];
      } else {
        const [messages, contextItems] = await Promise.all([
          client.fetchSessionMessages(requestedSessionId, state.selection.timelineId),
          client.fetchSessionContext(requestedSessionId, state.selection.timelineId),
        ]);
        if (!isCurrentRouteLoad(loadVersion, requestedRoute, requestedSessionId)) return;
        state.messages = messages.messages ?? [];
        state.contextItems = contextItems;
      }
    } else if (requestedRoute === "/debug") {
      const [debugIndex, sessions, agentOptions] = await Promise.all([
        client.fetchDebugIndex(requestedSessionId, {
          traceId: state.selection.traceId,
          messageId: state.selection.messageId,
        }),
        fetchWorkspaceSessions(client),
        loadAgentOptions(client),
      ]);
      if (!isCurrentRouteLoad(loadVersion, requestedRoute, requestedSessionId)) return;
      state.debugIndex = debugIndex;
      state.agentOptions = agentOptions;
      updateWorkspaceSessions(sessions?.sessions ?? [], debugIndex.session, { replace: true });
      state.selectedAgentOptionId = agentOptionIdForSession(debugIndex.session);
      state.messages = state.debugIndex.messages ?? state.messages;
      state.contextItems = contextFromDebug(state.debugIndex);
    } else if (requestedRoute === "/workflow") {
      const [templates, tools] = await Promise.all([
        client.fetchTemplates(),
        fetchWorkflowTools(client),
      ]);
      if (!isCurrentRouteLoad(loadVersion, requestedRoute, requestedSessionId)) return;
      state.workflowTemplates = templates.templates ?? [];
      state.workflowToolCatalog = tools;
      const requestedWorkflowId = workflowIdFromUrl();
      const templateId = requestedWorkflowId ?? state.workflowSelectedTemplateId;
      if (templateId && state.workflowTemplates.some((template) => template.id === templateId)) {
        const template = await client.fetchTemplate(templateId);
        if (!isCurrentRouteLoad(loadVersion, requestedRoute, requestedSessionId)) return;
        loadWorkflowManifest(template.manifest, template.id);
      } else if (state.workflowTemplates.length > 0) {
        const template = await client.fetchTemplate(state.workflowTemplates[0].id);
        if (!isCurrentRouteLoad(loadVersion, requestedRoute, requestedSessionId)) return;
        loadWorkflowManifest(template.manifest, template.id);
      } else if (state.workflowTemplates.length === 0) {
        clearWorkflowDraft();
      }
    }
    state.toast = { tone: "success", text: "Runtime projection ready" };
  } catch (error) {
    if (!isCurrentRouteLoad(loadVersion, requestedRoute, requestedSessionId)) return;
    state.toast = { tone: "error", text: error.message };
  } finally {
    if (loadVersion === routeLoadVersion) {
      state.loading = false;
    }
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
      ${renderSessionMenuOverlay()}
      ${renderTimelineMenuOverlay()}
      ${renderWorkflowMenuOverlay()}
      ${renderMessageMenuOverlay()}
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
  const currentSessionId = state.selection.sessionId;
  const sessions = workspaceSessions(currentSessionId);
  const timelines = currentSessionId ? state.debugIndex?.timelines ?? [demoFixtures.timeline] : [];
  const activeTimelineId = activeTimelineIdForSession(currentSessionId);
  return `
    <aside class="left-rail">
      <div class="rail-head"><h2>Workspace</h2><button data-action="toggle-left" aria-label="Collapse navigation"><</button></div>
      <section>
        <h3>Sessions</h3>
        ${sessions.map((session) => {
          const selected = session.id === currentSessionId;
          const label = displayResourceLabel(session);
          const deleting = state.deletingSessionId === session.id;
          const menuOpen = state.openSessionMenuId === session.id;
          return `
            <div class="session-row ${menuOpen ? "menu-open" : ""}">
              <button data-action="select-session" data-session-id="${escapeAttr(session.id)}" data-testid="session-${escapeAttr(session.id)}" aria-pressed="${selected}" class="nav-item ${selected ? "selected" : ""}" title="${escapeAttr(session.id)}">
                <span data-testid="workspace-item-label">${escapeHtml(label)}</span><small>${escapeHtml(session.status ?? (state.config.mockRuntime ? "mock" : "runtime"))}</small>
              </button>
              <div class="session-menu-host">
                <button data-action="toggle-session-menu" data-menu-session-id="${escapeAttr(session.id)}" class="session-menu-trigger" aria-label="Session actions for ${escapeAttr(label)}" aria-haspopup="menu" aria-expanded="${menuOpen}" title="Session actions" ${deleting || state.renamingSessionId === session.id ? "disabled" : ""}>...</button>
              </div>
            </div>
          `;
        }).join("")}
      </section>
      <section>
        <h3>Timelines</h3>
        ${timelines.map((timeline) => {
          const selected = state.selection.timelineId === timeline.id;
          const current = activeTimelineId === timeline.id;
          const deleting = state.deletingTimelineId === timeline.id;
          const menuOpen = state.openTimelineMenuId === timeline.id;
          const label = displayResourceLabel(timeline);
          return `
            <div class="session-row ${menuOpen ? "menu-open" : ""}">
              <button data-action="select-timeline" data-timeline-id="${escapeAttr(timeline.id)}" data-testid="timeline-${escapeAttr(timeline.id)}" data-current="${current}" aria-pressed="${selected}" class="nav-item ${selected ? "selected" : ""} ${current ? "current" : ""}" title="${escapeAttr(timeline.id)}">
                <span data-testid="workspace-item-label">${escapeHtml(label)}</span><small>${current ? "Current" : escapeHtml(timeline.status ?? "active")}</small>
              </button>
              <div class="session-menu-host">
                <button data-action="toggle-timeline-menu" data-menu-timeline-id="${escapeAttr(timeline.id)}" class="session-menu-trigger" aria-label="Timeline actions for ${escapeAttr(label)}" aria-haspopup="menu" aria-expanded="${menuOpen}" title="Timeline actions" ${deleting || state.renamingTimelineId === timeline.id ? "disabled" : ""}>...</button>
              </div>
            </div>
          `;
        }).join("")}
      </section>
      <button class="secondary full" data-action="create-session" ${state.creatingSession ? "disabled" : ""}>${state.creatingSession ? "Creating" : "New Session"}</button>
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
  const canChat = Boolean(state.selection.sessionId && state.selection.timelineId);
  const session = state.sessions.find((item) => item.id === state.selection.sessionId) ?? state.debugIndex?.session ?? {};
  const agentLabel = sessionAgentLabel(session, state.agentOptions);
  return `
    <section class="chat-workbench" data-testid="chat-workbench">
      <div class="page-head">
        <div><h1 data-testid="main-title">Chat Workbench</h1><p>Session ${escapeHtml(state.selection.sessionId ?? "none")} / ${escapeHtml(state.selection.timelineId ?? "timeline")} / Agent ${escapeHtml(agentLabel)}</p></div>
        <div class="page-actions">
          ${renderAgentSelector()}
          <button class="secondary" data-action="switch-session-agent" ${state.loading || state.switchingAgent || !state.selection.sessionId ? "disabled" : ""}>${state.switchingAgent ? "Switching" : "Apply"}</button>
          <button class="secondary" data-action="refresh-route" ${state.loading ? "disabled" : ""}>Refresh</button>
        </div>
      </div>
      <div class="messages" data-testid="message-list">${state.messages.filter((message) => !isDeletedMessage(message)).map(renderMessage).join("")}</div>
      <form class="composer" data-action="send-chat">
        <textarea data-testid="composer-input" placeholder="Message the agent. Enter sends, Shift+Enter adds a line." rows="1" ${state.sending || !canChat ? "disabled" : ""}>${escapeHtml(state.chatDraft)}</textarea>
        <button data-testid="send-message" type="submit" ${state.sending || !canChat ? "disabled" : ""}>${state.sending ? "Sending" : "Send"}</button>
      </form>
    </section>
  `;
}

function renderAgentSelector() {
  return `
    <select data-action="select-agent-option" aria-label="Agent">
      ${state.agentOptions.map((option) => `<option value="${escapeAttr(option.id)}" ${option.id === state.selectedAgentOptionId ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
    </select>
  `;
}

function renderMessage(message) {
  const selected = state.selection.messageId === message.id;
  const editing = state.editingMessageId === message.id;
  const role = message.role ?? "assistant";
  const traceId = message.trace_id ?? message.traceId;
  const menuOpen = state.openMessageMenuId === message.id;
  const userModified = Boolean(message.user_modified ?? message.userModified ?? message.revision_id ?? message.revisionId);
  return `
    <article class="message-card ${role} ${selected ? "selected" : ""} ${menuOpen ? "menu-open" : ""}" data-action="select-message" data-message-id="${escapeAttr(message.id)}" data-testid="message-${escapeAttr(message.id)}" tabindex="0">
      <button class="message-menu-trigger" data-action="toggle-message-menu" data-menu-message-id="${escapeAttr(message.id)}" aria-label="Message actions for ${escapeAttr(message.id)}" aria-haspopup="menu" aria-expanded="${menuOpen}" title="Message actions" ${state.messageMutationId === message.id ? "disabled" : ""}>...</button>
      <header><strong>${role === "assistant" ? "Assistant" : role === "user" ? "User" : titleCase(role)}</strong><span>${userModified ? "User Modified" : (message.status ?? "completed")}</span></header>
      ${editing ? renderMessageEditor(message) : `<p>${escapeHtml(message.content ?? "")}</p>`}
      ${message.error ? `<p class="message-error">${escapeHtml(message.error)}</p>` : ""}
      ${editing ? "" : renderToolRelations(message)}
      ${!editing && traceId ? `<button class="trace-pill" data-action="open-trace" data-trace-id="${escapeAttr(traceId)}" type="button">Trace ${escapeHtml(traceId)}</button>` : ""}
    </article>
  `;
}

function renderMessageEditor(message) {
  return `
    <div class="message-edit">
      <textarea data-message-edit-input="${escapeAttr(message.id)}" aria-label="Edit message content" rows="4">${escapeHtml(state.editingMessageDraft)}</textarea>
      <div class="message-edit-actions">
        <button class="secondary" data-action="cancel-message-edit" data-edit-message-id="${escapeAttr(message.id)}" type="button">Cancel</button>
        <button data-action="save-message-edit" data-edit-message-id="${escapeAttr(message.id)}" type="button" ${state.messageMutationId === message.id ? "disabled" : ""}>${state.messageMutationId === message.id ? "Saving" : "Save"}</button>
      </div>
    </div>
  `;
}

function renderToolRelations(message) {
  const callIds = message.tool_call_ids ?? message.toolCallIds ?? [];
  const resultIds = message.tool_result_ids ?? message.toolResultIds ?? [];
  if (callIds.length === 0 && resultIds.length === 0) return "";
  return `<div class="tool-strip">${callIds.map((id) => `<span class="tool-call">ToolCall ${escapeHtml(id)}</span>`).join("")}${resultIds.map((id) => `<span class="tool-result">ToolResult ${escapeHtml(id)}</span>`).join("")}</div>`;
}

function renderWorkflow() {
  const selected = state.workflowNodes.find((node) => node.id === state.workflowSelectedNodeId) ?? null;
  const edgeSource = state.workflowEdgeSourceId ?? state.workflowSelectedNodeId ?? "START";
  return `
    <section class="workflow-page">
      <div class="page-head">
        <div><h1 data-testid="main-title">Workflow Builder</h1><p>Workflow manifests from Runtime.</p></div>
        <div class="actions">
          ${state.workflowSelectedTemplateId ? `<div class="session-menu-host workflow-menu-host">
            <button data-action="toggle-workflow-menu" data-menu-workflow-id="${escapeAttr(state.workflowSelectedTemplateId)}" class="secondary session-menu-trigger" aria-label="Workflow actions for ${escapeAttr(state.workflowName)}" aria-haspopup="menu" aria-expanded="${state.openWorkflowMenuId === state.workflowSelectedTemplateId}" title="Workflow actions" ${state.deletingWorkflowId === state.workflowSelectedTemplateId || state.renamingWorkflowId === state.workflowSelectedTemplateId ? "disabled" : ""}>...</button>
          </div>` : ""}
          <button class="secondary" data-action="add-workflow-node">Add Prompt</button>
          <button class="secondary" data-action="validate-workflow" data-testid="workflow-validate" ${state.workflowPreviewing ? "disabled" : ""}>${state.workflowPreviewing ? "Validating" : "Validate"}</button>
          <button class="secondary" data-action="preview-workflow-graph" data-testid="workflow-preview" ${state.workflowPreviewing ? "disabled" : ""}>Preview Graph</button>
          <button class="secondary" data-action="publish-workflow" data-testid="workflow-publish" ${state.workflowPublishing || !state.workflowSelectedTemplateId ? "disabled" : ""}>${state.workflowPublishing ? "Publishing" : "Publish"}</button>
          <button class="secondary" data-action="test-workflow" data-testid="workflow-test" ${state.workflowTesting || !state.workflowPublishedVersion ? "disabled" : ""}>${state.workflowTesting ? "Testing" : "Test"}</button>
          <button class="secondary" data-action="use-workflow-agent" data-testid="workflow-use-agent" ${!state.workflowPublishedVersion ? "disabled" : ""}>Use Agent</button>
          <button data-action="save-workflow" data-testid="workflow-save" ${state.workflowSaving ? "disabled" : ""}>${state.workflowSaving ? "Saving" : "Save"}</button>
        </div>
      </div>
      <div class="workflow-surface" data-testid="workflow-workbench">
        <div class="node-palette">
          <section>
            <h2>Workflows</h2>
            <button data-action="create-workflow" data-testid="workflow-new">+ New Workflow</button>
            <div data-testid="workflow-list">${state.workflowTemplates.map((template) => {
              const selected = state.workflowSelectedTemplateId === template.id;
              const label = displayResourceLabel(template);
              const menuOpen = state.openWorkflowMenuId === template.id;
              const mutating = state.deletingWorkflowId === template.id || state.renamingWorkflowId === template.id;
              return `
                <div class="session-row workflow-row ${menuOpen ? "menu-open" : ""}">
                  <button data-action="open-workflow" data-workflow-id="${escapeAttr(template.id)}" class="nav-item ${selected ? "selected" : ""}" aria-pressed="${selected}" title="${escapeAttr(template.id)}">
                    <span data-testid="workspace-item-label">${escapeHtml(label)}</span><small>${escapeHtml(template.version ?? "workflow")}</small>
                  </button>
                  <div class="session-menu-host workflow-menu-host">
                    <button data-action="toggle-workflow-menu" data-menu-workflow-id="${escapeAttr(template.id)}" class="session-menu-trigger" aria-label="Workflow actions for ${escapeAttr(label)}" aria-haspopup="menu" aria-expanded="${menuOpen}" title="Workflow actions" ${mutating ? "disabled" : ""}>...</button>
                  </div>
                </div>
              `;
            }).join("")}</div>
          </section>
          <section>
            <h2>Node Library</h2>
            ${WORKFLOW_NODE_TYPES.map((type) => `<button data-action="add-workflow-node" data-node-type="${type}">${type.toUpperCase()}</button>`).join("")}
          </section>
        </div>
        <div class="graph-canvas" data-testid="workflow-canvas" data-zoom="${workflowZoomAttr()}">
          ${renderWorkflowCanvasContent()}
          <div class="workflow-zoom-indicator" aria-live="polite">${Math.round(state.workflowCanvasZoom * 100)}%</div>
        </div>
        <div class="node-config">
          <section class="node-config-section basic-info">
            <h2>Basic Info</h2>
            <label class="config-field">Name<input data-testid="workflow-name" value="${escapeAttr(state.workflowName)}" /></label>
            ${selected ? `<div class="node-config-meta"><div><span>ID</span><strong>${escapeHtml(selected.id)}</strong></div><div><span>Type</span><strong>${escapeHtml(selected.type)}</strong></div></div>` : "<p class=\"muted\">Select a node.</p>"}
          </section>
          <section class="node-config-section node-config-fields">
            <h2>Node Config</h2>
            ${renderWorkflowNodeConfig(selected)}
          </section>
          ${selected ? `<section class="node-config-section danger-zone">
            <h2>Danger Zone</h2>
            <button class="danger subtle-danger" data-action="delete-workflow-node" data-testid="workflow-delete-node" data-node-id="${escapeAttr(selected.id)}">Delete Node</button>
          </section>` : ""}
          <section class="node-config-section edge-builder">
            <h2>Edge Builder</h2>
            <label>Source${renderWorkflowEndpointSelect("workflow-edge-source", "select-edge-source", edgeSource, workflowSourceOptions())}</label>
            <label>Target${renderWorkflowEndpointSelect("workflow-edge-target", "select-edge-target", workflowDefaultTarget(edgeSource), workflowTargetOptions())}</label>
            ${renderWorkflowRouteSelect(edgeSource)}
            <button data-action="connect-workflow-edge" data-testid="workflow-connect-edge">Connect</button>
            <div class="edge-list" data-testid="workflow-edge-list">
              ${state.workflowEdges.length === 0 ? "<p>No edges yet.</p>" : state.workflowEdges.map((edge, index) => `
                <div class="workflow-edge ${state.workflowSelectedEdgeIndex === index ? "selected" : ""}" data-testid="workflow-edge">
                  <span>${escapeHtml(edge.from ?? edge.source)} -> ${escapeHtml(edge.to ?? edge.target)}${edge.condition || edge.route ? ` (${escapeHtml(edge.condition ?? edge.route)})` : ""}</span>
                  <button class="secondary" data-action="delete-workflow-edge" data-edge-index="${index}" aria-label="Delete edge ${index + 1}">Delete</button>
                </div>
              `).join("")}
            </div>
          </section>
          <section class="node-config-section graph-preview-section">
            <h2>Graph Preview</h2>
            ${renderWorkflowGraphPreview()}
          </section>
          <section class="node-config-section agent-test-section">
            <h2>Agent Test</h2>
            <label>Input<textarea data-testid="workflow-test-input" rows="3">${escapeHtml(state.workflowTestInput)}</textarea></label>
            ${renderWorkflowTestRun()}
          </section>
        </div>
      </div>
    </section>
  `;
}

function renderWorkflowCanvasContent() {
  const size = workflowCanvasSize();
  const zoom = state.workflowCanvasZoom;
  return `
    <div class="graph-canvas-viewport" style="width:${Math.ceil(size.width * zoom)}px;height:${Math.ceil(size.height * zoom)}px">
      <div class="graph-canvas-content" style="width:${size.width}px;height:${size.height}px;transform:scale(${zoom})">
        ${renderWorkflowEdgesSvg(size)}
        ${state.workflowNodes.map((node) => `
          <div class="graph-node-wrap ${state.workflowSelectedNodeId === node.id ? "selected" : ""} ${state.workflowEdgeSourceId === node.id ? "edge-source" : ""}" style="left:${node.position.x}px;top:${node.position.y}px" data-node-position-x="${node.position.x}" data-node-position-y="${node.position.y}">
            <button data-action="select-workflow-node" data-node-id="${escapeAttr(node.id)}" data-drag-workflow-node-id="${escapeAttr(node.id)}" class="graph-node" title="${escapeAttr(node.id)}">${escapeHtml(node.type)}<small>${escapeHtml(node.id)}</small></button>
            <button class="node-port" data-action="select-edge-source" data-edge-source-id="${escapeAttr(node.id)}" title="Use as edge source" aria-label="Use ${escapeAttr(node.id)} as edge source">+</button>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function renderWorkflowEdgesSvg(size = workflowCanvasSize()) {
  const lines = state.workflowEdges.map((edge, index) => {
    const normalized = normalizeWorkflowEdge(edge);
    const source = workflowEndpointPosition(normalized.source, size);
    const target = workflowEndpointPosition(normalized.target, size);
    const selected = state.workflowSelectedEdgeIndex === index;
    const attrs = `x1="${source.x}" y1="${source.y}" x2="${target.x}" y2="${target.y}"`;
    return `
      <line class="workflow-edge-line ${selected ? "selected" : ""}" ${attrs} />
      <polygon class="workflow-edge-hit ${selected ? "selected" : ""}" points="${workflowEdgeHitPoints(source, target)}" data-action="select-workflow-edge" data-edge-index="${index}" data-edge-source="${escapeAttr(normalized.source)}" data-edge-target="${escapeAttr(normalized.target)}" data-testid="workflow-edge-hit" />
    `;
  }).join("");
  return `
    <svg class="workflow-edges" width="${size.width}" height="${size.height}" aria-label="Workflow edges">
      <defs>
        <marker id="workflow-edge-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L0,6 L9,3 z" fill="#64748b"></path>
        </marker>
      </defs>
      ${lines}
    </svg>
    <span class="workflow-boundary workflow-boundary-start">START</span>
    <span class="workflow-boundary workflow-boundary-end">END</span>
  `;
}

function renderWorkflowEndpointSelect(id, action, value, options) {
  return `
    <select id="${escapeAttr(id)}" data-action="${escapeAttr(action)}" value="${escapeAttr(value)}">
      ${options.map((option) => `<option value="${escapeAttr(option.id)}" ${option.id === value ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
    </select>
  `;
}

function renderWorkflowRouteSelect(sourceId) {
  const sourceNode = state.workflowNodes.find((node) => node.id === sourceId);
  if (sourceNode?.type !== "condition") return "";
  return `
    <label>Route
      <select id="workflow-edge-route" data-testid="workflow-edge-route">
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    </label>
  `;
}

function renderWorkflowNodeConfig(node) {
  if (!node) return "";
  const fields = WORKFLOW_CONFIG_FIELDS[node.type] ?? [];
  if (!fields.length) return `<p class="muted">No configurable fields.</p>`;
  return fields.map((path) => renderWorkflowConfigField(node, path)).join("");
}

function renderWorkflowConfigField(node, path) {
  const value = workflowConfigInputValue(node.config?.[path], path);
  if (node.type === "tool" && path === "tool_name" && state.workflowToolCatalog.length) {
    return `
      <label class="config-field">${workflowConfigLabel(path)}
        <select data-workflow-config-path="${escapeAttr(path)}" data-testid="workflow-config-${escapeAttr(path)}">
          <option value="">Select tool</option>
          ${state.workflowToolCatalog.map((tool) => `<option value="${escapeAttr(tool.id)}" ${tool.id === value ? "selected" : ""}>${escapeHtml(tool.name || tool.id)}</option>`).join("")}
        </select>
      </label>
      ${renderSelectedToolMetadata(value)}
    `;
  }
  if (path === "operator") {
    const operators = ["eq", "ne", "gt", "gte", "lt", "lte", "contains", "exists", "is_empty", "is_true", "is_false"];
    return `
      <label class="config-field">${workflowConfigLabel(path)}
        <select data-workflow-config-path="${escapeAttr(path)}" data-testid="workflow-config-${escapeAttr(path)}">
          <option value="">Select operator</option>
          ${operators.map((operator) => `<option value="${operator}" ${operator === value ? "selected" : ""}>${operator}</option>`).join("")}
        </select>
      </label>
    `;
  }
  const multiline = WORKFLOW_JSON_CONFIG_FIELDS.has(path) || path === "template" || path === "prompt" || path === "system_prompt";
  if (multiline) {
    return `<label class="config-field config-field-wide">${workflowConfigLabel(path)}<textarea data-workflow-config-path="${escapeAttr(path)}" data-testid="workflow-config-${escapeAttr(path)}" rows="3">${escapeHtml(value)}</textarea></label>`;
  }
  const type = WORKFLOW_NUMBER_CONFIG_FIELDS.has(path) ? "number" : "text";
  const step = path === "temperature" ? ` step="0.1" min="0" max="2"` : "";
  return `<label class="config-field">${workflowConfigLabel(path)}<input type="${type}"${step} data-workflow-config-path="${escapeAttr(path)}" data-testid="workflow-config-${escapeAttr(path)}" value="${escapeAttr(value)}" /></label>`;
}

function renderSelectedToolMetadata(toolId) {
  const tool = state.workflowToolCatalog.find((item) => item.id === toolId);
  if (!tool) return "";
  return `
    <div class="tool-metadata" data-testid="workflow-tool-metadata">
      <strong>${escapeHtml(tool.name || tool.id)}</strong>
      ${tool.description ? `<p>${escapeHtml(tool.description)}</p>` : ""}
      <small>Input ${escapeHtml(JSON.stringify(tool.input_schema ?? {}))}</small>
      <small>Output ${escapeHtml(JSON.stringify(tool.output_schema ?? {}))}</small>
    </div>
  `;
}

function renderWorkflowTestRun() {
  const run = state.workflowTestRun;
  if (!run) return `<p class="muted">Publish the workflow, then run a test message.</p>`;
  const events = state.workflowRuntimeEvents ?? [];
  return `
    <div class="graph-preview" data-testid="workflow-test-run">
      <dl>
        <dt>Status</dt><dd>${escapeHtml(run.status ?? "unknown")}</dd>
        <dt>Output</dt><dd>${escapeHtml(formatWorkflowValue(run.output ?? ""))}</dd>
      </dl>
      <div class="trace-list" data-testid="workflow-test-trace">
        ${events.length ? events.map((event) => `<div class="trace-row"><strong>${escapeHtml(event.type)}</strong><small>${escapeHtml(workflowEventSummary(event))}</small></div>`).join("") : "<p>No trace events.</p>"}
      </div>
    </div>
  `;
}

function renderWorkflowGraphPreview() {
  const preview = state.workflowGraphPreview;
  if (!preview) {
    return `<p class="muted">Preview uses the backend manifest compiler to show the runnable graph.</p>`;
  }
  if (!preview.valid) {
    const error = preview.error ?? {};
    return `<div class="graph-preview error"><strong>Invalid graph</strong><p>${escapeHtml(error.message ?? "Graph validation failed")}</p>${error.field_path ? `<small>${escapeHtml(error.field_path)}</small>` : ""}</div>`;
  }
  const nodes = preview.nodes ?? [];
  const edges = preview.edges ?? [];
  return `
    <div class="graph-preview" data-testid="workflow-graph-preview">
      <pre>${escapeHtml(workflowTopologyText(preview))}</pre>
      <dl>
        <dt>Nodes</dt><dd>${nodes.length ? nodes.map((node) => escapeHtml(node.id)).join(", ") : "None"}</dd>
        <dt>Edges</dt><dd>${edges.length ? edges.map((edge) => `${escapeHtml(edge.source)} -> ${escapeHtml(edge.target)}${edge.route ? ` (${escapeHtml(edge.route)})` : ""}`).join("<br>") : "None"}</dd>
        <dt>Execution order</dt><dd>${(preview.execution_order ?? []).length ? preview.execution_order.map(escapeHtml).join(" -> ") : "No executable nodes"}</dd>
      </dl>
    </div>
  `;
}

function workflowSourceOptions() {
  return [{ id: "START", label: "START" }, ...state.workflowNodes.map((node) => ({ id: node.id, label: node.id }))];
}

function workflowTargetOptions() {
  return [...state.workflowNodes.map((node) => ({ id: node.id, label: node.id })), { id: "END", label: "END" }];
}

function workflowDefaultTarget(sourceId) {
  const firstNonSource = state.workflowNodes.find((node) => node.id !== sourceId)?.id;
  if (sourceId === "START") return state.workflowNodes[0]?.id ?? "END";
  return firstNonSource ?? "END";
}

function workflowCanvasSize() {
  const maxX = Math.max(900, ...state.workflowNodes.map((node) => (node.position?.x ?? 0) + 180));
  const maxY = Math.max(520, ...state.workflowNodes.map((node) => (node.position?.y ?? 0) + 120));
  return { width: maxX, height: maxY };
}

function workflowEndpointPosition(id, size = workflowCanvasSize()) {
  if (id === "START") return { x: 40, y: 34 };
  if (id === "END") return { x: size.width - 48, y: size.height - 34 };
  const node = state.workflowNodes.find((item) => item.id === id);
  if (!node) return { x: 40, y: 34 };
  return { x: (node.position?.x ?? 0) + 56, y: (node.position?.y ?? 0) + 28 };
}

function workflowEdgeHitPoints(source, target) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.hypot(dx, dy) || 1;
  const halfWidth = 7;
  const offsetX = (-dy / length) * halfWidth;
  const offsetY = (dx / length) * halfWidth;
  return [
    `${source.x + offsetX},${source.y + offsetY}`,
    `${target.x + offsetX},${target.y + offsetY}`,
    `${target.x - offsetX},${target.y - offsetY}`,
    `${source.x - offsetX},${source.y - offsetY}`,
  ].join(" ");
}

function normalizeWorkflowEdge(edge) {
  return {
    source: edge.source ?? edge.from,
    target: edge.target ?? edge.to,
    route: edge.route ?? edge.condition ?? null,
  };
}

function workflowTopologyText(preview) {
  const order = preview.execution_order ?? [];
  if (order.length) return ["START", ...order, "END"].join("\n↓\n");
  const edges = preview.edges ?? [];
  if (edges.length) return edges.map((edge) => `${edge.source} -> ${edge.target}${edge.route ? ` (${edge.route})` : ""}`).join("\n");
  return "START\n↓\nEND";
}

function workflowConfigLabel(path) {
  return path.split("_").map(titleCase).join(" ");
}

function workflowConfigInputValue(value, path) {
  if (value === undefined || value === null) return "";
  if (WORKFLOW_JSON_CONFIG_FIELDS.has(path)) return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return String(value);
}

function parseWorkflowConfigValue(path, rawValue) {
  if (WORKFLOW_JSON_CONFIG_FIELDS.has(path)) {
    const trimmed = rawValue.trim();
    if (!trimmed) return {};
    try {
      return JSON.parse(trimmed);
    } catch {
      return rawValue;
    }
  }
  if (WORKFLOW_NUMBER_CONFIG_FIELDS.has(path)) {
    return rawValue === "" ? undefined : Number(rawValue);
  }
  return rawValue;
}

function formatWorkflowValue(value) {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function workflowEventSummary(event) {
  const data = event.data ?? {};
  const node = data.node_id ? `node=${data.node_id}` : "";
  const route = data.route ? `route=${data.route}` : "";
  const tool = data.tool_name ? `tool=${data.tool_name}` : "";
  const output = data.output !== undefined ? `output=${formatWorkflowValue(data.output)}` : "";
  return [node, route, tool, output].filter(Boolean).join(" ");
}

function renderTemplate() {
  const manifest = demoTemplateManifest;
  const sections = {
    basic: [["ID", manifest.template.id], ["Name", manifest.template.name], ["Version", manifest.template.version]],
    model: [["Model", (manifest.runtime?.nodes ?? manifest.graph?.nodes ?? []).find((node) => node.type === "llm" || node.type === "agent")?.config?.model ?? ""]],
    prompt: [["Prompt", (manifest.runtime?.nodes ?? manifest.graph?.nodes ?? []).find((node) => node.type === "llm" || node.type === "agent")?.config?.prompt ?? ""]],
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

function renderSessionMenuOverlay() {
  if (!state.openSessionMenuId || !state.sessionMenuPosition) return "";
  return `
    <div class="session-menu" data-testid="session-menu-${escapeAttr(state.openSessionMenuId)}" role="menu" style="left:${state.sessionMenuPosition.left}px;top:${state.sessionMenuPosition.top}px">
      <button class="danger" data-action="delete-session" data-delete-session-id="${escapeAttr(state.openSessionMenuId)}" role="menuitem">Delete</button>
      <button data-action="rename-session" data-rename-session-id="${escapeAttr(state.openSessionMenuId)}" role="menuitem">Rename</button>
    </div>
  `;
}

function renderTimelineMenuOverlay() {
  if (!state.openTimelineMenuId || !state.timelineMenuPosition) return "";
  return `
    <div class="session-menu" data-testid="timeline-menu-${escapeAttr(state.openTimelineMenuId)}" role="menu" style="left:${state.timelineMenuPosition.left}px;top:${state.timelineMenuPosition.top}px">
      <button class="danger" data-action="delete-timeline" data-delete-timeline-id="${escapeAttr(state.openTimelineMenuId)}" role="menuitem">Delete</button>
      <button data-action="rename-timeline" data-rename-timeline-id="${escapeAttr(state.openTimelineMenuId)}" role="menuitem">Rename</button>
    </div>
  `;
}

function renderWorkflowMenuOverlay() {
  if (!state.openWorkflowMenuId || !state.workflowMenuPosition) return "";
  return `
    <div class="session-menu" data-testid="workflow-menu-${escapeAttr(state.openWorkflowMenuId)}" role="menu" style="left:${state.workflowMenuPosition.left}px;top:${state.workflowMenuPosition.top}px">
      <button class="danger" data-action="delete-workflow" data-delete-workflow-id="${escapeAttr(state.openWorkflowMenuId)}" role="menuitem">Delete</button>
      <button data-action="rename-workflow" data-rename-workflow-id="${escapeAttr(state.openWorkflowMenuId)}" role="menuitem">Rename</button>
    </div>
  `;
}

function renderMessageMenuOverlay() {
  if (!state.openMessageMenuId || !state.messageMenuPosition) return "";
  return `
    <div class="message-menu" data-testid="message-menu-${escapeAttr(state.openMessageMenuId)}" role="menu" style="left:${state.messageMenuPosition.left}px;top:${state.messageMenuPosition.top}px">
      <button data-action="start-message-edit" data-edit-message-id="${escapeAttr(state.openMessageMenuId)}" role="menuitem">Edit</button>
      <button data-action="delete-message" data-delete-message-id="${escapeAttr(state.openMessageMenuId)}" class="danger" role="menuitem">Delete</button>
    </div>
  `;
}

function bindEvents() {
  document.querySelectorAll("[data-action]").forEach((element) => {
    if (element.tagName !== "SELECT") element.addEventListener("click", handleAction);
  });
  document.querySelectorAll("[data-drag-workflow-node-id]").forEach((element) => element.addEventListener("pointerdown", handleWorkflowNodePointerDown));
  const workflowCanvas = document.querySelector("[data-testid='workflow-canvas']");
  workflowCanvas?.addEventListener("wheel", handleWorkflowCanvasWheel, { passive: false });
  workflowCanvas?.addEventListener("pointerdown", handleWorkflowCanvasPointerDown);
  workflowCanvas?.addEventListener("contextmenu", handleWorkflowCanvasContextMenu);
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
  const agentSelector = document.querySelector("[data-action='select-agent-option']");
  agentSelector?.addEventListener("change", () => {
    state.selectedAgentOptionId = agentSelector.value;
  });
  document.querySelectorAll("[data-message-edit-input]").forEach((element) => {
    element.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    element.addEventListener("input", () => {
      if (state.editingMessageId === element.dataset.messageEditInput) {
        state.editingMessageDraft = element.value;
      }
    });
    element.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        state.editingMessageId = null;
        state.editingMessageDraft = "";
        render();
      }
    });
  });
  const workflowName = document.querySelector("[data-testid='workflow-name']");
  workflowName?.addEventListener("input", () => {
    state.workflowName = workflowName.value;
    state.workflowDirty = true;
    state.workflowGraphPreview = null;
  });
  document.querySelectorAll("[data-workflow-config-path]").forEach((element) => {
    const update = () => {
      updateSelectedWorkflowConfig(element.dataset.workflowConfigPath, element.value);
    };
    element.addEventListener("input", update);
    element.addEventListener("change", update);
  });
  const workflowTestInput = document.querySelector("[data-testid='workflow-test-input']");
  workflowTestInput?.addEventListener("input", () => {
    state.workflowTestInput = workflowTestInput.value;
  });
  const workflowEdgeSource = document.querySelector("#workflow-edge-source");
  workflowEdgeSource?.addEventListener("change", () => {
    state.workflowEdgeSourceId = workflowEdgeSource.value;
    render();
  });
}

function handleDocumentClick(event) {
  let changed = false;
  if (state.openSessionMenuId && !event.target.closest?.(".session-menu-host, .session-menu")) {
    state.openSessionMenuId = null;
    state.sessionMenuPosition = null;
    changed = true;
  }
  if (state.openTimelineMenuId && !event.target.closest?.(".session-menu-host, .session-menu")) {
    state.openTimelineMenuId = null;
    state.timelineMenuPosition = null;
    changed = true;
  }
  if (state.openWorkflowMenuId && !event.target.closest?.(".workflow-menu-host, .session-menu")) {
    state.openWorkflowMenuId = null;
    state.workflowMenuPosition = null;
    changed = true;
  }
  if (state.openMessageMenuId && !event.target.closest?.(".message-menu-trigger, .message-menu")) {
    state.openMessageMenuId = null;
    state.messageMenuPosition = null;
    changed = true;
  }
  if (changed) render();
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
    state.openSessionMenuId = null;
    state.sessionMenuPosition = null;
    state.openTimelineMenuId = null;
    state.timelineMenuPosition = null;
    state.selection.messageId = null;
    state.selection.traceId = null;
    const sessionId = target.dataset.sessionId;
    const timelineId = timelineIdForSession(sessionId);
    const query = new URLSearchParams({ sessionId });
    if (timelineId) query.set("timelineId", timelineId);
    await navigate(`${state.route}?${query}`);
  } else if (action === "select-timeline") {
    const timelineId = target.dataset.timelineId;
    if (!timelineId || !state.selection.sessionId) return;
    state.openTimelineMenuId = null;
    state.timelineMenuPosition = null;
    state.selection.messageId = null;
    state.selection.traceId = null;
    const client = runtimeClient();
    state.toast = { tone: "loading", text: `Activating timeline ${timelineId}` };
    render();
    try {
      await client.activateTimeline(timelineId);
      const query = new URLSearchParams({ sessionId: state.selection.sessionId, timelineId });
      await navigate(`${state.route}?${query}`);
      state.toast = { tone: "success", text: `Timeline ${timelineId} selected` };
      render();
    } catch (error) {
      state.toast = { tone: "error", text: error.message };
      render();
    }
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
  } else if (action === "create-session") {
    if (state.creatingSession) return;
    state.creatingSession = true;
    state.toast = { tone: "loading", text: "Creating session" };
    render();
    try {
      const session = await createSessionWithSelectedAgent(runtimeClient(), {
        workspaceId: "studio",
        defaultAgentTemplateId: "research-agent",
        selectedAgent: selectedAgentOption(),
      });
      updateWorkspaceSessions([session]);
      const timelineId = session.current_timeline_id ?? session.currentTimelineId ?? DEFAULT_TIMELINE_ID;
      await navigate(`/chat?sessionId=${encodeURIComponent(session.id)}&timelineId=${encodeURIComponent(timelineId)}`);
      state.toast = { tone: "success", text: "Session created" };
      render();
    } catch (error) {
      markStreamingMessageFailed(error);
      state.toast = { tone: "error", text: error.message };
      render();
    } finally {
      state.creatingSession = false;
      render();
    }
  } else if (action === "switch-session-agent") {
    if (state.switchingAgent || !state.selection.sessionId) return;
    state.switchingAgent = true;
    state.toast = { tone: "loading", text: "Switching session agent" };
    render();
    try {
      const updated = await switchSessionAgent(runtimeClient(), {
        sessionId: state.selection.sessionId,
        selectedAgent: selectedAgentOption(),
      });
      updateWorkspaceSessions([updated]);
      if (state.debugIndex?.session?.id === updated.id) {
        state.debugIndex = { ...state.debugIndex, session: updated };
      }
      state.toast = { tone: "success", text: "Agent switched" };
      render();
    } catch (error) {
      state.toast = { tone: "error", text: error.message };
      render();
    } finally {
      state.switchingAgent = false;
      render();
    }
  } else if (action === "toggle-session-menu") {
    event.stopPropagation();
    const sessionId = target.dataset.menuSessionId;
    state.openTimelineMenuId = null;
    state.timelineMenuPosition = null;
    state.openWorkflowMenuId = null;
    state.workflowMenuPosition = null;
    state.openMessageMenuId = null;
    state.messageMenuPosition = null;
    if (state.openSessionMenuId === sessionId) {
      state.openSessionMenuId = null;
      state.sessionMenuPosition = null;
    } else {
      state.openSessionMenuId = sessionId;
      state.sessionMenuPosition = sessionMenuPosition(target.getBoundingClientRect());
    }
    render();
  } else if (action === "toggle-timeline-menu") {
    event.stopPropagation();
    const timelineId = target.dataset.menuTimelineId;
    state.openSessionMenuId = null;
    state.sessionMenuPosition = null;
    state.openWorkflowMenuId = null;
    state.workflowMenuPosition = null;
    state.openMessageMenuId = null;
    state.messageMenuPosition = null;
    if (state.openTimelineMenuId === timelineId) {
      state.openTimelineMenuId = null;
      state.timelineMenuPosition = null;
    } else {
      state.openTimelineMenuId = timelineId;
      state.timelineMenuPosition = sessionMenuPosition(target.getBoundingClientRect());
    }
    render();
  } else if (action === "toggle-workflow-menu") {
    event.stopPropagation();
    const workflowId = target.dataset.menuWorkflowId;
    state.openSessionMenuId = null;
    state.sessionMenuPosition = null;
    state.openTimelineMenuId = null;
    state.timelineMenuPosition = null;
    state.openMessageMenuId = null;
    state.messageMenuPosition = null;
    if (state.openWorkflowMenuId === workflowId) {
      state.openWorkflowMenuId = null;
      state.workflowMenuPosition = null;
    } else {
      state.openWorkflowMenuId = workflowId;
      state.workflowMenuPosition = sessionMenuPosition(target.getBoundingClientRect());
    }
    render();
  } else if (action === "delete-session") {
    event.stopPropagation();
    const sessionId = target.dataset.deleteSessionId;
    if (!sessionId || state.deletingSessionId) return;
    const session = state.sessions.find((item) => item.id === sessionId);
    const label = displayResourceLabel(session ?? { id: sessionId });
    state.openSessionMenuId = null;
    state.sessionMenuPosition = null;
    if (!window.confirm(`Delete session ${label}?`)) {
      render();
      return;
    }
    const beforeSessions = workspaceSessions(state.selection.sessionId ?? DEFAULT_SESSION_ID);
    state.deletingSessionId = sessionId;
    state.toast = { tone: "loading", text: "Deleting session" };
    render();
    try {
      await runtimeClient().deleteSession(sessionId);
      state.sessions = state.sessions.filter((item) => item.id !== sessionId);
      if (state.selection.sessionId === sessionId) {
        const nextSession = nextSessionAfterDelete(beforeSessions, sessionId);
        state.selection.messageId = null;
        state.selection.traceId = null;
        state.debugIndex = null;
        state.contextItems = [];
        if (nextSession) {
          const timelineId = nextSession.current_timeline_id ?? nextSession.currentTimelineId ?? DEFAULT_TIMELINE_ID;
          await navigate(`/chat?sessionId=${encodeURIComponent(nextSession.id)}&timelineId=${encodeURIComponent(timelineId)}`);
        } else {
          state.selection.sessionId = null;
          state.selection.timelineId = null;
          state.messages = [];
          history.pushState({}, "", state.route);
        }
      }
      state.toast = { tone: "success", text: "Session deleted" };
      render();
    } catch (error) {
      state.toast = { tone: "error", text: error.message };
      render();
    } finally {
      state.deletingSessionId = null;
      render();
    }
  } else if (action === "rename-session") {
    event.stopPropagation();
    const sessionId = target.dataset.renameSessionId;
    if (!sessionId || state.renamingSessionId) return;
    const session = state.sessions.find((item) => item.id === sessionId);
    const label = displayResourceLabel(session ?? { id: sessionId });
    state.openSessionMenuId = null;
    state.sessionMenuPosition = null;
    const title = window.prompt(`Rename session ${label}`, label)?.trim();
    if (title === undefined) {
      render();
      return;
    }
    if (!title) {
      state.toast = { tone: "warning", text: "Name is required" };
      render();
      return;
    }
    state.renamingSessionId = sessionId;
    state.toast = { tone: "loading", text: "Renaming session" };
    render();
    try {
      const updated = await runtimeClient().patchSession(sessionId, title);
      updateWorkspaceSessions([updated]);
      if (state.debugIndex?.session?.id === sessionId) {
        state.debugIndex = { ...state.debugIndex, session: updated };
      }
      state.toast = { tone: "success", text: "Session renamed" };
      render();
    } catch (error) {
      state.toast = { tone: "error", text: error.message };
      render();
    } finally {
      state.renamingSessionId = null;
      render();
    }
  } else if (action === "delete-timeline") {
    event.stopPropagation();
    const timelineId = target.dataset.deleteTimelineId;
    if (!timelineId || state.deletingTimelineId) return;
    const timeline = (state.debugIndex?.timelines ?? []).find((item) => item.id === timelineId);
    const label = displayResourceLabel(timeline ?? { id: timelineId });
    const sessionId = state.selection.sessionId;
    state.openTimelineMenuId = null;
    state.timelineMenuPosition = null;
    if (!window.confirm(`Delete timeline ${label}?`)) {
      render();
      return;
    }
    state.deletingTimelineId = timelineId;
    state.toast = { tone: "loading", text: "Deleting timeline" };
    render();
    try {
      const response = await runtimeClient().deleteTimeline(timelineId);
      const nextTimelineId = response.current_timeline_id ?? response.currentTimelineId ?? null;
      state.selection.messageId = null;
      state.selection.traceId = null;
      if (sessionId) {
        const query = new URLSearchParams({ sessionId });
        if (nextTimelineId) {
          query.set("timelineId", nextTimelineId);
          await navigate(`/chat?${query}`);
        } else {
          state.selection.timelineId = null;
          state.messages = [];
          state.contextItems = [];
          state.debugIndex = null;
          history.pushState({}, "", `/chat?${query}`);
          await loadRouteData();
        }
      }
      state.toast = { tone: "success", text: "Timeline deleted" };
      render();
    } catch (error) {
      state.toast = { tone: "error", text: error.message };
      render();
    } finally {
      state.deletingTimelineId = null;
      render();
    }
  } else if (action === "rename-timeline") {
    event.stopPropagation();
    const timelineId = target.dataset.renameTimelineId;
    if (!timelineId || state.renamingTimelineId) return;
    const timeline = (state.debugIndex?.timelines ?? []).find((item) => item.id === timelineId);
    const label = displayResourceLabel(timeline ?? { id: timelineId });
    state.openTimelineMenuId = null;
    state.timelineMenuPosition = null;
    const title = window.prompt(`Rename timeline ${label}`, label)?.trim();
    if (title === undefined) {
      render();
      return;
    }
    if (!title) {
      state.toast = { tone: "warning", text: "Name is required" };
      render();
      return;
    }
    state.renamingTimelineId = timelineId;
    state.toast = { tone: "loading", text: "Renaming timeline" };
    render();
    try {
      const updated = await runtimeClient().patchTimeline(timelineId, title);
      if (state.debugIndex?.timelines) {
        state.debugIndex = {
          ...state.debugIndex,
          timelines: state.debugIndex.timelines.map((item) => (item.id === timelineId ? updated : item)),
        };
      }
      state.toast = { tone: "success", text: "Timeline renamed" };
      render();
    } catch (error) {
      state.toast = { tone: "error", text: error.message };
      render();
    } finally {
      state.renamingTimelineId = null;
      render();
    }
  } else if (action === "toggle-message-menu") {
    event.stopPropagation();
    const messageId = target.dataset.menuMessageId;
    state.openSessionMenuId = null;
    state.sessionMenuPosition = null;
    state.openTimelineMenuId = null;
    state.timelineMenuPosition = null;
    state.openWorkflowMenuId = null;
    state.workflowMenuPosition = null;
    if (state.openMessageMenuId === messageId) {
      state.openMessageMenuId = null;
      state.messageMenuPosition = null;
    } else {
      state.openMessageMenuId = messageId;
      state.messageMenuPosition = sessionMenuPosition(target.getBoundingClientRect(), 124);
    }
    render();
  } else if (action === "start-message-edit") {
    event.stopPropagation();
    const messageId = target.dataset.editMessageId;
    const message = state.messages.find((item) => item.id === messageId);
    state.openMessageMenuId = null;
    state.messageMenuPosition = null;
    if (message) {
      state.editingMessageId = message.id;
      state.editingMessageDraft = message.content ?? "";
      state.selection.messageId = message.id;
    }
    render();
  } else if (action === "cancel-message-edit") {
    event.stopPropagation();
    state.editingMessageId = null;
    state.editingMessageDraft = "";
    render();
  } else if (action === "save-message-edit") {
    event.stopPropagation();
    const messageId = target.dataset.editMessageId;
    if (!messageId || state.messageMutationId) return;
    state.messageMutationId = messageId;
    state.toast = { tone: "loading", text: "Saving message" };
    render();
    let regenerated = false;
    try {
      const client = runtimeClient();
      const originalMessage = state.messages.find((message) => message.id === messageId);
      const draft = state.editingMessageDraft;
      const response = await client.patchMessage(messageId, draft, {
        semantic: shouldForkForMessageEdit(originalMessage),
      });
      state.editingMessageId = null;
      state.editingMessageDraft = "";
      if (response.timeline?.id && state.selection.sessionId) {
        state.selection.messageId = response.message?.id ?? null;
        await navigate(`/chat?sessionId=${encodeURIComponent(state.selection.sessionId)}&timelineId=${encodeURIComponent(response.timeline.id)}`);
        state.sending = true;
        state.shouldRefocusComposer = true;
        state.suppressComposerRefocus = false;
        state.toast = { tone: "loading", text: "Regenerating assistant reply" };
        render();
        await streamAssistantReply(client);
        await refreshCurrentContext(client);
        regenerated = true;
      } else {
        updateMessage(response.message ?? {
          ...originalMessage,
          content: draft,
          revision_id: response.revision_id,
          user_modified: true,
        });
      }
      state.toast = { tone: "success", text: "Message saved" };
      render();
    } catch (error) {
      state.toast = { tone: "error", text: error.message };
      render();
    } finally {
      state.messageMutationId = null;
      state.sending = false;
      render();
      if (regenerated) {
        refocusComposerAfterAgentTurn();
      } else if (state.shouldRefocusComposer) {
        state.shouldRefocusComposer = false;
      }
    }
  } else if (action === "delete-message") {
    event.stopPropagation();
    const messageId = target.dataset.deleteMessageId;
    if (!messageId || state.messageMutationId) return;
    state.openMessageMenuId = null;
    state.messageMenuPosition = null;
    if (!window.confirm("Delete this message from the chat view?")) {
      render();
      return;
    }
    state.messageMutationId = messageId;
    state.toast = { tone: "loading", text: "Deleting message" };
    render();
    try {
      const client = runtimeClient();
      const response = await client.deleteMessage(messageId);
      const deletedIds = new Set(response.message_ids ?? response.messageIds ?? [messageId]);
      state.messages = state.messages.filter((message) => !deletedIds.has(message.id));
      if (deletedIds.has(state.selection.messageId)) {
        state.selection.messageId = null;
        state.selection.traceId = null;
      }
      await refreshCurrentContext(client);
      state.toast = { tone: "success", text: "Message deleted" };
      render();
    } catch (error) {
      state.toast = { tone: "error", text: error.message };
      render();
    } finally {
      state.messageMutationId = null;
      render();
    }
  } else if (action === "add-workflow-node") {
    addWorkflowNode(target.dataset.nodeType ?? "prompt");
    render();
  } else if (action === "select-edge-source") {
    state.workflowEdgeSourceId = target.dataset.edgeSourceId ?? target.value ?? null;
    render();
  } else if (action === "connect-workflow-edge") {
    connectWorkflowEdge();
    render();
  } else if (action === "delete-workflow-edge") {
    deleteWorkflowEdge(Number(target.dataset.edgeIndex));
    render();
  } else if (action === "delete-workflow-node") {
    deleteWorkflowNode(target.dataset.nodeId);
    render();
  } else if (action === "select-workflow-edge") {
    event.stopPropagation();
    selectWorkflowEdge(Number(target.dataset.edgeIndex));
    render();
  } else if (action === "preview-workflow-graph") {
    await previewWorkflowGraph();
  } else if (action === "validate-workflow") {
    await validateWorkflowDraft();
  } else if (action === "publish-workflow") {
    await publishWorkflow();
  } else if (action === "test-workflow") {
    await testWorkflowAgent();
  } else if (action === "use-workflow-agent") {
    await useWorkflowAgent();
  } else if (action === "create-workflow") {
    createWorkflowDraft();
    render();
  } else if (action === "open-workflow") {
    await openWorkflow(target.dataset.workflowId);
  } else if (action === "rename-workflow") {
    await renameWorkflow(target.dataset.renameWorkflowId);
  } else if (action === "delete-workflow") {
    await deleteWorkflow(target.dataset.deleteWorkflowId);
  } else if (action === "save-workflow") {
    await saveWorkflow();
  } else if (action === "select-workflow-node") {
    state.workflowSelectedNodeId = target.dataset.nodeId;
    state.workflowSelectedEdgeIndex = null;
    render();
  } else if (action === "not-implemented") {
    state.toast = { tone: "warning", text: "Not implemented in the current HTTP Runtime" };
    render();
  }
}

function handleWorkflowNodePointerDown(event) {
  if (event.button !== 0) return;
  const nodeId = event.currentTarget.dataset.dragWorkflowNodeId;
  const node = state.workflowNodes.find((item) => item.id === nodeId);
  const content = event.currentTarget.closest(".graph-canvas-content");
  if (!node || !content) return;
  const rect = content.getBoundingClientRect();
  const zoom = state.workflowCanvasZoom;
  state.workflowSelectedNodeId = node.id;
  state.workflowSelectedEdgeIndex = null;
  state.workflowDrag = {
    nodeId: node.id,
    offsetX: (event.clientX - rect.left) / zoom - node.position.x,
    offsetY: (event.clientY - rect.top) / zoom - node.position.y,
  };
  event.preventDefault();
  document.addEventListener("pointermove", handleWorkflowNodePointerMove);
  document.addEventListener("pointerup", handleWorkflowNodePointerUp, { once: true });
  render();
}

function handleWorkflowNodePointerMove(event) {
  if (!state.workflowDrag) return;
  const content = document.querySelector(".graph-canvas-content");
  const node = state.workflowNodes.find((item) => item.id === state.workflowDrag.nodeId);
  if (!content || !node) return;
  const rect = content.getBoundingClientRect();
  const zoom = state.workflowCanvasZoom;
  node.position = {
    x: Math.max(0, Math.round((event.clientX - rect.left) / zoom - state.workflowDrag.offsetX)),
    y: Math.max(0, Math.round((event.clientY - rect.top) / zoom - state.workflowDrag.offsetY)),
  };
  state.workflowDirty = true;
  state.workflowGraphPreview = null;
  render();
}

function handleWorkflowNodePointerUp() {
  state.workflowDrag = null;
  document.removeEventListener("pointermove", handleWorkflowNodePointerMove);
}

function handleWorkflowCanvasPointerDown(event) {
  if (event.button !== 2 || workflowInteractivePanTarget(event.target)) return;
  event.preventDefault();
  state.workflowCanvasPan = {
    canvas: event.currentTarget,
    startX: event.clientX,
    startY: event.clientY,
    scrollLeft: event.currentTarget.scrollLeft,
    scrollTop: event.currentTarget.scrollTop,
  };
  document.addEventListener("pointermove", handleWorkflowCanvasPointerMove);
  document.addEventListener("pointerup", handleWorkflowCanvasPointerUp);
  document.addEventListener("pointercancel", handleWorkflowCanvasPointerUp);
}

function handleWorkflowCanvasPointerMove(event) {
  const pan = state.workflowCanvasPan;
  if (!pan) return;
  event.preventDefault();
  pan.canvas.scrollLeft = Math.max(0, Math.round(pan.scrollLeft - (event.clientX - pan.startX)));
  pan.canvas.scrollTop = Math.max(0, Math.round(pan.scrollTop - (event.clientY - pan.startY)));
}

function handleWorkflowCanvasPointerUp() {
  state.workflowCanvasPan = null;
  document.removeEventListener("pointermove", handleWorkflowCanvasPointerMove);
  document.removeEventListener("pointerup", handleWorkflowCanvasPointerUp);
  document.removeEventListener("pointercancel", handleWorkflowCanvasPointerUp);
}

function handleWorkflowCanvasContextMenu(event) {
  event.preventDefault();
}

function handleWorkflowCanvasWheel(event) {
  if (!event.ctrlKey) return;
  event.preventDefault();
  const direction = event.deltaY < 0 ? 1 : -1;
  const nextZoom = clampWorkflowZoom(state.workflowCanvasZoom + direction * WORKFLOW_ZOOM_STEP);
  if (nextZoom === state.workflowCanvasZoom) return;
  state.workflowCanvasZoom = nextZoom;
  render();
}

function handleWorkflowKeyDown(event) {
  if (state.route !== "/workflow" || !isWorkflowDeleteKey(event.key) || workflowEditableTarget(event.target)) return;
  if (!Number.isInteger(state.workflowSelectedEdgeIndex) && !state.workflowSelectedNodeId) return;
  event.preventDefault();
  if (Number.isInteger(state.workflowSelectedEdgeIndex)) {
    deleteWorkflowEdge(state.workflowSelectedEdgeIndex);
  } else {
    deleteWorkflowNode(state.workflowSelectedNodeId, { confirm: false });
  }
  render();
}

async function handleChatSubmit(event) {
  event.preventDefault();
  if (!state.selection.sessionId) {
    state.toast = { tone: "warning", text: "Select or create a session first" };
    render();
    return;
  }
  if (!state.selection.timelineId) {
    state.toast = { tone: "warning", text: "Create or select a timeline first" };
    render();
    return;
  }
  const input = document.querySelector("[data-testid='composer-input']");
  state.chatDraft = input?.value ?? state.chatDraft;
  const content = state.chatDraft.trim();
  if (!content || state.sending) return;
  const client = runtimeClient();
  state.sending = true;
  state.shouldRefocusComposer = true;
  state.suppressComposerRefocus = false;
  state.chatDraft = "";
  state.toast = { tone: "loading", text: "Sending message to Runtime" };
  render();
  let sent = false;
  try {
    const created = await client.postSessionMessage(state.selection.sessionId, content, state.selection.timelineId ?? DEFAULT_TIMELINE_ID);
    state.messages.push(created);
    render();
    await streamAssistantReply(client);
    await refreshCurrentContext(client);
    sent = true;
    state.toast = { tone: "success", text: "Sent" };
  } catch (error) {
    state.chatDraft = content;
    markStreamingMessageFailed(error);
    state.toast = { tone: "error", text: `Send failed: ${error.message}` };
  } finally {
    state.sending = false;
    render();
    if (sent) {
      refocusComposerAfterAgentTurn();
    } else {
      state.shouldRefocusComposer = false;
    }
  }
}

async function streamAssistantReply(client) {
  for await (const event of client.streamChatEvents(state.selection.sessionId, state.selection.timelineId ?? DEFAULT_TIMELINE_ID)) {
    if (event.type === "token") applyToken(event.data);
    if (event.type === "done") completeStreamMessage(event.data);
    if (event.type === "tool_call") attachTool(event.data, "tool_call_ids");
    if (event.type === "tool_result") attachTool(event.data, "tool_result_ids");
    if (event.type === "error") throw new Error(event.data?.message ?? "Runtime stream failed");
    render();
  }
}

function handleFocusIntentDuringSend(event) {
  if (!state.sending || !state.shouldRefocusComposer) return;
  const target = event.target;
  if (target?.closest?.(".composer")) return;
  if (event.type === "pointerdown" || isEditableElement(target)) {
    state.suppressComposerRefocus = true;
  }
}

function refocusComposerAfterAgentTurn() {
  if (!shouldFocusComposerAfterAgentTurn()) {
    state.shouldRefocusComposer = false;
    return;
  }
  requestAnimationFrame(() => {
    if (!shouldFocusComposerAfterAgentTurn()) {
      state.shouldRefocusComposer = false;
      return;
    }
    document.querySelector("[data-testid='composer-input']")?.focus({ preventScroll: true });
    state.shouldRefocusComposer = false;
  });
}

function shouldFocusComposerAfterAgentTurn() {
  if (!state.shouldRefocusComposer || state.suppressComposerRefocus) return false;
  if (state.route !== "/chat" || state.sending || state.loading) return false;
  if (state.editingMessageId || state.messageMutationId) return false;
  if (state.openSessionMenuId || state.openTimelineMenuId || state.openMessageMenuId) return false;
  if (state.renamingSessionId || state.renamingTimelineId || state.deletingSessionId || state.deletingTimelineId) return false;
  const active = document.activeElement;
  return !isEditableElement(active);
}

function isEditableElement(element) {
  if (!element || element === document.body) return false;
  if (element.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName);
}

function applyToken(data) {
  const id = data.message_id;
  let message = state.messages.find((item) => item.id === id);
  if (!message) {
    message = { id, role: data.role ?? "assistant", content: "", status: "streaming", checkpoint_id: null, trace_id: data.trace_id ?? "trace-send-report-email", context_group_ids: data.group_id ? [data.group_id] : [], tool_call_ids: [], tool_result_ids: [] };
    state.messages.push(message);
  }
  attachContextGroup(message, data.group_id);
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
    attachContextGroup(message, data.group_id);
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

function createWorkflowDraft() {
  const id = `workflow_${Date.now()}`;
  state.workflowSelectedTemplateId = id;
  state.workflowName = "New Workflow";
  state.workflowNodes = [];
  state.workflowEdges = [];
  state.workflowSelectedNodeId = null;
  state.workflowSelectedEdgeIndex = null;
  state.workflowEdgeSourceId = null;
  state.workflowCanvasZoom = 1;
  state.workflowGraphPreview = null;
  state.workflowPublishedVersion = null;
  state.workflowTestRun = null;
  state.workflowRuntimeEvents = [];
  state.workflowDirty = true;
  history.pushState({}, "", `/workflow?templateId=${encodeURIComponent(id)}`);
}

function updateSelectedWorkflowConfig(path, rawValue) {
  const node = state.workflowNodes.find((item) => item.id === state.workflowSelectedNodeId);
  if (!node || !path) return;
  const value = parseWorkflowConfigValue(path, rawValue);
  node.config = { ...(node.config ?? {}) };
  if (value === undefined || value === "") {
    delete node.config[path];
  } else {
    node.config[path] = value;
  }
  state.workflowDirty = true;
  state.workflowGraphPreview = null;
  state.workflowPublishedVersion = null;
  state.workflowTestRun = null;
  state.workflowRuntimeEvents = [];
}

async function openWorkflow(templateId) {
  if (!templateId) return;
  try {
    const template = await runtimeClient().fetchTemplate(templateId);
    loadWorkflowManifest(template.manifest, template.id);
    history.pushState({}, "", `/workflow?templateId=${encodeURIComponent(templateId)}`);
    state.toast = { tone: "success", text: "Workflow loaded" };
  } catch (error) {
    state.toast = { tone: "error", text: error.message };
  }
  render();
}

async function saveWorkflow() {
  if (state.workflowSaving) return;
  state.workflowSaving = true;
  state.toast = { tone: "loading", text: "Saving workflow" };
  render();
  try {
    const client = runtimeClient();
    const manifest = serializeWorkflowManifest();
    const saved = await client.saveTemplate(manifest);
    if (client.saveAgentDraft) {
      await client.saveAgentDraft(saved.id ?? manifest.template.id, saved.manifest ?? manifest);
    }
    updateWorkflowTemplates(saved);
    loadWorkflowManifest(saved.manifest, saved.id);
    history.pushState({}, "", `/workflow?templateId=${encodeURIComponent(saved.id)}`);
    state.workflowGraphPreview = null;
    state.workflowPublishedVersion = null;
    state.workflowTestRun = null;
    state.workflowRuntimeEvents = [];
    state.toast = { tone: "success", text: "Workflow saved" };
  } catch (error) {
    state.toast = { tone: "error", text: error.message };
  } finally {
    state.workflowSaving = false;
    render();
  }
}

async function renameWorkflow(templateId) {
  if (!templateId || state.renamingWorkflowId) return;
  const workflow = state.workflowTemplates.find((item) => item.id === templateId);
  const savedWorkflow = Boolean(workflow);
  const label = savedWorkflow ? displayResourceLabel(workflow) : (state.workflowName || "New Workflow");
  state.openWorkflowMenuId = null;
  state.workflowMenuPosition = null;
  const name = window.prompt(`Rename workflow ${label}`, label)?.trim();
  if (name === undefined) {
    render();
    return;
  }
  if (!name) {
    state.toast = { tone: "warning", text: "Name is required" };
    render();
    return;
  }
  if (!savedWorkflow) {
    state.workflowName = name;
    state.workflowDirty = true;
    state.workflowGraphPreview = null;
    state.toast = { tone: "success", text: "Workflow renamed" };
    render();
    return;
  }
  state.renamingWorkflowId = templateId;
  state.toast = { tone: "loading", text: "Renaming workflow" };
  render();
  try {
    const updated = await runtimeClient().patchTemplate(templateId, name);
    updateWorkflowTemplates(updated);
    if (state.workflowSelectedTemplateId === templateId) {
      state.workflowName = workflowTemplateSummary(updated).name;
    }
    state.toast = { tone: "success", text: "Workflow renamed" };
    render();
  } catch (error) {
    state.toast = { tone: "error", text: error.message };
    render();
  } finally {
    state.renamingWorkflowId = null;
    render();
  }
}

async function deleteWorkflow(templateId) {
  if (!templateId || state.deletingWorkflowId) return;
  const workflow = state.workflowTemplates.find((item) => item.id === templateId);
  const savedWorkflow = Boolean(workflow);
  const label = savedWorkflow ? displayResourceLabel(workflow) : (state.workflowName || "New Workflow");
  state.openWorkflowMenuId = null;
  state.workflowMenuPosition = null;
  if (!window.confirm(`Delete workflow ${label}?`)) {
    render();
    return;
  }
  if (!savedWorkflow) {
    clearWorkflowDraft();
    history.pushState({}, "", "/workflow");
    state.toast = { tone: "success", text: "Workflow deleted" };
    render();
    return;
  }
  const beforeTemplates = [...state.workflowTemplates];
  state.deletingWorkflowId = templateId;
  state.toast = { tone: "loading", text: "Deleting workflow" };
  render();
  try {
    await runtimeClient().deleteTemplate(templateId);
    state.workflowTemplates = state.workflowTemplates.filter((item) => item.id !== templateId);
    if (state.workflowSelectedTemplateId === templateId) {
      const nextWorkflow = nextWorkflowAfterDelete(beforeTemplates, templateId);
      if (nextWorkflow) {
        await openWorkflow(nextWorkflow.id);
      } else {
        clearWorkflowDraft();
        history.pushState({}, "", "/workflow");
      }
    }
    state.toast = { tone: "success", text: "Workflow deleted" };
    render();
  } catch (error) {
    state.toast = { tone: "error", text: error.message };
    render();
  } finally {
    state.deletingWorkflowId = null;
    render();
  }
}

function addWorkflowNode(type) {
  if (!WORKFLOW_NODE_TYPES.includes(type)) {
    state.toast = { tone: "error", text: "Unsupported workflow node type" };
    return;
  }
  const id = `${type}-${state.workflowNodes.length + 1}`.replace(/_/g, "-");
  const firstNode = state.workflowNodes.length === 0;
  state.workflowNodes.push({ id, type, config: {}, position: { x: 80 + (state.workflowNodes.length % 4) * 150, y: 80 + Math.floor(state.workflowNodes.length / 4) * 120 } });
  if (firstNode) {
    state.workflowEdges = [{ from: "START", to: id }, { from: id, to: "END" }];
  }
  state.workflowSelectedNodeId = id;
  state.workflowSelectedEdgeIndex = null;
  state.workflowEdgeSourceId = id;
  state.workflowGraphPreview = null;
  state.workflowPublishedVersion = null;
  state.workflowTestRun = null;
  state.workflowRuntimeEvents = [];
  state.workflowDirty = true;
  state.toast = { tone: "success", text: `${titleCase(type.replace(/_/g, " "))} node added` };
}

function connectWorkflowEdge() {
  const source = document.querySelector("#workflow-edge-source")?.value ?? state.workflowEdgeSourceId ?? "START";
  const target = document.querySelector("#workflow-edge-target")?.value ?? workflowDefaultTarget(source);
  const sourceNode = state.workflowNodes.find((node) => node.id === source);
  const route = sourceNode?.type === "condition" ? (document.querySelector("#workflow-edge-route")?.value ?? "true") : null;
  if (!isValidWorkflowEndpoint(source, "source") || !isValidWorkflowEndpoint(target, "target")) {
    state.toast = { tone: "error", text: "Select valid edge endpoints" };
    return;
  }
  if (source === target) {
    state.toast = { tone: "warning", text: "Source and target must be different" };
    return;
  }
  const duplicate = state.workflowEdges.some((edge) => {
    const normalized = normalizeWorkflowEdge(edge);
    return normalized.source === source && normalized.target === target && normalized.route === route;
  });
  if (duplicate) {
    state.toast = { tone: "warning", text: "Edge already exists" };
    return;
  }
  state.workflowEdges = [...state.workflowEdges, { source, target, ...(route ? { route } : {}) }];
  state.workflowSelectedEdgeIndex = null;
  state.workflowEdgeSourceId = source;
  state.workflowDirty = true;
  state.workflowGraphPreview = null;
  state.workflowPublishedVersion = null;
  state.workflowTestRun = null;
  state.workflowRuntimeEvents = [];
  state.toast = { tone: "success", text: `Connected ${source} -> ${target}` };
}

function deleteWorkflowEdge(index) {
  if (!Number.isInteger(index) || index < 0 || index >= state.workflowEdges.length) return;
  const removed = normalizeWorkflowEdge(state.workflowEdges[index]);
  state.workflowEdges = state.workflowEdges.filter((_, edgeIndex) => edgeIndex !== index);
  if (state.workflowSelectedEdgeIndex === index) {
    state.workflowSelectedEdgeIndex = null;
  } else if (Number.isInteger(state.workflowSelectedEdgeIndex) && state.workflowSelectedEdgeIndex > index) {
    state.workflowSelectedEdgeIndex -= 1;
  }
  state.workflowDirty = true;
  state.workflowGraphPreview = null;
  state.workflowPublishedVersion = null;
  state.workflowTestRun = null;
  state.workflowRuntimeEvents = [];
  state.toast = { tone: "success", text: `Removed ${removed.source} -> ${removed.target}` };
}

function deleteWorkflowNode(nodeId = state.workflowSelectedNodeId, options = {}) {
  if (!nodeId) return;
  const node = state.workflowNodes.find((item) => item.id === nodeId);
  if (!node) return;
  if (options.confirm !== false && !window.confirm(`Delete node ${nodeId}? Connected edges will also be removed.`)) {
    return;
  }
  const removedEdgeCount = state.workflowEdges.filter((edge) => {
    const normalized = normalizeWorkflowEdge(edge);
    return normalized.source === nodeId || normalized.target === nodeId;
  }).length;
  state.workflowNodes = state.workflowNodes.filter((item) => item.id !== nodeId);
  state.workflowEdges = state.workflowEdges.filter((edge) => {
    const normalized = normalizeWorkflowEdge(edge);
    return normalized.source !== nodeId && normalized.target !== nodeId;
  });
  if (state.workflowSelectedNodeId === nodeId) {
    state.workflowSelectedNodeId = null;
  }
  if (state.workflowEdgeSourceId === nodeId) {
    state.workflowEdgeSourceId = null;
  }
  state.workflowSelectedEdgeIndex = null;
  state.workflowDirty = true;
  state.workflowGraphPreview = null;
  state.workflowPublishedVersion = null;
  state.workflowTestRun = null;
  state.workflowRuntimeEvents = [];
  state.toast = {
    tone: "success",
    text: `Removed ${nodeId}${removedEdgeCount ? ` and ${removedEdgeCount} connected edge${removedEdgeCount === 1 ? "" : "s"}` : ""}`,
  };
}

function selectWorkflowEdge(index) {
  if (!Number.isInteger(index) || index < 0 || index >= state.workflowEdges.length) return;
  state.workflowSelectedEdgeIndex = index;
  state.workflowSelectedNodeId = null;
  const edge = normalizeWorkflowEdge(state.workflowEdges[index]);
  state.toast = { tone: "success", text: `Selected ${edge.source} -> ${edge.target}` };
}

async function previewWorkflowGraph() {
  if (state.workflowPreviewing) return;
  state.workflowPreviewing = true;
  state.toast = { tone: "loading", text: "Building graph preview" };
  render();
  try {
    const preview = await runtimeClient().previewAgentGraph(state.workflowSelectedTemplateId || "workflow", serializeWorkflowManifest());
    state.workflowGraphPreview = preview;
    state.toast = preview.valid
      ? { tone: "success", text: "Graph preview ready" }
      : { tone: "error", text: preview.error?.message ?? "Graph validation failed" };
  } catch (error) {
    state.workflowGraphPreview = {
      valid: false,
      error: { code: "request.failed", message: error.message },
    };
    state.toast = { tone: "error", text: error.message };
  } finally {
    state.workflowPreviewing = false;
    render();
  }
}

async function validateWorkflowDraft() {
  if (state.workflowPreviewing) return;
  state.workflowPreviewing = true;
  state.toast = { tone: "loading", text: "Validating workflow" };
  render();
  try {
    const client = runtimeClient();
    const manifest = serializeWorkflowManifest();
    const validation = client.previewAgentGraph
      ? await client.previewAgentGraph(manifest.template.id, manifest)
      : await client.validateAgentDraft(manifest.template.id, manifest);
    state.workflowGraphPreview = validation.valid
      ? { valid: true, nodes: manifest.runtime.nodes, edges: manifest.runtime.edges, execution_order: [] }
      : { valid: false, error: validation.error ?? validation.errors?.[0] ?? { message: "Workflow validation failed" } };
    state.toast = validation.valid
      ? { tone: "success", text: "Workflow validation passed" }
      : { tone: "error", text: state.workflowGraphPreview.error?.message ?? "Workflow validation failed" };
  } catch (error) {
    state.workflowGraphPreview = { valid: false, error: { code: "request.failed", message: error.message } };
    state.toast = { tone: "error", text: error.message };
  } finally {
    state.workflowPreviewing = false;
    render();
  }
}

async function publishWorkflow() {
  if (state.workflowPublishing || !state.workflowSelectedTemplateId) return;
  state.workflowPublishing = true;
  state.toast = { tone: "loading", text: "Publishing workflow agent" };
  render();
  try {
    const manifest = await saveWorkflowDraftForAgent();
    const published = await runtimeClient().publishAgent(manifest.template.id);
    state.workflowPublishedVersion = published;
    state.workflowDirty = false;
    state.toast = { tone: "success", text: `Published ${published.id ?? "workflow agent"}` };
  } catch (error) {
    state.toast = { tone: "error", text: error.message };
  } finally {
    state.workflowPublishing = false;
    render();
  }
}

async function testWorkflowAgent() {
  if (state.workflowTesting || !state.workflowPublishedVersion) return;
  state.workflowTesting = true;
  state.workflowRuntimeEvents = [];
  state.workflowTestRun = { status: "running", output: null };
  state.toast = { tone: "loading", text: "Running workflow test" };
  render();
  try {
    const run = await runtimeClient().startAgentTestRun(state.workflowPublishedVersion.id, { input: state.workflowTestInput });
    state.workflowTestRun = run;
    state.workflowRuntimeEvents = (run.events ?? []).map((event) => ({ type: event.type, data: { ...(event.data ?? {}) } }));
    state.toast = run.status === "failed"
      ? { tone: "error", text: "Workflow test failed" }
      : { tone: "success", text: "Workflow test completed" };
  } catch (error) {
    state.workflowTestRun = { status: "failed", output: null, error: error.message };
    state.toast = { tone: "error", text: error.message };
  } finally {
    state.workflowTesting = false;
    render();
  }
}

async function useWorkflowAgent() {
  if (!state.workflowPublishedVersion) return;
  try {
    const session = await runtimeClient().createSession({
      agent_template_id: state.workflowSelectedTemplateId,
      agent_version_id: state.workflowPublishedVersion.id,
      workspace_id: "studio",
      title: state.workflowName || state.workflowSelectedTemplateId,
      metadata: { source: "workflow-builder" },
    });
    updateWorkspaceSessions([session], session);
    state.selection.sessionId = session.id;
    state.selection.timelineId = session.current_timeline_id ?? session.currentTimelineId ?? null;
    state.selectedAgentOptionId = "legacy";
    state.toast = { tone: "success", text: "Workflow agent session created" };
    await navigate(`/chat?sessionId=${encodeURIComponent(session.id)}`);
  } catch (error) {
    state.toast = { tone: "error", text: error.message };
    render();
  }
}

async function saveWorkflowDraftForAgent() {
  const client = runtimeClient();
  const manifest = serializeWorkflowManifest();
  const saved = await client.saveTemplate(manifest);
  const savedManifest = saved.manifest ?? manifest;
  if (client.saveAgentDraft) {
    await client.saveAgentDraft(saved.id ?? savedManifest.template.id, savedManifest);
  }
  updateWorkflowTemplates(saved);
  loadWorkflowManifest(savedManifest, saved.id ?? savedManifest.template.id);
  history.replaceState({}, "", `/workflow?templateId=${encodeURIComponent(state.workflowSelectedTemplateId)}`);
  return savedManifest;
}

function isValidWorkflowEndpoint(id, role) {
  if (role === "source" && id === "START") return true;
  if (role === "target" && id === "END") return true;
  return state.workflowNodes.some((node) => node.id === id);
}

function previewExecutionOrder(nodes, edges) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const outgoing = new Map();
  edges.forEach((edge) => {
    if (!outgoing.has(edge.source)) outgoing.set(edge.source, []);
    outgoing.get(edge.source).push(edge.target);
  });
  const order = [];
  const seen = new Set(["START"]);
  const queue = [...(outgoing.get("START") ?? [])];
  while (queue.length) {
    const id = queue.shift();
    if (!id || id === "END" || seen.has(id)) continue;
    seen.add(id);
    if (nodeIds.has(id)) order.push(id);
    queue.push(...(outgoing.get(id) ?? []));
  }
  return order;
}

function isPreviewEndpointValid(id, nodes, role) {
  if (role === "source" && id === "START") return true;
  if (role === "target" && id === "END") return true;
  return nodes.some((node) => node.id === id);
}

function serializeWorkflowManifest() {
  return serializeGraph({
    template: {
      id: state.workflowSelectedTemplateId || `workflow_${Date.now()}`,
      name: state.workflowName.trim() || "Untitled Workflow",
      version: "1.0.0",
    },
    nodes: state.workflowNodes,
    edges: state.workflowEdges,
    viewport: { zoom: state.workflowCanvasZoom },
  });
}

function loadWorkflowManifest(manifest, templateId = null) {
  const graph = deserializeGraph(manifest);
  state.workflowSelectedTemplateId = templateId ?? graph.template.id;
  state.workflowName = graph.template.name;
  state.workflowNodes = graph.nodes.map((node, index) => ({
    ...node,
    config: { ...(node.config ?? {}) },
    position: node.position ? { ...node.position } : defaultWorkflowPosition(index),
  }));
  state.workflowEdges = graph.edges.map(clone);
  state.workflowSelectedNodeId = state.workflowNodes[0]?.id ?? null;
  state.workflowSelectedEdgeIndex = null;
  state.workflowEdgeSourceId = null;
  state.workflowCanvasZoom = clampWorkflowZoom(graph.viewport?.zoom ?? 1);
  state.workflowGraphPreview = null;
  state.workflowPublishedVersion = null;
  state.workflowTestRun = null;
  state.workflowRuntimeEvents = [];
  state.workflowDirty = false;
}

function clearWorkflowDraft() {
  state.workflowSelectedTemplateId = null;
  state.workflowName = "";
  state.workflowNodes = [];
  state.workflowEdges = [];
  state.workflowSelectedNodeId = null;
  state.workflowSelectedEdgeIndex = null;
  state.workflowEdgeSourceId = null;
  state.workflowCanvasZoom = 1;
  state.workflowGraphPreview = null;
  state.workflowPublishedVersion = null;
  state.workflowTestRun = null;
  state.workflowRuntimeEvents = [];
  state.workflowDirty = false;
}

function updateWorkflowTemplates(template) {
  const summary = workflowTemplateSummary(template);
  const byId = new Map(state.workflowTemplates.map((item) => [item.id, item]));
  byId.set(summary.id, summary);
  state.workflowTemplates = [...byId.values()];
}

function workflowTemplateSummary(template) {
  const manifest = template.manifest ?? template;
  return {
    id: template.id ?? manifest.template.id,
    name: manifest.template.name,
    version: manifest.template.version,
  };
}

function defaultWorkflowPosition(index) {
  return { x: 60 + index * 140, y: 80 + (index % 2) * 110 };
}

function workflowIdFromUrl() {
  return new URLSearchParams(window.location.search).get("templateId");
}

function nextWorkflowAfterDelete(workflows, deletedWorkflowId) {
  const deletedIndex = workflows.findIndex((workflow) => workflow.id === deletedWorkflowId);
  const remaining = workflows.filter((workflow) => workflow.id !== deletedWorkflowId);
  if (remaining.length === 0) return null;
  return remaining[Math.min(deletedIndex, remaining.length - 1)];
}

function clampWorkflowZoom(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.max(WORKFLOW_MIN_ZOOM, Math.min(WORKFLOW_MAX_ZOOM, Number(numeric.toFixed(2))));
}

function workflowZoomAttr() {
  return state.workflowCanvasZoom.toFixed(2).replace(/\.?0+$/, "");
}

function isWorkflowDeleteKey(key) {
  return key === "Delete" || key === "Backspace";
}

function workflowEditableTarget(target) {
  if (!target) return false;
  const tagName = target.tagName?.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select" || target.isContentEditable;
}

function workflowInteractivePanTarget(target) {
  return Boolean(target?.closest?.(".graph-node, .node-port, .workflow-edge-hit, [data-action], input, textarea, select, button"));
}

function runtimeClient() {
  return state.config.mockRuntime ? mockClient() : realClient();
}

function realClient() {
  return {
    listAgents: () => getJson("/api/agents"),
    listTools: () => getJson("/api/tools"),
    fetchSessions: () => getJson("/api/sessions"),
    fetchTemplates: () => getJson("/api/templates"),
    fetchTemplate: (templateId) => getJson(`/api/templates/${encodeURIComponent(templateId)}`),
    saveTemplate: (manifest) => postJson("/api/templates", manifest),
    patchTemplate: (templateId, name) => patchJson(`/api/templates/${encodeURIComponent(templateId)}`, { name }),
    deleteTemplate: (templateId) => deleteJson(`/api/templates/${encodeURIComponent(templateId)}`),
    deleteTemplateNode: (templateId, nodeId) => deleteJson(`/api/templates/${encodeURIComponent(templateId)}/nodes/${encodeURIComponent(nodeId)}`),
    saveAgentDraft: (agentId, manifest) => putJson(`/api/agents/${encodeURIComponent(agentId)}/draft`, manifest),
    validateAgentDraft: (agentId, manifest) => postJson(`/api/agents/${encodeURIComponent(agentId)}/validate`, manifest),
    previewAgentGraph: (agentId, manifest) => postJson(`/api/agents/${encodeURIComponent(agentId)}/graph-preview`, manifest),
    publishAgent: (agentId) => postJson(`/api/agents/${encodeURIComponent(agentId)}/publish`, {}),
    startAgentTestRun: (agentVersionId, payload) => postJson(`/api/agent-versions/${encodeURIComponent(agentVersionId)}/test-runs`, payload),
    fetchSessionMessages: (sessionId, timelineId) => getJson(`/api/sessions/${encodeURIComponent(sessionId)}/messages${timelineId ? `?timelineId=${encodeURIComponent(timelineId)}` : ""}`),
    createSession: (payload = { agent_template_id: "research-agent", workspace_id: "studio" }) => postJson("/api/sessions", payload),
    deleteSession: (sessionId) => deleteJson(`/api/sessions/${encodeURIComponent(sessionId)}`),
    deleteTimeline: (timelineId) => deleteJson(`/api/timelines/${encodeURIComponent(timelineId)}`),
    patchSession: (sessionId, title) => patchJson(`/api/sessions/${encodeURIComponent(sessionId)}`, { title }),
    patchSessionAgent: (sessionId, payload) => patchJson(`/api/sessions/${encodeURIComponent(sessionId)}/agent`, payload),
    patchTimeline: (timelineId, title) => patchJson(`/api/timelines/${encodeURIComponent(timelineId)}`, { title }),
    patchMessage: (messageId, content, options = {}) => patchJson(`/api/messages/${encodeURIComponent(messageId)}`, { new_content: content, semantic: Boolean(options.semantic) }),
    deleteMessage: (messageId) => deleteJson(`/api/messages/${encodeURIComponent(messageId)}`),
    activateTimeline: (timelineId) => postJson(`/api/timelines/${encodeURIComponent(timelineId)}/activate`, {}),
    postSessionMessage: (sessionId, content, timelineId) => postJson(`/api/sessions/${encodeURIComponent(sessionId)}/messages`, { role: "user", content, token_count: tokenEstimate(content), timeline_id: timelineId }),
    fetchDebugIndex(sessionId, params = {}) {
      const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value)).toString();
      return getJson(`/api/debug/sessions/${encodeURIComponent(sessionId)}${query ? `?${query}` : ""}`);
    },
    async fetchSessionContext(sessionId, timelineId) {
      try {
        const body = await getJson(`/api/sessions/${encodeURIComponent(sessionId)}/context${timelineId ? `?timelineId=${encodeURIComponent(timelineId)}` : ""}`);
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
    async fetchSessions() {
      return { sessions: state.sessions.map(clone) };
    },
    async listAgents() {
      return { agents: [] };
    },
    async listTools() {
      return {
        tools: [
          {
            id: "context.echo",
            name: "Context Echo",
            description: "Echoes the query argument for workflow smoke tests.",
            input_schema: { type: "object", required: ["query"], properties: { query: { type: "string" } } },
            output_schema: { type: "object", properties: { echo: { type: "string" } } },
            configurable: false,
          },
        ],
      };
    },
    async fetchTemplates() {
      return { templates: state.workflowTemplates.length ? state.workflowTemplates.map(clone) : [workflowTemplateSummary({ id: demoTemplateManifest.template.id, manifest: demoTemplateManifest })] };
    },
    async fetchTemplate(templateId) {
      if (templateId === state.workflowSelectedTemplateId) return { id: templateId, manifest: serializeWorkflowManifest() };
      return { id: demoTemplateManifest.template.id, manifest: clone(demoTemplateManifest) };
    },
    async saveTemplate(manifest) {
      return { id: manifest.template.id, manifest: clone(manifest) };
    },
    async saveAgentDraft(agentId, manifest) {
      return { id: agentId, draft_manifest: clone(manifest), draft_updated_at: new Date().toISOString() };
    },
    async validateAgentDraft(agentId, manifest) {
      return this.previewAgentGraph(agentId, manifest);
    },
    async patchTemplate(templateId, name) {
      const manifest = templateId === state.workflowSelectedTemplateId
        ? serializeWorkflowManifest()
        : clone(demoTemplateManifest);
      manifest.template.name = name;
      return { id: templateId, manifest };
    },
    async deleteTemplate(templateId) {
      return { id: templateId };
    },
    async deleteTemplateNode(templateId, nodeId) {
      return { id: templateId, deleted_node_id: nodeId };
    },
    async previewAgentGraph(agentId, manifest) {
      const graph = deserializeGraph(manifest);
      const edges = graph.edges.map(normalizeWorkflowEdge);
      const executionOrder = previewExecutionOrder(graph.nodes, edges);
      const unknownEdge = edges.find((edge) => !isPreviewEndpointValid(edge.source, graph.nodes, "source") || !isPreviewEndpointValid(edge.target, graph.nodes, "target"));
      if (unknownEdge) {
        return {
          valid: false,
          error: { code: "unknown_node", message: `Unknown endpoint in edge ${unknownEdge.source} -> ${unknownEdge.target}` },
        };
      }
      return {
        valid: true,
        start: "START",
        end: "END",
        nodes: graph.nodes.map(({ id, type, config }) => ({ id, type, config: clone(config ?? {}) })),
        edges,
        execution_order: executionOrder,
        graph_state: { visited_nodes: executionOrder, agent_id: agentId },
      };
    },
    async publishAgent(agentId) {
      return {
        id: `${agentId}_v1`,
        agent_template_id: agentId,
        version: 1,
        checksum: "mock",
        status: "published",
        published_at: new Date().toISOString(),
      };
    },
    async startAgentTestRun(agentVersionId, payload = {}) {
      return {
        id: `test_run_${Date.now()}`,
        run_id: `test_run_${Date.now()}`,
        agent_version_id: agentVersionId,
        status: "completed",
        output: payload.input ? `Echo: ${payload.input}` : "OK",
        events: [
          { type: "graph_started", data: { agent_version_id: agentVersionId, trace_id: "mock-trace" } },
          { type: "node_started", data: { node_id: state.workflowNodes[0]?.id ?? "workflow", trace_id: "mock-trace" } },
          { type: "node_finished", data: { node_id: state.workflowNodes[0]?.id ?? "workflow", trace_id: "mock-trace", output: payload.input ?? "OK" } },
          { type: "graph_finished", data: { agent_version_id: agentVersionId, trace_id: "mock-trace", output: payload.input ? `Echo: ${payload.input}` : "OK" } },
        ],
      };
    },
    async fetchSessionMessages() {
      const messages = state.messages.length ? state.messages : demoFixtures.messages;
      return { messages: messages.filter((message) => !isDeletedMessage(message)).map(clone), next_cursor: null };
    },
    async createSession(payload = {}) {
      return {
        ...clone(demoFixtures.session),
        id: `local-session-${Date.now()}`,
        current_timeline_id: demoFixtures.timeline.id,
        workspace_id: payload.workspace_id ?? "studio",
        agent_template_id: payload.agent_template_id ?? "research-agent",
        agent_version_id: payload.agent_version_id ?? null,
        title: payload.title,
      };
    },
    async deleteSession() {
      return {};
    },
    async deleteTimeline(timelineId) {
      return { timeline: { ...clone(demoFixtures.timeline), id: timelineId, status: "deleted" }, current_timeline_id: null };
    },
    async patchSession(sessionId, title) {
      return { ...clone(demoFixtures.session), id: sessionId, title };
    },
    async patchSessionAgent(sessionId, payload = {}) {
      const session = state.sessions.find((item) => item.id === sessionId) ?? demoFixtures.session;
      return { ...clone(session), id: sessionId, agent_version_id: payload.agent_version_id ?? null };
    },
    async patchTimeline(timelineId, title) {
      return { ...clone(demoFixtures.timeline), id: timelineId, title };
    },
    async patchMessage(messageId, content, options = {}) {
      const message = state.messages.find((item) => item.id === messageId) ?? demoFixtures.messages.find((item) => item.id === messageId);
      const updated = { ...clone(message), content, revision_id: `local-revision-${Date.now()}`, user_modified: true };
      if (options.semantic) {
        const timeline = { ...clone(demoFixtures.timeline), id: `local-timeline-${Date.now()}`, parent_timeline_id: message?.timeline_id ?? demoFixtures.timeline.id, fork_message_id: messageId };
        return { revision_id: updated.revision_id, message: updated, timeline, impact: { triggered: true, requires_replay: false, checks: [] } };
      }
      return { revision_id: updated.revision_id, message: updated, impact: { triggered: true, requires_replay: false, checks: [] } };
    },
    async deleteMessage(messageId) {
      const message = state.messages.find((item) => item.id === messageId) ?? demoFixtures.messages.find((item) => item.id === messageId);
      if (message) {
        message.is_deleted = true;
        message.deleted_at = new Date().toISOString();
      }
      return { message_ids: [messageId], message };
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
    async activateTimeline(timelineId) {
      return { ...clone(demoFixtures.timeline), id: timelineId };
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

async function putJson(path, payload) {
  const response = await fetch(path, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message ?? `Runtime request failed with ${response.status}`);
  return body;
}

async function patchJson(path, payload) {
  const response = await fetch(path, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message ?? `Runtime request failed with ${response.status}`);
  return body;
}

async function deleteJson(path) {
  const response = await fetch(path, { method: "DELETE" });
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

function updateMessage(updatedMessage) {
  state.messages = state.messages.map((message) => (message.id === updatedMessage.id ? updatedMessage : message));
}

function attachContextGroup(message, groupId) {
  if (!groupId) return;
  if (!Array.isArray(message.context_group_ids)) message.context_group_ids = [];
  if (!message.context_group_ids.includes(groupId)) message.context_group_ids.push(groupId);
}

function isDeletedMessage(message) {
  return Boolean(message?.is_deleted ?? message?.isDeleted);
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

async function refreshCurrentContext(client = runtimeClient()) {
  if (!state.selection.sessionId || !state.selection.timelineId) {
    state.contextItems = [];
    return;
  }
  state.contextItems = await client.fetchSessionContext(state.selection.sessionId, state.selection.timelineId);
}

function isCurrentRouteLoad(loadVersion, route, sessionId) {
  return loadVersion === routeLoadVersion && state.route === route && state.selection.sessionId === sessionId;
}

async function fetchWorkspaceSessions(client) {
  if (typeof client.fetchSessions !== "function") {
    return null;
  }
  return client.fetchSessions();
}

async function fetchWorkflowTools(client) {
  if (typeof client.listTools !== "function") {
    return [];
  }
  try {
    const response = await client.listTools();
    return Array.isArray(response.tools) ? response.tools.map(clone) : [];
  } catch {
    return [];
  }
}

async function loadAgentOptions(client) {
  if (typeof client.listAgents !== "function") {
    return state.agentOptions;
  }
  try {
    return await fetchPublishedAgentOptions(client);
  } catch {
    return state.agentOptions;
  }
}

function selectedAgentOption() {
  return state.agentOptions.find((option) => option.id === state.selectedAgentOptionId) ?? state.agentOptions[0];
}

function agentOptionIdForSession(session) {
  const agentVersionId = session?.agent_version_id ?? session?.agentVersionId ?? null;
  if (!agentVersionId) return "legacy";
  return state.agentOptions.find((option) => option.agentVersionId === agentVersionId || option.id === agentVersionId)?.id ?? "legacy";
}

function updateWorkspaceSessions(sessions, currentSession = null, options = {}) {
  const byId = new Map();
  if (!options.replace) {
    for (const session of state.sessions) {
      if (session?.id) byId.set(session.id, session);
    }
  }
  for (const session of sessions) {
    if (session?.id) byId.set(session.id, session);
  }
  if (currentSession?.id) {
    byId.set(currentSession.id, currentSession);
  }
  state.sessions = [...byId.values()];
}

function workspaceSessions(currentSessionId) {
  const sessions = state.sessions.filter((session) => session?.id);
  if (!currentSessionId) {
    return sessions;
  }
  if (sessions.some((session) => session.id === currentSessionId)) {
    return sessions;
  }
  return [
    ...sessions,
    {
      id: currentSessionId,
      agent_template_id: "research-agent",
      workspace_id: "studio",
      current_timeline_id: state.selection.timelineId,
      status: state.config.mockRuntime ? "mock" : "runtime",
    },
  ];
}

function timelineIdForSession(sessionId) {
  const session = state.sessions.find((item) => item.id === sessionId);
  return session?.current_timeline_id ?? session?.currentTimelineId ?? null;
}

function activeTimelineIdForSession(sessionId) {
  const debugSession = state.debugIndex?.session;
  if (debugSession?.id === sessionId) {
    return debugSession.current_timeline_id ?? debugSession.currentTimelineId ?? null;
  }
  return timelineIdForSession(sessionId);
}

function shouldForkForMessageEdit(message) {
  return (message?.role ?? "").toLowerCase() === "user";
}

function nextSessionAfterDelete(sessions, deletedSessionId) {
  const deletedIndex = sessions.findIndex((session) => session.id === deletedSessionId);
  const remaining = sessions.filter((session) => session.id !== deletedSessionId);
  if (remaining.length === 0) return null;
  return remaining[Math.min(deletedIndex, remaining.length - 1)];
}

function sessionMenuPosition(rect, width = 112) {
  const rightSideLeft = rect.right + 4;
  return {
    left: rightSideLeft + width <= window.innerWidth - 8
      ? rightSideLeft
      : Math.max(8, rect.left - width - 4),
    top: Math.max(8, rect.top),
  };
}

function resolveTimelineId(debugIndex, requestedTimelineId) {
  const timelines = debugIndex?.timelines ?? [];
  if (requestedTimelineId && timelines.some((timeline) => timeline.id === requestedTimelineId)) {
    return requestedTimelineId;
  }
  return debugIndex?.session?.current_timeline_id ?? debugIndex?.session?.currentTimelineId ?? timelines[0]?.id ?? null;
}

function displayResourceLabel(resource) {
  return resource.title ?? resource.name ?? resource.displayName ?? compactResourceId(resource.id);
}

function compactResourceId(id) {
  const value = String(id ?? "");
  if (value.length <= 22) return value;
  const separator = value.indexOf("_");
  if (separator > 0 && separator < value.length - 1) {
    return `${value.slice(0, separator + 1)}${value.slice(separator + 1, separator + 9)}`;
  }
  return value.slice(0, 18);
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
    .message-card { position: relative; width: min(820px, 92%); border: 1px solid var(--line); background: var(--panel); border-radius: 10px; padding: 13px 44px 13px 14px; cursor: pointer; }
    .message-card.user { align-self: flex-end; border-color: #c2d7cd; background: #f3fbf7; }
    .message-card.assistant { align-self: flex-start; border-color: #bfd0ec; background: #f8fbff; }
    .message-card.selected { outline: 2px solid var(--accent); }
    .message-card header { display: flex; justify-content: space-between; gap: 12px; color: var(--muted); margin-bottom: 8px; }
    .message-card p { margin-bottom: 10px; white-space: pre-wrap; }
    .message-menu-trigger { position: absolute; top: 8px; right: 8px; width: 30px; min-height: 30px; padding: 4px 0; font-size: 13px; line-height: 1; color: var(--muted); visibility: hidden; }
    .message-card:hover .message-menu-trigger, .message-card:focus-within .message-menu-trigger, .message-card.menu-open .message-menu-trigger { visibility: visible; }
    .message-menu { position: fixed; z-index: 55; min-width: 124px; padding: 4px; border: 1px solid var(--line); border-radius: 7px; background: var(--panel); box-shadow: 0 8px 20px rgba(16, 24, 40, .14); }
    .message-menu button { width: 100%; border: 0; padding: 7px 10px; text-align: left; background: transparent; }
    .message-menu button:hover { background: var(--accent-soft); }
    .message-menu button.danger { color: var(--error); }
    .message-menu button.danger:hover { background: #fff1f0; }
    .message-edit { display: grid; gap: 8px; }
    .message-edit textarea { width: 100%; min-height: 104px; border: 1px solid var(--line-strong); border-radius: 7px; background: #fff; }
    .message-edit-actions { display: flex; justify-content: flex-end; gap: 8px; }
    .message-error { color: var(--error); font-size: 13px; }
    .tool-strip { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
    .tool-call, .tool-result, .trace-pill { display: inline-flex; align-items: center; border-radius: 999px; padding: 4px 8px; font-size: 12px; }
    .tool-call { background: #fff4e5; color: #875300; }
    .tool-result { background: #e8f7ef; color: #0f6a49; }
    .trace-pill { background: var(--accent-soft); border-color: #b9cdfa; color: #1d4ed8; }
    .composer { flex: 0 0 auto; display: grid; grid-template-columns: 1fr auto; gap: 10px; padding: 12px; border: 1px solid var(--line); background: var(--panel); border-radius: 12px; }
    textarea { resize: none; min-height: 42px; max-height: 140px; border: 0; outline: 0; background: transparent; padding: 8px; }
    .session-row { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) 34px; gap: 6px; align-items: stretch; margin-bottom: 8px; overflow: visible; }
    .nav-item { width: 100%; min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px; text-align: left; margin-bottom: 8px; overflow: hidden; }
    .session-row .nav-item { margin-bottom: 0; }
    .session-menu-host { min-width: 0; display: flex; align-items: stretch; }
    .session-menu-trigger { width: 34px; min-height: 34px; padding: 6px 0; font-size: 13px; line-height: 1; color: var(--muted); visibility: hidden; }
    .session-row:hover .session-menu-trigger, .session-row.menu-open .session-menu-trigger { visibility: visible; }
    .actions .workflow-menu-host .session-menu-trigger { visibility: visible; }
    .session-menu { position: fixed; z-index: 50; min-width: 112px; padding: 4px; border: 1px solid var(--line); border-radius: 7px; background: var(--panel); box-shadow: 0 8px 20px rgba(16, 24, 40, .14); }
    .session-menu button { width: 100%; border: 0; padding: 7px 10px; text-align: left; color: var(--text); background: transparent; }
    .session-menu button:hover { background: var(--accent-soft); }
    .session-menu button.danger { color: var(--error); }
    .session-menu button.danger:hover { background: #fff1f0; }
    .nav-item span, .nav-item small { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .nav-item small { color: var(--muted); }
    .nav-item.current small { color: var(--success); font-weight: 700; }
    .selected { border-color: var(--accent); box-shadow: inset 3px 0 0 var(--accent); }
    .tabs { display: flex; gap: 6px; margin-bottom: 12px; }
    .tabs.vertical { flex-direction: column; width: 180px; }
    .tabs .active { background: var(--accent-soft); border-color: #b9cdfa; color: #1d4ed8; }
    .context-item { border: 1px solid var(--line); border-radius: 8px; padding: 10px; margin-bottom: 10px; background: #fbfcfe; }
    .workflow-surface { flex: 1; min-height: 0; display: grid; grid-template-columns: 180px minmax(320px, 1fr) minmax(320px, 28vw); gap: 12px; overflow: auto; }
    .node-palette, .template-fields, .debug-grid section { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 12px; overflow: auto; }
    .node-config { min-width: 320px; max-width: min(540px, 34vw); display: grid; align-content: start; gap: 10px; overflow: auto; background: #f8fafc; border: 1px solid var(--line); border-radius: 10px; padding: 10px; }
    .node-config-section { display: grid; gap: 9px; padding: 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); }
    .node-config-section h2 { margin-bottom: 0; }
    .node-config-fields { background: #fbfcfe; }
    .basic-info { border-color: #cfd8e3; }
    .node-config-meta { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px; }
    .node-config-meta div { min-width: 0; padding: 7px 8px; border: 1px solid var(--line); border-radius: 7px; background: #f8fafc; }
    .node-config-meta span { display: block; margin-bottom: 2px; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0; }
    .node-config-meta strong { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); font-size: 13px; font-weight: 700; }
    .config-field { gap: 4px; font-size: 12px; }
    .node-config input, .node-config select, .node-config textarea { width: 100%; border: 1px solid var(--line-strong); border-radius: 7px; color: var(--text); background: #fff; transition: border-color .12s ease, box-shadow .12s ease, background-color .12s ease; }
    .node-config input, .node-config select { padding: 7px 9px; min-height: 34px; }
    .node-config textarea { min-height: 78px; max-height: 220px; padding: 8px 9px; outline: 0; resize: vertical; }
    .node-config input:hover, .node-config select:hover, .node-config textarea:hover { border-color: #8ea1bb; background: #fff; }
    .node-config input:focus, .node-config select:focus, .node-config textarea:focus { border-color: var(--accent); outline: 2px solid rgba(37, 99, 235, .18); outline-offset: 1px; box-shadow: 0 0 0 1px rgba(37, 99, 235, .12); }
    .danger-zone { background: #fffafa; border-color: #f3c6c2; }
    .danger-zone h2 { color: #9f2f27; }
    .subtle-danger { justify-self: start; padding: 6px 9px; min-height: 32px; background: #fff; border-color: #f3b8b2; color: var(--error); }
    .subtle-danger:hover:not(:disabled) { background: #fff1f0; border-color: var(--error); color: var(--error); }
    .node-palette button { width: 100%; margin-bottom: 8px; text-align: left; }
    .node-palette .session-row .nav-item { margin-bottom: 0; }
    .node-palette .session-menu-trigger { width: 34px; margin-bottom: 0; text-align: center; }
    .graph-canvas { position: relative; min-height: 0; border: 1px solid var(--line); border-radius: 10px; background: linear-gradient(#e8edf3 1px, transparent 1px), linear-gradient(90deg, #e8edf3 1px, transparent 1px), #fff; background-size: 28px 28px; overflow: auto; }
    .graph-canvas-viewport { position: relative; min-width: 100%; min-height: 100%; }
    .graph-canvas-content { position: relative; min-width: 100%; min-height: 100%; transform-origin: 0 0; }
    .workflow-zoom-indicator { position: sticky; left: 10px; bottom: 10px; z-index: 4; display: inline-flex; margin: 0 0 10px 10px; padding: 3px 7px; border: 1px solid var(--line); border-radius: 6px; background: rgba(248,250,252,.92); color: var(--muted); font-size: 11px; font-weight: 700; pointer-events: none; }
    .workflow-edges { position: absolute; inset: 0 auto auto 0; overflow: visible; pointer-events: auto; }
    .workflow-edge-line { stroke: #64748b; stroke-width: 2; marker-end: url(#workflow-edge-arrow); pointer-events: none; }
    .workflow-edge-line.selected { stroke: var(--accent); stroke-width: 3; }
    .workflow-edge-hit { fill: rgba(37, 99, 235, .001); stroke: none; pointer-events: auto; cursor: pointer; }
    .workflow-boundary { position: absolute; z-index: 1; padding: 4px 7px; border-radius: 6px; border: 1px solid var(--line); background: #f8fafc; color: var(--muted); font-size: 11px; font-weight: 700; }
    .workflow-boundary-start { left: 12px; top: 14px; }
    .workflow-boundary-end { right: 14px; bottom: 14px; }
    .graph-node-wrap { position: absolute; z-index: 2; width: 128px; height: 64px; }
    .graph-node { width: 112px; height: 56px; background: #fff; cursor: grab; user-select: none; touch-action: none; display: grid; align-content: center; gap: 2px; text-align: left; }
    .graph-node-wrap.selected .graph-node { border-color: var(--accent); box-shadow: inset 3px 0 0 var(--accent); }
    .graph-node-wrap.edge-source .graph-node { border-color: var(--success); }
    .graph-node small { color: var(--muted); font-size: 11px; }
    .graph-node:active { cursor: grabbing; }
    .node-port { position: absolute; top: 18px; right: 0; width: 24px; height: 24px; min-height: 24px; padding: 0; border-radius: 50%; font-weight: 700; }
    .edge-list { display: grid; gap: 8px; margin-top: 10px; }
    .workflow-edge { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; padding: 7px; border: 1px solid var(--line); border-radius: 7px; background: #fbfcfe; }
    .workflow-edge.selected { border-color: var(--accent); background: var(--accent-soft); }
    .workflow-edge span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .graph-preview { display: grid; gap: 8px; padding: 9px; border: 1px solid var(--line); border-radius: 7px; background: #fbfcfe; }
    .graph-preview.error { border-color: #fecaca; background: #fff1f0; color: var(--error); }
    .graph-preview pre { margin: 0; white-space: pre-wrap; font: 12px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; color: var(--text); }
    .template-layout { display: flex; gap: 14px; min-height: 0; }
    .template-fields { flex: 1; display: grid; align-content: start; gap: 12px; }
    label { display: grid; gap: 6px; color: var(--muted); }
    input, select { border: 1px solid var(--line); border-radius: 7px; padding: 9px 10px; color: var(--text); background: #f8fafc; }
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
