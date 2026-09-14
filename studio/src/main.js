import { demoFixtures, demoTemplateManifest } from "./test/fixtures/demoRuntime.js";
import { streamSseEvents } from "./client/sseStream.js";
import {
  createSessionWithSelectedAgent,
  fetchPublishedAgentOptions,
  sessionAgentLabel,
  switchSessionAgent,
} from "./session/agentSelector.js";
import { createNewWorkflowDefinition, createStarterWorkflowV2Definition } from "./pages/Workflow/index.js";
import { createWorkflowV2Workbench } from "./pages/Workflow/WorkflowV2Workbench.js";

const ROUTES = ["/chat", "/workflow", "/template", "/debug"];
const DEFAULT_SESSION_ID = "demo-session";
const DEFAULT_TIMELINE_ID = "demo-timeline";
const WORKFLOW_MIN_ZOOM = 0.4;
const WORKFLOW_MAX_ZOOM = 2;
const WORKFLOW_ZOOM_STEP = 0.1;
const WORKFLOW_CONFIG_PANEL_DEFAULT_WIDTH = 360;
const WORKFLOW_CONFIG_PANEL_MIN_WIDTH = 320;
const WORKFLOW_CONFIG_PANEL_MAX_WIDTH = 720;
const WORKFLOW_V2_DEFAULT_ID = "agent-workflow-v2-draft";
const app = document.querySelector("#app");
let routeLoadVersion = 0;
const WORKFLOW_NODE_TYPES = ["prompt", "llm", "tool", "condition", "output"];
const AGENT_WORKFLOW_V2_NODE_TYPES = ["agent", "condition", "workflow", "end"];
const WORKFLOW_CONFIG_FIELDS = {
  prompt: [
    workflowConfigField("role", "Role", { example: "user" }),
    workflowConfigField("template", "Template", { required: true, example: "Summarize {{input}}" }),
    workflowConfigField("variables", "Variables", { visibility: "hidden", editable: false }),
    workflowConfigField("input_mapping", "Input Mapping", { binding: "template_variables", sourceField: "template" }),
    workflowConfigField("output_key", "Output Key", { visibility: "hidden", editable: false }),
  ],
  llm: [
    workflowConfigField("provider", "Provider", { example: "openai-compatible" }),
    workflowConfigField("model", "Model", { required: true, example: "default" }),
    workflowConfigField("max_tokens", "Max Tokens", { example: "512" }),
    workflowConfigField("system_prompt", "System Prompt", { example: "You are helpful." }),
    workflowConfigField("prompt", "Prompt", { required: true, example: "Summarize {{input}}" }),
    workflowConfigField("temperature", "Temperature", { example: "0.2" }),
    workflowConfigField("input_mapping", "Input Mapping", { binding: "template_variables", sourceField: "prompt" }),
    workflowConfigField("output_key", "Output Key", { visibility: "hidden", editable: false }),
  ],
  tool: [
    workflowConfigField("tool_name", "Tool", { required: true, example: "context.echo" }),
    workflowConfigField("args", "Arguments", { binding: "tool_args" }),
    workflowConfigField("output_key", "Output Key", { visibility: "hidden", editable: false }),
  ],
  condition: [
    workflowConfigField("source", "Source", { required: true, binding: "reference" }),
    workflowConfigField("operator", "Operator", { required: true, example: "gte" }),
    workflowConfigField("value", "Value", { example: "80" }),
    workflowConfigField("state_key", "State Key", { visibility: "hidden", editable: false }),
  ],
  output: [workflowConfigField("source", "Source", { required: true, binding: "reference" })],
};
const WORKFLOW_JSON_CONFIG_FIELDS = new Set(["variables", "input_mapping", "args"]);
const WORKFLOW_NUMBER_CONFIG_FIELDS = new Set(["temperature", "max_tokens"]);

function workflowConfigField(path, label, options = {}) {
  return {
    path,
    label,
    required: false,
    visibility: "visible",
    editable: true,
    example: "",
    ...options,
  };
}

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
  workflowV2Workbench: null,
  workflowV2DefinitionReady: false,
  workflowNodes: [],
  workflowEdges: [],
  workflowTemplates: [],
  workflowSelectedTemplateId: null,
  workflowName: "Agent Workflow V2 Draft",
  workflowDirty: false,
  workflowSaving: false,
  workflowDrag: null,
  workflowCanvasPan: null,
  workflowConfigResize: null,
  workflowConfigPanelWidth: WORKFLOW_CONFIG_PANEL_DEFAULT_WIDTH,
  workflowSelectedNodeId: null,
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
  workflowV2BottomPanelOpen: true,
  workflowV2ActiveBottomTab: "edge-relations",
  workflowV2Versions: [],
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
      const tools = await fetchWorkflowTools(client);
      if (!isCurrentRouteLoad(loadVersion, requestedRoute, requestedSessionId)) return;
      state.workflowToolCatalog = tools;
      await workflowV2Workbench().loadWorkflowTools();
      await workflowV2Workbench().refreshWorkflowVersions();
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
  return renderWorkflowV2();
}

function renderWorkflowV2() {
  const view = workflowV2Workbench().view();
  const selectedNode = view.canvas.nodes.find((node) => node.id === view.nodeConfig.selectedNodeId) ?? null;
  return `
    <section class="workflow-page workflow-v2-page">
      <div class="page-head">
        <div><h1 data-testid="main-title">Agent Workflow V2</h1><p>Schema Version 2 drafts use Agent and control-flow nodes.</p></div>
        <div class="actions">
          <button type="button" class="secondary" data-action="validate-workflow-v2" data-testid="workflow-v2-validate">Validate</button>
          <button type="button" class="secondary" data-action="publish-workflow-v2" data-testid="workflow-v2-publish">Publish</button>
          <button type="button" class="secondary" data-action="run-workflow-v2" data-testid="workflow-v2-run">Run</button>
          <button type="button" data-action="save-workflow-v2-draft" data-testid="workflow-v2-save">Save Draft</button>
        </div>
      </div>
      <div class="workflow-surface workflow-v2-surface" data-testid="workflow-v2-workbench" style="--workflow-config-panel-width:${workflowConfigPanelWidth()}px">
        <div class="node-palette">
          <section>
            <h2>Node Library</h2>
            ${renderWorkflowV2NodeLibrary(view)}
          </section>
          <section>
            <h2>Mode</h2>
            <div class="workflow-v2-mode" aria-label="Agent Workflow editor mode">
              <span class="${view.editorMode === "simple" ? "selected" : ""}">Simple</span>
              <span class="${view.editorMode === "advanced" ? "selected" : ""}">Advanced</span>
            </div>
          </section>
        </div>
        <div class="graph-canvas workflow-v2-canvas" data-testid="workflow-v2-canvas">
          ${renderWorkflowV2CanvasBody(view)}
        </div>
        <div class="workflow-config-resize-handle" data-testid="workflow-config-resize-handle" role="separator" tabindex="0" aria-label="Resize Agent Workflow V2 panel" aria-orientation="vertical" aria-valuemin="${WORKFLOW_CONFIG_PANEL_MIN_WIDTH}" aria-valuemax="${WORKFLOW_CONFIG_PANEL_MAX_WIDTH}" aria-valuenow="${workflowConfigPanelWidth()}"></div>
        <div class="node-config" data-testid="workflow-v2-node-config">
          <section class="node-config-section basic-info">
            <h2>Basic Info</h2>
            <div class="node-config-meta"><div><span>Schema</span><strong>${view.schemaVersion}</strong></div><div><span>Draft</span><strong>${view.draft.revision}</strong></div></div>
            ${selectedNode ? `<div class="node-config-meta"><div><span>ID</span><strong>${escapeHtml(selectedNode.id)}</strong></div><div><span>Type</span><strong>${escapeHtml(selectedNode.type)}</strong></div></div>` : "<p class=\"muted\">Select a V2 node.</p>"}
          </section>
          <section class="node-config-section node-config-fields">
            <h2>Inspector</h2>
            ${renderWorkflowV2Inspector(view, selectedNode)}
          </section>
          <section class="node-config-section graph-preview-section">
            <h2>Validation</h2>
            ${view.validationPanel.issues.length === 0 ? "<p>No validation issues.</p>" : view.validationPanel.issues.map((issue) => `<p>${escapeHtml(issue.message ?? issue.code ?? "Validation issue")}</p>`).join("")}
          </section>
        </div>
      </div>
      ${renderWorkflowV2BottomPanel(view)}
    </section>
  `;
}

function renderWorkflowV2CanvasBody(view) {
  return `
    <div class="graph-canvas-viewport">
      <div class="graph-canvas-content">
        ${renderWorkflowV2Edges(view)}
        ${view.canvas.nodes.length === 0 ? "<p class=\"workflow-v2-empty\">Drop or add an Agent node to start.</p>" : view.canvas.nodes.map((node) => `
          <div class="workflow-v2-node-wrap" style="left:${node.position.x}px;top:${node.position.y}px">
            <button type="button" data-action="select-workflow-v2-node" data-node-id="${escapeAttr(node.id)}" data-run-status="${escapeAttr(node.runStatus)}" class="graph-node workflow-v2-node run-status-${escapeAttr(node.runStatus)} ${view.nodeConfig.selectedNodeId === node.id ? "selected" : ""}" title="${escapeAttr(node.id)}">
              ${escapeHtml(node.type)}<small>${escapeHtml(node.id)}</small><span data-testid="workflow-v2-node-status-${escapeAttr(node.id)}" class="workflow-v2-node-status">${escapeHtml(workflowRunStatusLabel(node.runStatus))}</span>
            </button>
            ${renderWorkflowV2Handles(node)}
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function renderWorkflowV2BottomPanel(view) {
  const activeTab = state.workflowV2ActiveBottomTab;
  const open = state.workflowV2BottomPanelOpen;
  const run = view.runPanel;
  return `
      <section class="workflow-v2-bottom-panel ${open ? "open" : "closed"}" data-testid="workflow-v2-bottom-panel">
      <div class="workflow-v2-bottom-tabs" role="tablist" aria-label="Workflow bottom panel">
        <button type="button" role="tab" class="workflow-v2-bottom-tab ${open && activeTab === "run" ? "active" : ""}" data-action="toggle-workflow-v2-bottom-tab" data-bottom-tab="run" data-testid="workflow-v2-bottom-tab-run" aria-selected="${open && activeTab === "run"}">Run</button>
        <button type="button" role="tab" class="workflow-v2-bottom-tab ${open && activeTab === "execution-trace" ? "active" : ""}" data-action="toggle-workflow-v2-bottom-tab" data-bottom-tab="execution-trace" data-testid="workflow-v2-bottom-tab-execution-trace" aria-selected="${open && activeTab === "execution-trace"}">Execution Trace</button>
        <button type="button" role="tab" class="workflow-v2-bottom-tab ${open && activeTab === "edge-relations" ? "active" : ""}" data-action="toggle-workflow-v2-bottom-tab" data-bottom-tab="edge-relations" data-testid="workflow-v2-bottom-tab-edge-relations" aria-selected="${open && activeTab === "edge-relations"}">Edge Relations</button>
      </div>
      ${open ? `<div class="workflow-v2-bottom-content" data-testid="workflow-v2-bottom-content">
        ${activeTab === "run"
          ? renderWorkflowV2RunPanel(view)
          : activeTab === "execution-trace"
          ? (run?.nodeExecutionDetails?.length ? renderWorkflowV2ExecutionTrace(run) : `<section class="workflow-v2-execution-trace" data-testid="workflow-v2-execution-trace"><h3>Execution Trace</h3><p class="muted">Run the workflow to view node execution details.</p></section>`)
          : renderWorkflowV2EdgeControls(view)}
      </div>` : ""}
    </section>
  `;
}

function renderWorkflowV2RunPanel(view) {
  const versions = view.toolbar.versions ?? [];
  const run = view.runPanel;
  const running = run?.status === "running";
  const output = run?.output === null || run?.output === undefined
    ? null
    : typeof run.output === "object" ? JSON.stringify(run.output, null, 2) : String(run.output);
  return `
    <section class="workflow-v2-run-panel" data-testid="workflow-v2-run-panel">
      <section class="workflow-v2-run-section" data-testid="workflow-v2-workflow-input">
        <h3>Workflow Input</h3>
        <label data-testid="workflow-v2-workflow-run-input-label">Workflow Input<textarea data-testid="workflow-v2-run-input" rows="3">${escapeHtml(state.workflowTestInput)}</textarea></label>
        <div class="workflow-v2-run-actions">
          <button type="button" data-action="run-workflow-v2" data-testid="workflow-v2-run-submit" ${running ? "disabled" : ""}>${running ? "Running…" : "Run"}</button>
          <span class="workflow-v2-run-meta">Latest version: ${versions.length ? escapeHtml(versions[versions.length - 1].version ?? versions[versions.length - 1].id) : "Not published"}</span>
        </div>
      </section>
      <section class="workflow-v2-run-section workflow-v2-run-output" data-testid="workflow-v2-workflow-output">
        <div class="workflow-v2-run-output-header"><h3>Workflow Output</h3>${run ? `<span class="run-status-${escapeAttr(run.status)}" aria-live="polite">${escapeHtml(workflowRunStatusLabel(run.status))}</span>` : ""}</div>
        ${output !== null ? `<pre data-testid="workflow-v2-run-output">${escapeHtml(output)}</pre>` : `<p class="muted">${running ? "Workflow is running…" : run?.error ? "No output was produced." : "Run the workflow to view output."}</p>`}
        ${run?.streamStatus ? `<p class="workflow-v2-run-meta" aria-live="polite">Stream: ${escapeHtml(run.streamStatus)}</p>` : ""}
        ${run?.error ? `<p class="message-error" role="alert">${escapeHtml(run.error.message ?? run.error)}</p>` : ""}
      </section>
    </section>
  `;
}

function renderWorkflowV2ExecutionTrace(run) {
  const details = run.nodeExecutionDetails ?? [];
  const selected = run.selectedNodeExecution;
  return `
    <section class="workflow-v2-execution-trace" data-testid="workflow-v2-execution-trace">
      <h3>Execution Trace</h3>
      <ol class="workflow-v2-execution-list">
        ${details.map((node) => `
          <li>
            <button type="button" data-testid="workflow-v2-execution-row" data-action="select-workflow-v2-run-node" data-node-id="${escapeAttr(node.nodeId)}" class="workflow-v2-execution-row ${selected?.nodeId === node.nodeId ? "selected" : ""}">
              <span>#${node.order} ${escapeHtml(node.nodeId)}</span>
              <strong class="run-status-${escapeAttr(node.status)}">${escapeHtml(workflowRunStatusLabel(node.status))}</strong>
              ${node.durationMs === null ? "" : `<small>${escapeHtml(`${node.durationMs} ms`)}</small>`}
            </button>
          </li>
        `).join("")}
      </ol>
      ${selected ? renderWorkflowV2NodeExecution(selected) : "<p class=\"muted\">Select a Node to inspect its execution.</p>"}
    </section>
  `;
}

function renderWorkflowV2NodeExecution(node) {
  const conditionResult = node.output && typeof node.output === "object" && !Array.isArray(node.output) && node.output.branch && node.output.target
    ? `<p data-testid="workflow-v2-selected-edge"><strong>Selected Edge</strong> ${escapeHtml(`${node.output.branch} -> ${node.output.target}`)}</p>`
    : "";
  return `
    <article class="workflow-v2-node-execution" data-testid="workflow-v2-node-execution-${escapeAttr(node.nodeId)}">
      <header><strong>Node: ${escapeHtml(node.nodeId)}</strong><span class="run-status-${escapeAttr(node.status)}">${escapeHtml(workflowRunStatusLabel(node.status))}</span></header>
      ${node.durationMs === null ? "" : `<p>Duration: ${escapeHtml(`${node.durationMs} ms`)}</p>`}
      ${renderWorkflowV2RunPayload("Input", node.input, "workflow-v2-node-input")}
      ${renderWorkflowV2RunPayload("Output", node.output, "workflow-v2-node-output")}
      ${conditionResult}
      ${renderWorkflowV2ToolSteps(node.steps)}
      ${node.error ? `<section class="workflow-v2-run-error" data-testid="workflow-v2-node-error"><h4>Error</h4><pre>${escapeHtml(JSON.stringify(node.error, null, 2))}</pre></section>` : ""}
    </article>
  `;
}

function renderWorkflowV2RunPayload(title, value, testId) {
  if (value === null || value === undefined) {
    return `<section class="workflow-v2-run-payload" data-testid="${testId}"><h4>${title}</h4><p class="muted">Not available</p></section>`;
  }
  const complex = typeof value === "object";
  const content = complex ? JSON.stringify(value, null, 2) : String(value);
  if (!complex && content.length <= 240) {
    return `<section class="workflow-v2-run-payload" data-testid="${testId}"><h4>${title}</h4><code>${escapeHtml(content)}</code></section>`;
  }
  return `<section class="workflow-v2-run-payload" data-testid="${testId}"><details><summary>${title}</summary><pre>${escapeHtml(content)}</pre></details></section>`;
}

function renderWorkflowV2ToolSteps(steps) {
  const toolSteps = (steps ?? []).filter((step) => step.type === "tool_call" || step.type === "tool_result");
  if (toolSteps.length === 0) return "";
  return `
    <section class="workflow-v2-run-tools" data-testid="workflow-v2-node-tools">
      <h4>Tool</h4>
      ${toolSteps.map((step) => `<details><summary>${escapeHtml(step.type === "tool_call" ? `Call ${step.name ?? "tool"}` : `Result ${step.name ?? "tool"}`)}</summary><pre>${escapeHtml(JSON.stringify(step.type === "tool_call" ? { arguments: step.arguments ?? {} } : { result: step.data ?? null, error: step.error ?? null }, null, 2))}</pre></details>`).join("")}
    </section>
  `;
}

function workflowRunStatusLabel(status) {
  return {
    pending: "Pending",
    running: "Running",
    succeeded: "Success",
    success: "Success",
    failed: "Failed",
    skipped: "Skipped",
  }[status] ?? String(status ?? "Pending");
}

function renderWorkflowV2Edges(view) {
  const nodesById = new Map(view.canvas.nodes.map((node) => [node.id, node]));
  const lines = view.canvas.edges.map((edge) => {
    const source = nodesById.get(edge.source);
    const target = nodesById.get(edge.target);
    const start = source ? { x: source.position.x + 148, y: source.position.y + 34 } : { x: 20, y: (target?.position.y ?? 20) + 34 };
    const end = target ? { x: target.position.x, y: target.position.y + 34 } : { x: (source?.position.x ?? 20) + 210, y: (source?.position.y ?? 20) + 34 };
    const fallbackPath = `M ${Math.round(start.x)} ${Math.round(start.y)} L ${Math.round(end.x)} ${Math.round(end.y)}`;
    const labelX = edge.labelPosition?.x ?? Math.round((start.x + end.x) / 2);
    const labelY = edge.labelPosition?.y ?? Math.round((start.y + end.y) / 2) - 6;
    return `
      <g data-edge-id="${escapeAttr(edge.id)}">
        <path d="${escapeAttr(edge.path ?? fallbackPath)}" marker-end="${escapeAttr(edge.markerEnd ?? "url(#workflow-v2-arrowhead)")}" class="workflow-v2-edge-path"></path>
        <text x="${labelX}" y="${labelY}">${escapeHtml(edge.label ?? "")}</text>
      </g>
    `;
  }).join("");
  return `
    <svg class="workflow-v2-edge-layer" data-testid="workflow-v2-edge-layer" aria-hidden="true">
      <defs>
        <marker id="workflow-v2-arrowhead" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto" markerUnits="strokeWidth">
          <path d="M 0 0 L 8 4 L 0 8 z" class="workflow-v2-arrowhead-shape"></path>
        </marker>
      </defs>
      ${lines}
    </svg>
  `;
}

function renderWorkflowV2Handles(node) {
  const outputs = node.handles?.outputs ?? [];
  return `
    <div class="workflow-v2-handle-list">
      ${outputs.map((handle) => `
        <button type="button" class="workflow-v2-handle" data-action="connect-workflow-v2-edge-from-handle" data-source-id="${escapeAttr(node.id)}" data-source-handle="${escapeAttr(handle.id)}" title="Connect ${escapeAttr(handle.label)} from ${escapeAttr(node.id)}" aria-label="Connect ${escapeAttr(handle.label)} from ${escapeAttr(node.id)}">
          ${escapeHtml(handle.label || "out")}
        </button>
      `).join("")}
    </div>
  `;
}

function renderWorkflowV2EdgeControls(view) {
  const sources = view.edgeConfig?.sources ?? [];
  const targets = view.edgeConfig?.targets ?? [];
  const defaultSource = view.nodeConfig.selectedNodeId ?? sources[0]?.id ?? "START";
  const source = sources.find((item) => item.id === defaultSource) ?? sources[0] ?? null;
  const defaultHandle = source?.handles?.[0]?.id ?? "";
  const defaultTarget = targets.find((item) => item.id !== defaultSource)?.id ?? targets[0]?.id ?? "END";
  return `
    <div class="workflow-v2-edge-panel" data-testid="workflow-v2-edge-panel">
      <div class="workflow-v2-edge-form">
        <label>Source<select data-testid="workflow-v2-edge-source">${sources.map((item) => `<option value="${escapeAttr(item.id)}" ${item.id === defaultSource ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}</select></label>
        <label>Handle<input data-testid="workflow-v2-edge-handle" value="${escapeAttr(defaultHandle)}" placeholder="success / branch"></label>
        <label>Target<select data-testid="workflow-v2-edge-target">${targets.map((item) => `<option value="${escapeAttr(item.id)}" ${item.id === defaultTarget ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}</select></label>
        <button type="button" class="secondary" data-action="connect-workflow-v2-edge">Connect</button>
      </div>
      <div class="workflow-v2-edge-list">
        ${(view.edgeConfig?.edges ?? []).map((edge) => `
          <div class="workflow-v2-edge-row" data-edge-id="${escapeAttr(edge.id)}">
            <select aria-label="Edge source" data-workflow-v2-edge-field="source" data-edge-id="${escapeAttr(edge.id)}">${sources.map((item) => `<option value="${escapeAttr(item.id)}" ${item.id === edge.source ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}</select>
            <input aria-label="Edge handle" data-workflow-v2-edge-field="sourceHandle" data-edge-id="${escapeAttr(edge.id)}" value="${escapeAttr(edge.sourceHandle ?? "")}" placeholder="success">
            <select aria-label="Edge target" data-workflow-v2-edge-field="target" data-edge-id="${escapeAttr(edge.id)}">${targets.map((item) => `<option value="${escapeAttr(item.id)}" ${item.id === edge.target ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}</select>
            <button type="button" class="icon-button" data-action="delete-workflow-v2-edge" data-edge-id="${escapeAttr(edge.id)}" aria-label="Delete edge">X</button>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function renderWorkflowV2Inspector(view, selectedNode) {
  if (!selectedNode) {
    return "<p class=\"muted\">No node selected.</p>";
  }
  const config = view.nodeConfig.value ?? selectedNode.config ?? {};
  if (selectedNode.type === "agent") {
    return `
      <label>Name<input data-testid="workflow-v2-agent-name" value="${escapeAttr(config.name ?? "")}"></label>
      <label>Description<textarea data-testid="workflow-v2-agent-description" rows="3">${escapeHtml(config.description ?? "")}</textarea></label>
      <label data-testid="workflow-v2-agent-goal">Goal<textarea data-testid="workflow-v2-agent-instruction" rows="6">${escapeHtml(config.instruction ?? "")}</textarea></label>
      ${renderWorkflowV2AgentInputBindings(view)}
      ${renderWorkflowV2OutputSchemaBuilder(view)}
      ${renderWorkflowV2ToolPolicy(view)}
      ${renderWorkflowV2BranchSummary(view)}
    `;
  }
  if (selectedNode.type === "condition") {
    return renderWorkflowV2ConditionInspector(view);
  }
  if (selectedNode.type === "end") {
    return renderWorkflowV2EndInspector(view);
  }
  if (selectedNode.type === "workflow") {
    return renderWorkflowV2WorkflowInspector(view);
  }
  return view.nodeConfig.visibleGroups.length === 0
    ? "<p class=\"muted\">No editable fields.</p>"
    : view.nodeConfig.visibleGroups.map((group) => `<p>${escapeHtml(group.label ?? group.id)}</p>`).join("");
}

function renderWorkflowV2AgentInputBindings(view) {
  const inspector = view.nodeConfig.agentInputInspector;
  if (!inspector) return "";
  const schemaView = inspector.schemaBuilder ?? { fields: [] };
  return `
    <section class="workflow-v2-inspector-block" data-testid="workflow-v2-agent-input-bindings">
      <h3>Inputs</h3>
      <div class="workflow-v2-schema-fields">
        ${(schemaView.fields ?? []).map((field) => `<span>${escapeHtml(field.name ?? "")}: ${escapeHtml(field.type ?? "string")}${field.required ? " required" : ""}</span>`).join("") || "<span>No input fields</span>"}
      </div>
      <div class="workflow-v2-inline-form">
        <input data-testid="workflow-v2-input-field-name" placeholder="field">
        <select data-testid="workflow-v2-input-field-type">
          <option value="string">string</option>
          <option value="number">number</option>
          <option value="integer">integer</option>
          <option value="boolean">boolean</option>
          <option value="array">array</option>
          <option value="object">object</option>
        </select>
        <label class="workflow-v2-check"><input type="checkbox" data-testid="workflow-v2-input-field-required">Required</label>
        <button type="button" class="secondary" data-action="add-workflow-v2-input-field">Add</button>
      </div>
      ${inspector.inputMappings.map((mapping) => renderWorkflowV2AgentInputMapping(mapping)).join("")}
    </section>
  `;
}

function renderWorkflowV2AgentInputMapping(mapping) {
  const binding = mapping.binding ?? {};
  const bindingKind = workflowV2BindingKind(binding);
  const nodeOptions = (mapping.sourceOptions ?? []).filter((option) => option.kind === "nodeOutput");
  const workflowOptions = (mapping.sourceOptions ?? []).filter((option) => option.kind === "workflowInput");
  const selectedNodeOutput = bindingKind === "node_output" ? `${binding.nodeId}|${(binding.path ?? []).join(".")}` : "";
  const selectedWorkflowInput = bindingKind === "workflow_input" ? (binding.path ?? []).join(".") : "";
  return `
    <div class="workflow-v2-agent-input-row" data-testid="workflow-v2-agent-input-${escapeAttr(mapping.name)}">
      <div class="workflow-v2-agent-input-label"><strong>${escapeHtml(mapping.name)}</strong><small>${escapeHtml(mapping.type)}${mapping.required ? " required" : ""}</small></div>
      <select data-workflow-v2-agent-input-source data-input-name="${escapeAttr(mapping.name)}" data-testid="workflow-v2-agent-input-${escapeAttr(mapping.name)}-source">
        <option value="" ${bindingKind ? "" : "selected"}>Select source</option>
        <option value="workflow_input" ${bindingKind === "workflow_input" ? "selected" : ""} ${workflowOptions.length ? "" : "disabled"}>Workflow Input</option>
        <option value="node_output" ${bindingKind === "node_output" ? "selected" : ""} ${nodeOptions.length ? "" : "disabled"}>Upstream Node Output</option>
        <option value="constant" ${bindingKind === "constant" ? "selected" : ""}>Constant</option>
      </select>
      ${bindingKind === "workflow_input" ? `<select data-workflow-v2-agent-input-workflow data-input-name="${escapeAttr(mapping.name)}" data-testid="workflow-v2-agent-input-${escapeAttr(mapping.name)}-workflow">${workflowOptions.map((option) => `<option value="${escapeAttr(option.path.join("."))}" ${option.path.join(".") === selectedWorkflowInput ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}</select>` : ""}
      ${bindingKind === "node_output" ? `<select data-workflow-v2-agent-input-node data-input-name="${escapeAttr(mapping.name)}" data-testid="workflow-v2-agent-input-${escapeAttr(mapping.name)}-node">${nodeOptions.map((option) => { const value = `${option.nodeId}|${option.path.join(".")}`; return `<option value="${escapeAttr(value)}" ${value === selectedNodeOutput ? "selected" : ""}>${escapeHtml(option.label)}</option>`; }).join("")}</select>` : ""}
      ${bindingKind === "constant" ? `<input data-workflow-v2-agent-input-constant data-input-name="${escapeAttr(mapping.name)}" data-value-type="${escapeAttr(mapping.type)}" data-testid="workflow-v2-agent-input-${escapeAttr(mapping.name)}-constant" value="${escapeAttr(workflowV2ConstantInputValue(binding.value))}" />` : ""}
    </div>
  `;
}

function workflowV2BindingKind(binding) {
  const kind = binding?.kind ?? binding?.type ?? "";
  if (kind === "workflowInput" || kind === "workflow_input") return "workflow_input";
  if (kind === "nodeOutput" || kind === "node_output") return "node_output";
  if (kind === "constant" || kind === "literal") return "constant";
  return "";
}

function workflowV2ConstantInputValue(value) {
  if (value === undefined || value === null) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function workflowV2ConstantValue(rawValue, type) {
  if (type === "number") return rawValue === "" ? null : Number(rawValue);
  if (type === "integer") return rawValue === "" ? null : Number.parseInt(rawValue, 10);
  if (type === "boolean") return rawValue === "true";
  if (type === "object" || type === "array") {
    try { return JSON.parse(rawValue); } catch { return rawValue; }
  }
  return rawValue;
}

function renderWorkflowV2BranchSummary(view) {
  const edges = view.nodeConfig.branchNext ?? [];
  return `
    <section class="workflow-v2-inspector-block" data-testid="workflow-v2-agent-branch-summary">
      <h3>Branch / Next</h3>
      ${edges.length
        ? edges.map((edge) => `<p><span>${escapeHtml(edge.label)}</span> -> <strong>${escapeHtml(edge.target)}</strong></p>`).join("")
        : "<p class=\"muted\">No outgoing edge.</p>"}
    </section>
  `;
}

function renderWorkflowV2OutputSchemaBuilder(view) {
  const schemaView = view.nodeConfig.schemaBuilder ?? { fields: [] };
  return `
    <section class="workflow-v2-inspector-block" data-testid="workflow-v2-output-schema-builder">
      <h3>Output Schema</h3>
      <div class="workflow-v2-schema-fields">
        ${(schemaView.fields ?? []).map((field) => `<span>${escapeHtml(field.name ?? field.path?.join(".") ?? "")}: ${escapeHtml(field.type ?? "string")}${field.required ? " required" : ""}</span>`).join("") || "<span>No fields</span>"}
      </div>
      <div class="workflow-v2-inline-form">
        <input data-testid="workflow-v2-output-field-name" placeholder="field">
        <select data-testid="workflow-v2-output-field-type">
          <option value="string">string</option>
          <option value="number">number</option>
          <option value="enum">enum</option>
          <option value="boolean">boolean</option>
          <option value="array">array</option>
          <option value="object">object</option>
        </select>
        <label class="workflow-v2-check"><input type="checkbox" data-testid="workflow-v2-output-field-required">Required</label>
        <input data-testid="workflow-v2-output-field-enum" placeholder="enum: a,b">
        <button class="secondary" data-action="add-workflow-v2-output-field">Add</button>
      </div>
    </section>
  `;
}

function renderWorkflowV2ToolPolicy(view) {
  const selector = view.nodeConfig.toolSelector ?? { policy: { mode: "disabled" }, catalog: [], workflowTools: [] };
  const policy = selector.policy ?? { mode: "disabled" };
  const workflowSelected = new Set(view.workflowTools?.selectedIds ?? []);
  const allowed = new Set(policy.allowedTools ?? []);
  return `
    <section class="workflow-v2-inspector-block" data-testid="workflow-v2-tool-policy">
      <h3>Tools</h3>
      <label>Mode<select data-testid="workflow-v2-tool-mode">
        ${["disabled", "auto", "required"].map((mode) => `<option value="${mode}" ${policy.mode === mode ? "selected" : ""}>${mode}</option>`).join("")}
      </select></label>
      <div class="workflow-v2-tool-list">
        ${(view.workflowTools?.catalog ?? []).map((tool) => `
          <label class="workflow-v2-check">
            <input type="checkbox" data-workflow-v2-workflow-tool="${escapeAttr(tool.id)}" ${workflowSelected.has(tool.id) ? "checked" : ""}>
            ${escapeHtml(tool.name ?? tool.id)}
          </label>
          <label class="workflow-v2-check">
            <input type="checkbox" data-workflow-v2-agent-tool="${escapeAttr(tool.id)}" ${allowed.has(tool.id) ? "checked" : ""}>
            Agent
          </label>
        `).join("") || "<p class=\"muted\">No tools loaded.</p>"}
      </div>
    </section>
  `;
}

function renderWorkflowV2ConditionInspector(view) {
  const inspector = view.nodeConfig.conditionInspector ?? { branches: [], fields: [], targetNodes: [], operatorOptions: [] };
  const fieldOptions = inspector.fields ?? [];
  const targetOptions = inspector.targetNodes ?? [];
  const defaultTarget = edgeTargetForHandle(view, "default");
  return `
    <section class="workflow-v2-inspector-block" data-testid="workflow-v2-condition-inspector">
      <h3>Branches</h3>
      ${(inspector.branches ?? []).map((branch) => `<p>${escapeHtml(branch.handle ?? "")} -> ${escapeHtml(edgeTargetForHandle(view, branch.handle) ?? branch.target ?? "Not connected")}</p>`).join("") || "<p class=\"muted\">No branches.</p>"}
      <p data-testid="workflow-v2-condition-default-branch">default -> ${escapeHtml(defaultTarget ?? "Not connected")}</p>
      <div class="workflow-v2-inline-form">
        <label>Branch Handle<input aria-label="Branch handle" data-testid="workflow-v2-condition-branch-handle" placeholder="technical / business"></label>
        <select data-testid="workflow-v2-condition-source-field">${fieldOptions.map((field) => `<option value="${escapeAttr(`${field.nodeId}:${field.path.join(".")}`)}">${escapeHtml(`${field.nodeId}.${field.path.join(".")} (${field.type})`)}</option>`).join("")}</select>
        <select data-testid="workflow-v2-condition-operator">${(inspector.operatorOptions ?? []).map((operator) => `<option value="${escapeAttr(operator.value)}">${escapeHtml(operator.label)}</option>`).join("")}</select>
        <input data-testid="workflow-v2-condition-value" placeholder="value">
        <select data-testid="workflow-v2-condition-target">${targetOptions.map((node) => `<option value="${escapeAttr(node.id)}">${escapeHtml(node.label)}</option>`).join("")}</select>
        <button class="secondary" data-action="add-workflow-v2-condition-branch">Add Branch</button>
      </div>
    </section>
  `;
}

function renderWorkflowV2EndInspector(view) {
  const inspector = view.nodeConfig.endInspector ?? { binding: {}, dataSources: [] };
  const data = inspector.binding?.data;
  const dataLabel = data?.kind === "nodeOutput"
    ? `${data.nodeId}.${Array.isArray(data.path) ? data.path.join(".") : ""}`
    : "none";
  return `
    <section class="workflow-v2-inspector-block" data-testid="workflow-v2-end-inspector">
      <h3>Final Result</h3>
      <label>Message
        <select data-testid="workflow-v2-end-message-mode" disabled>
          <option value="${escapeAttr(inspector.binding?.message?.mode ?? "lastVisibleAssistant")}">${escapeHtml(inspector.binding?.message?.mode ?? "lastVisibleAssistant")}</option>
        </select>
      </label>
      <label>Artifacts
        <select data-testid="workflow-v2-end-artifacts-mode" disabled>
          <option value="${escapeAttr(inspector.binding?.artifacts?.mode ?? "allVisible")}">${escapeHtml(inspector.binding?.artifacts?.mode ?? "allVisible")}</option>
        </select>
      </label>
      <label>Structured Data
        <select data-testid="workflow-v2-end-data-source" disabled>
          <option value="${escapeAttr(dataLabel)}">${escapeHtml(dataLabel)}</option>
        </select>
      </label>
    </section>
  `;
}

function renderWorkflowV2WorkflowInspector(view) {
  const inspector = view.nodeConfig.workflowInspector ?? { workflowOptions: [], versionOptions: [], messageContextOptions: [], inputMappings: [] };
  return `
    <section class="workflow-v2-inspector-block" data-testid="workflow-v2-workflow-inspector">
      <h3>Workflow Ref</h3>
      <label>Workflow
        <select data-testid="workflow-v2-workflow-ref-id" disabled>
          ${(inspector.workflowOptions ?? []).length
            ? inspector.workflowOptions.map((workflow) => `<option value="${escapeAttr(workflow.id)}" ${workflow.id === inspector.workflowId ? "selected" : ""}>${escapeHtml(workflow.name ?? workflow.id)}</option>`).join("")
            : `<option value="">None</option>`}
        </select>
      </label>
      <label>Version
        <select data-testid="workflow-v2-workflow-ref-version" disabled>
          ${(inspector.versionOptions ?? []).length
            ? inspector.versionOptions.map((version) => `<option value="${escapeAttr(version.version ?? "")}" ${version.version === inspector.version ? "selected" : ""}>${escapeHtml(version.label ?? `v${version.version}`)}</option>`).join("")
            : `<option value="">Unpublished</option>`}
        </select>
      </label>
      <label>Message Context
        <select data-testid="workflow-v2-workflow-context-mode" disabled>
          ${(inspector.messageContextOptions ?? []).map((option) => `<option value="${escapeAttr(option.value)}" ${option.value === inspector.messageContextMode ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
        </select>
      </label>
      <div class="workflow-v2-schema-fields">
        ${(inspector.inputMappings ?? []).map((mapping) => `<span>${escapeHtml(mapping.name)}: ${escapeHtml(mapping.type)}</span>`).join("") || "<span>No input mapping fields</span>"}
      </div>
    </section>
  `;
}

function edgeTargetForHandle(view, handle) {
  return view.canvas.edges.find((edge) => edge.source === view.nodeConfig.selectedNodeId && (edge.sourceHandle ?? "") === String(handle ?? ""))?.target
    ?? null;
}

function renderWorkflowV2NodeLibrary(view) {
  const items = view.nodeLibrary.items.filter((item) => AGENT_WORKFLOW_V2_NODE_TYPES.includes(item.type));
  return items.map((item) => `<button data-action="add-workflow-v2-node" data-node-type="${escapeAttr(item.type)}">${escapeHtml(item.type.toUpperCase())}</button>`).join("");
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
  const fields = workflowVisibleConfigFields(node.type);
  if (!fields.length) return `<p class="muted">No configurable fields.</p>`;
  return fields.map((field) => renderWorkflowConfigField(node, field)).join("");
}

function renderWorkflowConfigField(node, field) {
  const path = field.path;
  if (field.binding) {
    return renderWorkflowBindingField(node, field);
  }
  const value = workflowConfigInputValue(node.config?.[path], path);
  const requiredLabel = field.required ? ` <span class="workflow-config-required" aria-label="Required">*</span>` : "";
  const label = `<span class="workflow-config-label">${escapeHtml(workflowConfigLabel(field))}${requiredLabel}</span>`;
  const placeholder = ` placeholder="${escapeAttr(field.example ?? "")}"`;
  const required = field.required ? " required" : "";
  const readonly = field.editable === false ? " readonly" : "";
  const disabled = field.editable === false ? " disabled" : "";
  if (node.type === "tool" && path === "tool_name" && state.workflowToolCatalog.length) {
    return `
      <label class="config-field">${label}
        <select data-workflow-config-path="${escapeAttr(path)}" data-testid="workflow-config-${escapeAttr(path)}"${required}${disabled}>
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
      <label class="config-field">${label}
        <select data-workflow-config-path="${escapeAttr(path)}" data-testid="workflow-config-${escapeAttr(path)}"${required}${disabled}>
          <option value="">Select operator</option>
          ${operators.map((operator) => `<option value="${operator}" ${operator === value ? "selected" : ""}>${operator}</option>`).join("")}
        </select>
      </label>
    `;
  }
  const multiline = WORKFLOW_JSON_CONFIG_FIELDS.has(path) || path === "template" || path === "prompt" || path === "system_prompt";
  if (multiline) {
    return `<label class="config-field config-field-wide">${label}<textarea data-workflow-config-path="${escapeAttr(path)}" data-testid="workflow-config-${escapeAttr(path)}" rows="3"${placeholder}${required}${readonly}>${escapeHtml(value)}</textarea></label>`;
  }
  const type = WORKFLOW_NUMBER_CONFIG_FIELDS.has(path) ? "number" : "text";
  const step = path === "temperature" ? ` step="0.1" min="0" max="2"` : "";
  return `<label class="config-field">${label}<input type="${type}"${step} data-workflow-config-path="${escapeAttr(path)}" data-testid="workflow-config-${escapeAttr(path)}" value="${escapeAttr(value)}"${placeholder}${required}${readonly} /></label>`;
}

function renderWorkflowBindingField(node, field) {
  const requiredLabel = field.required ? ` <span class="workflow-config-required" aria-label="Required">*</span>` : "";
  const label = `<span class="workflow-config-label">${escapeHtml(workflowConfigLabel(field))}${requiredLabel}</span>`;
  if (field.binding === "template_variables") {
    const variables = workflowTemplateVariables(node.config?.[field.sourceField]);
    if (!variables.length) {
      return `<div class="config-field config-field-wide workflow-binding-field">${label}<p class="muted">No template variables found.</p></div>`;
    }
    const mapping = isPlainObject(node.config?.[field.path]) ? node.config[field.path] : {};
    return `
      <div class="config-field config-field-wide workflow-binding-field">
        ${label}
        ${variables.map((name) => renderWorkflowReferenceControls(node, field.path, name, mapping[name], { label: name, required: true })).join("")}
      </div>
    `;
  }
  if (field.binding === "tool_args") {
    const tool = selectedWorkflowTool(node);
    if (!tool) {
      return `<div class="config-field config-field-wide workflow-binding-field">${label}<p class="muted">Select a tool to configure its arguments.</p></div>`;
    }
    const args = isPlainObject(node.config?.args) ? node.config.args : {};
    const fields = workflowToolArgumentFields(tool, args);
    if (!fields.length) {
      return `<div class="config-field config-field-wide workflow-binding-field">${label}<p class="muted">This tool does not define arguments.</p></div>`;
    }
    return `
      <div class="config-field config-field-wide workflow-binding-field">
        ${label}
        ${fields.map((arg) => renderWorkflowReferenceControls(node, "args", arg.name, args[arg.name], arg)).join("")}
      </div>
    `;
  }
  return `
    <div class="config-field config-field-wide workflow-binding-field">
      ${label}
      ${renderWorkflowReferenceControls(node, field.path, "", node.config?.[field.path], { label: workflowConfigLabel(field), required: field.required })}
    </div>
  `;
}

function renderWorkflowReferenceControls(node, fieldPath, key, value, options = {}) {
  const reference = workflowReferenceFromValue(node, value);
  const group = workflowBindingGroupId(fieldPath, key);
  const keyAttr = escapeAttr(key ?? "");
  const outputOptions = workflowAvailableOutputOptions(node.id);
  const selectedOutput = reference.type === "node_output" ? `${reference.nodeId}:${reference.port}` : (outputOptions[0]?.value ?? "");
  const sourceLabel = options.label ?? key ?? fieldPath;
  const requiredLabel = options.required ? ` <span class="workflow-config-required" aria-label="Required">*</span>` : "";
  const valueType = options.type ?? "string";
  return `
    <div class="workflow-binding-row" data-workflow-binding-group="${escapeAttr(group)}">
      <div class="workflow-binding-head">
        <span class="workflow-config-label">${escapeHtml(sourceLabel)}${requiredLabel}</span>
        ${valueType ? `<small>${escapeHtml(valueType)}</small>` : ""}
      </div>
      <div class="workflow-binding-grid">
        <select data-workflow-binding-control data-workflow-binding-field="${escapeAttr(fieldPath)}" data-workflow-binding-key="${keyAttr}" data-workflow-binding-part="source" data-testid="workflow-binding-${escapeAttr(fieldPath)}-${keyAttr}-source">
          <option value="workflow_input" ${reference.type === "workflow_input" ? "selected" : ""}>Workflow Input</option>
          <option value="node_output" ${reference.type === "node_output" ? "selected" : ""} ${outputOptions.length ? "" : "disabled"}>Upstream Node Output</option>
          <option value="literal" ${reference.type === "literal" ? "selected" : ""}>Constant</option>
        </select>
        ${reference.type === "workflow_input" ? renderWorkflowInputPicker(fieldPath, key, reference.name) : ""}
        ${reference.type === "node_output" ? renderWorkflowOutputPicker(fieldPath, key, selectedOutput, outputOptions) : ""}
        ${reference.type === "literal" ? renderWorkflowLiteralInput(fieldPath, key, reference.value, valueType) : ""}
      </div>
    </div>
  `;
}

function renderWorkflowInputPicker(fieldPath, key, selectedName) {
  const inputs = [
    { id: "input", label: "User input" },
    { id: "messages", label: "Message history" },
  ];
  return `
    <select data-workflow-binding-control data-workflow-binding-field="${escapeAttr(fieldPath)}" data-workflow-binding-key="${escapeAttr(key ?? "")}" data-workflow-binding-part="workflow-input" data-testid="workflow-binding-${escapeAttr(fieldPath)}-${escapeAttr(key ?? "")}-workflow-input">
      ${inputs.map((input) => `<option value="${escapeAttr(input.id)}" ${input.id === selectedName ? "selected" : ""}>${escapeHtml(input.label)}</option>`).join("")}
    </select>
  `;
}

function renderWorkflowOutputPicker(fieldPath, key, selectedOutput, options) {
  return `
    <select data-workflow-binding-control data-workflow-binding-field="${escapeAttr(fieldPath)}" data-workflow-binding-key="${escapeAttr(key ?? "")}" data-workflow-binding-part="node-output" data-testid="workflow-binding-${escapeAttr(fieldPath)}-${escapeAttr(key ?? "")}-node-output">
      ${options.map((option) => `<option value="${escapeAttr(option.value)}" ${option.value === selectedOutput ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
    </select>
  `;
}

function renderWorkflowLiteralInput(fieldPath, key, value, valueType) {
  return `<input type="${valueType === "number" || valueType === "integer" ? "number" : "text"}" data-workflow-binding-control data-workflow-binding-field="${escapeAttr(fieldPath)}" data-workflow-binding-key="${escapeAttr(key ?? "")}" data-workflow-binding-part="literal" data-workflow-binding-value-type="${escapeAttr(valueType)}" data-testid="workflow-binding-${escapeAttr(fieldPath)}-${escapeAttr(key ?? "")}-literal" value="${escapeAttr(workflowLiteralInputValue(value))}" placeholder="Example value" />`;
}

function workflowBindingGroupId(fieldPath, key = "") {
  return `${fieldPath}:${key}`;
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

function workflowVisibleConfigFields(nodeType) {
  return (WORKFLOW_CONFIG_FIELDS[nodeType] ?? []).filter((field) => field.visibility !== "hidden");
}

function isEditableWorkflowConfigPath(nodeType, path) {
  return workflowVisibleConfigFields(nodeType).some((field) => field.path === path && field.editable !== false);
}

function workflowConfigLabel(field) {
  const path = typeof field === "string" ? field : field.path;
  return (typeof field === "string" ? "" : field.label) || path.split("_").map(titleCase).join(" ");
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

function workflowReferenceValueFromControls(fieldPath, key = "") {
  const source = workflowBindingControl(fieldPath, key, "source")?.value ?? "workflow_input";
  if (source === "node_output") {
    const [nodeId, port] = String(workflowBindingControl(fieldPath, key, "node-output")?.value ?? "").split(":");
    return { type: "node_output", node_id: nodeId, port: port || "out" };
  }
  if (source === "literal") {
    const literal = workflowBindingControl(fieldPath, key, "literal");
    return { type: "literal", value: parseWorkflowLiteralValue(literal?.value ?? "", literal?.dataset.workflowBindingValueType) };
  }
  return { type: "workflow_input", name: workflowBindingControl(fieldPath, key, "workflow-input")?.value ?? "input" };
}

function workflowBindingControl(fieldPath, key, part) {
  return [...document.querySelectorAll("[data-workflow-binding-control]")].find(
    (element) =>
      element.dataset.workflowBindingField === fieldPath &&
      (element.dataset.workflowBindingKey ?? "") === (key ?? "") &&
      element.dataset.workflowBindingPart === part
  );
}

function workflowReferenceFromValue(node, value) {
  if (isPlainObject(value)) {
    if (value.type === "workflow_input") return { type: "workflow_input", name: value.name ?? "input" };
    if (value.type === "node_output") return { type: "node_output", nodeId: value.node_id ?? "", port: value.port ?? "out" };
    if (value.type === "literal") return { type: "literal", value: value.value ?? "" };
    if (value.type === "expression") return workflowReferenceFromStatePath(node, value.value);
  }
  if (typeof value === "string" && value.startsWith("$state.")) {
    return workflowReferenceFromStatePath(node, value);
  }
  if (value !== undefined && value !== null && value !== "") {
    return { type: "literal", value };
  }
  return { type: "workflow_input", name: "input" };
}

function workflowReferenceFromStatePath(node, value) {
  if (value === "$state.input") return { type: "workflow_input", name: "input" };
  if (value === "$state.messages") return { type: "workflow_input", name: "messages" };
  const output = workflowAvailableOutputOptions(node.id).find((option) => option.statePath === value || (option.statePath && value.startsWith(`${option.statePath}.`)));
  if (output) return { type: "node_output", nodeId: output.nodeId, port: output.port };
  return { type: "literal", value };
}

function workflowTemplateVariables(template) {
  const names = [];
  const seen = new Set();
  String(template ?? "").replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, name) => {
    const normalized = String(name).trim();
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      names.push(normalized);
    }
    return "";
  });
  return names;
}

function selectedWorkflowTool(node) {
  const toolName = node.config?.tool_name;
  return state.workflowToolCatalog.find((tool) => tool.id === toolName) ?? null;
}

function workflowToolArgumentFields(tool, currentArgs = {}) {
  const schema = isPlainObject(tool?.input_schema) ? tool.input_schema : {};
  const properties = isPlainObject(schema.properties) ? schema.properties : {};
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const names = [...new Set([...Object.keys(properties), ...Object.keys(currentArgs)])];
  return names.map((name) => {
    const property = isPlainObject(properties[name]) ? properties[name] : {};
    return {
      name,
      label: name,
      required: required.has(name),
      type: property.type ?? "string",
    };
  });
}

function workflowAvailableOutputOptions(targetNodeId) {
  return workflowUpstreamNodes(targetNodeId).flatMap(workflowOutputOptionsForNode);
}

function workflowUpstreamNodes(targetNodeId) {
  const byId = new Map(state.workflowNodes.map((node) => [node.id, node]));
  const incoming = new Map();
  state.workflowEdges.map(normalizeWorkflowEdge).forEach((edge) => {
    if (!incoming.has(edge.target)) incoming.set(edge.target, []);
    incoming.get(edge.target).push(edge.source);
  });
  const seen = new Set();
  const nodes = [];
  const queue = [...(incoming.get(targetNodeId) ?? [])];
  while (queue.length) {
    const id = queue.shift();
    if (!id || id === "START" || id === "END" || seen.has(id)) continue;
    seen.add(id);
    const node = byId.get(id);
    if (node) nodes.push(node);
    queue.push(...(incoming.get(id) ?? []));
  }
  return nodes.reverse();
}

function workflowOutputOptionsForNode(node) {
  const statePath = node.config?.output_key ? `$state.${node.config.output_key}` : "";
  if (node.type === "prompt") {
    return [{ value: `${node.id}:out`, label: `${node.id} / prompt text`, nodeId: node.id, port: "out", statePath }];
  }
  if (node.type === "llm") {
    return [{ value: `${node.id}:response`, label: `${node.id} / response`, nodeId: node.id, port: "response", statePath }];
  }
  if (node.type === "tool") {
    const tool = selectedWorkflowTool(node);
    const properties = isPlainObject(tool?.output_schema?.properties) ? tool.output_schema.properties : {};
    const propertyOptions = Object.keys(properties).map((port) => ({
      value: `${node.id}:${port}`,
      label: `${node.id} / ${port}`,
      nodeId: node.id,
      port,
      statePath: statePath ? `${statePath}.${port}` : "",
    }));
    return [
      ...propertyOptions,
      { value: `${node.id}:result`, label: `${node.id} / full result`, nodeId: node.id, port: "result", statePath },
    ];
  }
  return [];
}

function workflowLiteralInputValue(value) {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  return JSON.stringify(value);
}

function parseWorkflowLiteralValue(value, type) {
  if (type === "number" || type === "integer") {
    const number = Number(value);
    return Number.isFinite(number) ? number : value;
  }
  if (type === "boolean") {
    return value === "true" || value === true;
  }
  return value;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
  bindActionEvents(document);
  document.querySelectorAll("[data-drag-workflow-node-id]").forEach((element) => element.addEventListener("pointerdown", handleWorkflowNodePointerDown));
  const workflowCanvas = document.querySelector("[data-testid='workflow-canvas']");
  workflowCanvas?.addEventListener("wheel", handleWorkflowCanvasWheel, { passive: false });
  workflowCanvas?.addEventListener("pointerdown", handleWorkflowCanvasPointerDown);
  workflowCanvas?.addEventListener("contextmenu", handleWorkflowCanvasContextMenu);
  const workflowConfigResizeHandle = document.querySelector("[data-testid='workflow-config-resize-handle']");
  workflowConfigResizeHandle?.addEventListener("pointerdown", handleWorkflowConfigResizePointerDown);
  workflowConfigResizeHandle?.addEventListener("keydown", handleWorkflowConfigResizeKeyDown);
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
      const path = element.dataset.workflowConfigPath;
      const node = state.workflowNodes.find((item) => item.id === state.workflowSelectedNodeId);
      if (!isEditableWorkflowConfigPath(node?.type, path)) return;
      updateSelectedWorkflowConfig(path, element.value);
    };
    element.addEventListener("input", update);
    element.addEventListener("change", () => {
      update();
      if (["tool_name", "template", "prompt"].includes(element.dataset.workflowConfigPath)) render();
    });
  });
  document.querySelectorAll("[data-workflow-binding-control]").forEach((element) => {
    const fieldPath = element.dataset.workflowBindingField;
    const key = element.dataset.workflowBindingKey ?? "";
    element.addEventListener("input", () => updateSelectedWorkflowBinding(fieldPath, key, { renderAfterUpdate: false }));
    element.addEventListener("change", () => updateSelectedWorkflowBinding(fieldPath, key, { renderAfterUpdate: true }));
  });
  const workflowTestInput = document.querySelector("[data-testid='workflow-test-input']");
  workflowTestInput?.addEventListener("input", () => {
    state.workflowTestInput = workflowTestInput.value;
  });
  bindWorkflowV2RunInputEvents(document);
  const workflowV2AgentInstruction = document.querySelector("[data-testid='workflow-v2-agent-instruction']");
  workflowV2AgentInstruction?.addEventListener("input", () => {
    workflowV2Workbench().updateSelectedAgentConfig({ instruction: workflowV2AgentInstruction.value });
  });
  const workflowV2AgentName = document.querySelector("[data-testid='workflow-v2-agent-name']");
  workflowV2AgentName?.addEventListener("input", () => {
    workflowV2Workbench().updateSelectedAgentConfig({ name: workflowV2AgentName.value });
  });
  const workflowV2AgentDescription = document.querySelector("[data-testid='workflow-v2-agent-description']");
  workflowV2AgentDescription?.addEventListener("input", () => {
    workflowV2Workbench().updateSelectedAgentConfig({ description: workflowV2AgentDescription.value });
  });
  document.querySelectorAll("[data-workflow-v2-agent-input-source]").forEach((element) => {
    element.addEventListener("change", () => updateWorkflowV2AgentInputBinding(element, true));
  });
  document.querySelectorAll("[data-workflow-v2-agent-input-workflow], [data-workflow-v2-agent-input-node]").forEach((element) => {
    element.addEventListener("change", () => updateWorkflowV2AgentInputBinding(element, true));
  });
  document.querySelectorAll("[data-workflow-v2-agent-input-constant]").forEach((element) => {
    element.addEventListener("input", () => updateWorkflowV2AgentInputBinding(element, false));
  });
  document.querySelector("[data-testid='workflow-v2-tool-mode']")?.addEventListener("change", (event) => {
    updateWorkflowV2ToolPolicy({ mode: event.currentTarget.value });
  });
  document.querySelectorAll("[data-workflow-v2-workflow-tool]").forEach((element) => {
    element.addEventListener("change", () => {
      const selected = [...document.querySelectorAll("[data-workflow-v2-workflow-tool]")]
        .filter((input) => input.checked)
        .map((input) => input.dataset.workflowV2WorkflowTool);
      workflowV2Workbench().setWorkflowToolRegistry(selected);
      render();
    });
  });
  document.querySelectorAll("[data-workflow-v2-agent-tool]").forEach((element) => {
    element.addEventListener("change", () => {
      const allowedTools = [...document.querySelectorAll("[data-workflow-v2-agent-tool]")]
        .filter((input) => input.checked)
        .map((input) => input.dataset.workflowV2AgentTool);
      updateWorkflowV2ToolPolicy({ allowedTools });
    });
  });
  bindWorkflowV2EdgeFieldEvents(document);
  const workflowEdgeSource = document.querySelector("#workflow-edge-source");
  workflowEdgeSource?.addEventListener("change", () => {
    state.workflowEdgeSourceId = workflowEdgeSource.value;
    render();
  });
}

function bindActionEvents(root) {
  root.querySelectorAll("[data-action]").forEach((element) => {
    if (element.tagName !== "SELECT") element.addEventListener("click", handleAction);
  });
}

function bindWorkflowV2EdgeFieldEvents(root) {
  root.querySelectorAll("[data-workflow-v2-edge-field]").forEach((element) => {
    element.addEventListener("change", () => {
      try {
        workflowV2Workbench().updateCanvasEdge(element.dataset.edgeId, { [element.dataset.workflowV2EdgeField]: element.value });
        refreshWorkflowV2Canvas();
      } catch (error) {
        state.toast = { tone: "error", text: error.message };
        render();
      }
    });
  });
}

function refreshWorkflowV2Canvas() {
  const canvas = document.querySelector("[data-testid='workflow-v2-canvas']");
  if (!canvas) {
    render();
    return;
  }
  canvas.innerHTML = renderWorkflowV2CanvasBody(workflowV2Workbench().view());
  bindActionEvents(canvas);
  bindWorkflowV2EdgeFieldEvents(canvas);
  refreshWorkflowV2BottomPanel();
}

function refreshWorkflowV2BottomPanel() {
  const panel = document.querySelector("[data-testid='workflow-v2-bottom-panel']");
  if (!panel) return;
  panel.outerHTML = renderWorkflowV2BottomPanel(workflowV2Workbench().view());
  const nextPanel = document.querySelector("[data-testid='workflow-v2-bottom-panel']");
  if (nextPanel) {
    bindActionEvents(nextPanel);
    bindWorkflowV2EdgeFieldEvents(nextPanel);
    bindWorkflowV2RunInputEvents(nextPanel);
  }
}

function bindWorkflowV2RunInputEvents(root) {
  root.querySelectorAll("[data-testid='workflow-v2-run-input']").forEach((input) => {
    input.addEventListener("input", () => {
      state.workflowTestInput = input.value;
    });
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
  if (target.tagName === "BUTTON") {
    event.preventDefault();
  }
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
  } else if (action === "add-workflow-v2-node") {
    addWorkflowV2Node(target.dataset.nodeType ?? "agent");
    render();
  } else if (action === "select-workflow-v2-node") {
    workflowV2Workbench().selectNode(target.dataset.nodeId);
    render();
  } else if (action === "select-workflow-v2-run-node") {
    workflowV2Workbench().selectNode(target.dataset.nodeId);
    render();
  } else if (action === "toggle-workflow-v2-bottom-tab") {
    const tab = target.dataset.bottomTab;
    if (tab !== "run" && tab !== "execution-trace" && tab !== "edge-relations") return;
    if (state.workflowV2BottomPanelOpen && state.workflowV2ActiveBottomTab === tab) {
      state.workflowV2BottomPanelOpen = false;
    } else {
      state.workflowV2BottomPanelOpen = true;
      state.workflowV2ActiveBottomTab = tab;
    }
    render();
  } else if (action === "save-workflow-v2-draft") {
    await saveWorkflowV2Draft();
  } else if (action === "validate-workflow-v2") {
    await validateWorkflowV2Draft();
  } else if (action === "publish-workflow-v2") {
    await publishWorkflowV2();
  } else if (action === "run-workflow-v2") {
    await runWorkflowV2();
  } else if (action === "connect-workflow-v2-edge") {
    try {
      connectWorkflowV2EdgeFromForm();
      render();
    } catch (error) {
      state.toast = { tone: "error", text: error.message };
      render();
    }
  } else if (action === "connect-workflow-v2-edge-from-handle") {
    stageWorkflowV2EdgeFromHandle(target.dataset.sourceId, target.dataset.sourceHandle ?? "");
  } else if (action === "delete-workflow-v2-edge") {
    event.stopPropagation();
    workflowV2Workbench().removeCanvasEdge(target.dataset.edgeId);
    refreshWorkflowV2Canvas();
  } else if (action === "add-workflow-v2-output-field") {
    addWorkflowV2OutputFieldFromForm();
    render();
  } else if (action === "add-workflow-v2-input-field") {
    addWorkflowV2InputFieldFromForm();
    render();
  } else if (action === "add-workflow-v2-condition-branch") {
    addWorkflowV2ConditionBranchFromForm();
    render();
  } else if (action === "not-implemented") {
    state.toast = { tone: "warning", text: "Not implemented in the current HTTP Runtime" };
    render();
  }
}

function connectWorkflowV2EdgeFromForm() {
  const source = document.querySelector("[data-testid='workflow-v2-edge-source']")?.value ?? "START";
  const sourceHandle = document.querySelector("[data-testid='workflow-v2-edge-handle']")?.value ?? "";
  const target = document.querySelector("[data-testid='workflow-v2-edge-target']")?.value ?? "";
  connectWorkflowV2Edge(source, sourceHandle, target);
}

function connectWorkflowV2Edge(source, sourceHandle = "", target = "") {
  const view = workflowV2Workbench().view();
  const resolvedTarget = target || view.edgeConfig.targets.find((item) => item.id !== source)?.id || "END";
  workflowV2Workbench().connectCanvasEdge(source, resolvedTarget, sourceHandle ? { sourceHandle } : {});
}

function stageWorkflowV2EdgeFromHandle(source, sourceHandle = "") {
  const sourceInput = document.querySelector("[data-testid='workflow-v2-edge-source']");
  const handleInput = document.querySelector("[data-testid='workflow-v2-edge-handle']");
  if (sourceInput && source) {
    sourceInput.value = source;
  }
  if (handleInput) {
    handleInput.value = sourceHandle;
  }
}

function addWorkflowV2OutputFieldFromForm() {
  const name = document.querySelector("[data-testid='workflow-v2-output-field-name']")?.value?.trim() ?? "";
  if (!name) {
    state.toast = { tone: "error", text: "Output field name is required" };
    return;
  }
  const type = document.querySelector("[data-testid='workflow-v2-output-field-type']")?.value ?? "string";
  const required = Boolean(document.querySelector("[data-testid='workflow-v2-output-field-required']")?.checked);
  const enumRaw = document.querySelector("[data-testid='workflow-v2-output-field-enum']")?.value ?? "";
  const enumValues = enumRaw.split(",").map((value) => value.trim()).filter(Boolean);
  workflowV2Workbench().addOutputSchemaField({
    name,
    type: enumValues.length > 0 ? "enum" : type,
    required,
    ...(enumValues.length > 0 ? { enumOptions: enumValues } : {}),
  });
}

function addWorkflowV2InputFieldFromForm() {
  const name = document.querySelector("[data-testid='workflow-v2-input-field-name']")?.value?.trim() ?? "";
  if (!name) {
    state.toast = { tone: "error", text: "Input field name is required" };
    return;
  }
  const type = document.querySelector("[data-testid='workflow-v2-input-field-type']")?.value ?? "string";
  const required = Boolean(document.querySelector("[data-testid='workflow-v2-input-field-required']")?.checked);
  workflowV2Workbench().addInputSchemaField({ name, type, required });
}

function updateWorkflowV2AgentInputBinding(element, renderAfterUpdate) {
  const inputName = element.dataset.inputName;
  if (!inputName) return;
  const row = element.closest(".workflow-v2-agent-input-row");
  const source = row?.querySelector("[data-workflow-v2-agent-input-source]")?.value ?? "";
  const view = workflowV2Workbench().view();
  const mapping = view.nodeConfig.agentInputInspector?.inputMappings?.find((item) => item.name === inputName);
  let binding = null;
  if (source === "workflow_input") {
    const path = row.querySelector("[data-workflow-v2-agent-input-workflow]")?.value?.split(".").filter(Boolean)
      ?? mapping?.sourceOptions?.find((option) => option.kind === "workflowInput")?.path;
    if (path?.length) binding = { kind: "workflowInput", path };
  } else if (source === "node_output") {
    const [nodeId, ...pathParts] = (row.querySelector("[data-workflow-v2-agent-input-node]")?.value ?? "").split("|");
    if (nodeId && pathParts.length) binding = { kind: "nodeOutput", nodeId, path: pathParts.join(".").split(".").filter(Boolean) };
  } else if (source === "constant") {
    const constant = row.querySelector("[data-workflow-v2-agent-input-constant]");
    binding = { kind: "constant", value: workflowV2ConstantValue(constant?.value ?? "", constant?.dataset.valueType ?? mapping?.type) };
  }
  workflowV2Workbench().updateSelectedAgentInputBinding(inputName, binding);
  if (renderAfterUpdate) render();
}

function addWorkflowV2ConditionBranchFromForm() {
  const view = workflowV2Workbench().view();
  const selectedNode = view.canvas.nodes.find((node) => node.id === view.nodeConfig.selectedNodeId);
  if (!selectedNode || selectedNode.type !== "condition") {
    state.toast = { tone: "error", text: "Select a Condition node first" };
    return;
  }
  const handle = document.querySelector("[data-testid='workflow-v2-condition-branch-handle']")?.value?.trim() || "branch";
  const sourceField = document.querySelector("[data-testid='workflow-v2-condition-source-field']")?.value ?? "";
  const [nodeId, pathText = ""] = sourceField.split(":");
  const operator = document.querySelector("[data-testid='workflow-v2-condition-operator']")?.value ?? "equals";
  const rawValue = document.querySelector("[data-testid='workflow-v2-condition-value']")?.value ?? "";
  const target = document.querySelector("[data-testid='workflow-v2-condition-target']")?.value ?? "";
  workflowV2Workbench().addSelectedConditionBranch({
    branch: {
      handle,
      source: { nodeId, path: pathText.split(".").filter(Boolean) },
      operator,
      value: coerceWorkflowV2ConditionValue(rawValue),
    },
    target,
  });
}

function updateWorkflowV2ToolPolicy(patch) {
  const current = workflowV2Workbench().view().nodeConfig.toolSelector?.policy ?? { mode: "disabled" };
  const mode = patch.mode ?? current.mode ?? "disabled";
  const allowedTools = patch.allowedTools ?? current.allowedTools ?? [];
  workflowV2Workbench().updateSelectedToolPolicy({
    mode,
    allowedTools: mode === "disabled" ? [] : allowedTools,
    requiredTools: mode === "required" ? allowedTools : [],
  });
  render();
}

function coerceWorkflowV2ConditionValue(value) {
  const trimmed = String(value).trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed !== "" && Number.isFinite(Number(trimmed))) return Number(trimmed);
  return value;
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

function handleWorkflowConfigResizePointerDown(event) {
  if (event.button !== 0) return;
  const surface = event.currentTarget.closest(".workflow-surface");
  const panel = surface?.querySelector(".node-config");
  if (!surface || !panel) return;
  event.preventDefault();
  state.workflowConfigResize = {
    surface,
    startX: event.clientX,
    startWidth: panel.getBoundingClientRect().width,
  };
  document.body.classList.add("workflow-config-resizing");
  document.addEventListener("pointermove", handleWorkflowConfigResizePointerMove);
  document.addEventListener("pointerup", handleWorkflowConfigResizePointerUp);
  document.addEventListener("pointercancel", handleWorkflowConfigResizePointerUp);
}

function handleWorkflowConfigResizePointerMove(event) {
  const resize = state.workflowConfigResize;
  if (!resize) return;
  event.preventDefault();
  setWorkflowConfigPanelWidth(resize.startWidth - (event.clientX - resize.startX), resize.surface);
}

function handleWorkflowConfigResizePointerUp() {
  state.workflowConfigResize = null;
  document.body.classList.remove("workflow-config-resizing");
  document.removeEventListener("pointermove", handleWorkflowConfigResizePointerMove);
  document.removeEventListener("pointerup", handleWorkflowConfigResizePointerUp);
  document.removeEventListener("pointercancel", handleWorkflowConfigResizePointerUp);
}

function handleWorkflowConfigResizeKeyDown(event) {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  const direction = event.key === "ArrowLeft" ? 1 : -1;
  setWorkflowConfigPanelWidth(state.workflowConfigPanelWidth + direction * 24, event.currentTarget.closest(".workflow-surface"));
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
  if (!isEditableWorkflowConfigPath(node.type, path)) return;
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

function updateSelectedWorkflowBinding(fieldPath, key = "", options = {}) {
  const node = state.workflowNodes.find((item) => item.id === state.workflowSelectedNodeId);
  if (!node || !fieldPath) return;
  if (!isEditableWorkflowConfigPath(node.type, fieldPath)) return;
  const value = workflowReferenceValueFromControls(fieldPath, key);
  node.config = { ...(node.config ?? {}) };
  if (fieldPath === "input_mapping" || fieldPath === "args") {
    const current = isPlainObject(node.config[fieldPath]) ? { ...node.config[fieldPath] } : {};
    current[key] = value;
    node.config[fieldPath] = current;
  } else {
    node.config[fieldPath] = value;
  }
  state.workflowDirty = true;
  state.workflowGraphPreview = null;
  state.workflowPublishedVersion = null;
  state.workflowTestRun = null;
  state.workflowRuntimeEvents = [];
  if (options.renderAfterUpdate) render();
}

async function openWorkflow(templateId) {
  if (!templateId) return;
  try {
    const template = await runtimeClient().fetchTemplate(templateId);
    loadWorkflowManifest(template.manifest, template.id, activeWorkflowVersionFromTemplate(template));
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

function addWorkflowV2Node(type) {
  if (!AGENT_WORKFLOW_V2_NODE_TYPES.includes(type)) {
    state.toast = { tone: "error", text: "Unsupported Agent Workflow V2 node type" };
    return;
  }
  const workbench = workflowV2Workbench();
  const count = workbench.view().canvas.nodes.length;
  workbench.dropLibraryNode(type, {
    x: 80 + (count % 4) * 150,
    y: 80 + Math.floor(count / 4) * 120,
  });
  state.toast = { tone: "success", text: `${titleCase(type.replace(/_/g, " "))} V2 node added` };
}

async function saveWorkflowV2Draft() {
  state.toast = { tone: "loading", text: "Saving Agent Workflow V2 draft" };
  render();
  try {
    await ensureWorkflowV2Definition();
    const saved = await workflowV2Workbench().saveDraft();
    state.toast = { tone: "success", text: `Saved ${saved.id}` };
  } catch (error) {
    state.toast = { tone: "error", text: error.message };
  }
  render();
}

async function validateWorkflowV2Draft() {
  state.toast = { tone: "loading", text: "Validating Agent Workflow V2 draft" };
  render();
  try {
    const validation = await workflowV2Workbench().validateWithBackend();
    state.toast = validation.valid
      ? { tone: "success", text: "Agent Workflow V2 draft is valid" }
      : { tone: "warning", text: "Agent Workflow V2 draft has validation issues" };
  } catch (error) {
    state.toast = { tone: "error", text: error.message };
  }
  render();
}

async function publishWorkflowV2() {
  state.toast = { tone: "loading", text: "Publishing Agent Workflow V2" };
  render();
  try {
    await ensureWorkflowV2Definition();
    await workflowV2Workbench().saveDraft();
    const published = await workflowV2Workbench().publishWorkflow();
    state.toast = { tone: "success", text: `Published v${published.version ?? published.id}` };
  } catch (error) {
    state.toast = { tone: "error", text: error.message };
  }
  render();
}

async function runWorkflowV2() {
  const workbench = workflowV2Workbench();
  const versions = workbench.view().toolbar.versions ?? [];
  const version = versions[versions.length - 1]?.version;
  if (!version) {
    state.toast = { tone: "warning", text: "Publish Agent Workflow V2 before running it" };
    render();
    return;
  }
  state.toast = { tone: "loading", text: "Running Agent Workflow V2" };
  state.workflowV2BottomPanelOpen = true;
  state.workflowV2ActiveBottomTab = "run";
  const runPromise = workbench.startRun({ version, input: { message: state.workflowTestInput } });
  render();
  try {
    const run = await runPromise;
    state.toast = { tone: run.status === "failed" ? "error" : "success", text: `Run ${run.status}` };
  } catch (error) {
    state.toast = { tone: "error", text: error.message };
  }
  render();
}

async function ensureWorkflowV2Definition() {
  if (state.workflowV2DefinitionReady) return;
  const client = runtimeClient();
  if (typeof client.fetchWorkflow === "function") {
    try {
      const existing = await client.fetchWorkflow(WORKFLOW_V2_DEFAULT_ID);
      workflowV2Workbench().setDraftRevision(existing.revision);
      state.workflowV2DefinitionReady = true;
      return;
    } catch {
      // A first local draft save creates the V2 definition below.
    }
  }
  if (typeof client.createWorkflow !== "function") {
    state.workflowV2DefinitionReady = true;
    return;
  }
  const created = await client.createWorkflow(createNewWorkflowDefinition({ id: WORKFLOW_V2_DEFAULT_ID, name: "Agent Workflow V2 Draft" }));
  workflowV2Workbench().setDraftRevision(created.revision);
  state.workflowV2DefinitionReady = true;
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

function loadWorkflowManifest(manifest, templateId = null, activeVersion = null) {
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
  state.workflowPublishedVersion = activeVersion;
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
  const summary = {
    id: template.id ?? manifest.template.id,
    name: manifest.template.name,
    version: manifest.template.version,
  };
  const activeVersionId = template.active_version_id ?? template.activeVersionId ?? null;
  if (activeVersionId) {
    summary.active_version_id = activeVersionId;
  }
  return summary;
}

function activeWorkflowVersionFromTemplate(template) {
  const activeVersion = template.active_version ?? template.activeVersion ?? null;
  if (activeVersion?.id) return activeVersion;
  const activeVersionId = template.active_version_id ?? template.activeVersionId ?? null;
  if (!activeVersionId) return null;
  return {
    id: activeVersionId,
    agent_template_id: template.id ?? template.manifest?.template?.id ?? null,
    status: "published",
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

function workflowConfigPanelWidth() {
  return clampWorkflowConfigPanelWidth(state.workflowConfigPanelWidth);
}

function setWorkflowConfigPanelWidth(value, surface) {
  state.workflowConfigPanelWidth = clampWorkflowConfigPanelWidth(value);
  surface?.style.setProperty("--workflow-config-panel-width", `${state.workflowConfigPanelWidth}px`);
  surface?.querySelector("[data-testid='workflow-config-resize-handle']")?.setAttribute("aria-valuenow", String(state.workflowConfigPanelWidth));
}

function clampWorkflowConfigPanelWidth(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return WORKFLOW_CONFIG_PANEL_DEFAULT_WIDTH;
  return Math.max(WORKFLOW_CONFIG_PANEL_MIN_WIDTH, Math.min(WORKFLOW_CONFIG_PANEL_MAX_WIDTH, Math.round(numeric)));
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

function workflowV2Workbench() {
  if (!state.workflowV2Workbench) {
    const workbench = createWorkflowV2Workbench({
      apiClient: runtimeClient(),
      workflowDefinition: createStarterWorkflowV2Definition({ id: WORKFLOW_V2_DEFAULT_ID, name: "Agent Workflow V2 Draft" }),
    });
    workbench.selectNode("analyze-request");
    state.workflowV2Workbench = workbench;
  }
  return state.workflowV2Workbench;
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
    createWorkflow: (definition) => postJson("/api/workflows", definition),
    fetchWorkflow: (workflowId) => getJson(`/api/workflows/${encodeURIComponent(workflowId)}`),
    saveWorkflowDraft: (workflowId, definition) => putJson(`/api/workflows/${encodeURIComponent(workflowId)}/draft`, definition),
    validateWorkflow: (workflowId, definition) => postJson(`/api/workflows/${encodeURIComponent(workflowId)}/validate`, definition),
    listWorkflowTools: () => getJson("/api/workflow-tools"),
    publishWorkflow: (workflowId) => postJson(`/api/workflows/${encodeURIComponent(workflowId)}/publish`, {}),
    listWorkflowVersions: (workflowId) => getJson(`/api/workflows/${encodeURIComponent(workflowId)}/versions`),
    startWorkflowRun: (workflowId, payload) => postJson(`/api/workflows/${encodeURIComponent(workflowId)}/runs`, payload),
    fetchWorkflowRun: (runId) => getJson(`/api/workflow-runs/${encodeURIComponent(runId)}`),
    fetchWorkflowRunNodes: (runId) => getJson(`/api/workflow-runs/${encodeURIComponent(runId)}/nodes`),
    fetchWorkflowRunMessages: (runId) => getJson(`/api/workflow-runs/${encodeURIComponent(runId)}/messages`),
    listWorkflowRunArtifacts: (runId) => getJson(`/api/workflow-runs/${encodeURIComponent(runId)}/artifacts`),
    cancelWorkflowRun: (runId) => postJson(`/api/workflow-runs/${encodeURIComponent(runId)}/cancel`, {}),
    streamWorkflowRunEvents: (runId) => streamSse(`/api/workflow-runs/${encodeURIComponent(runId)}/events`),
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
    async createWorkflow(definition) {
      state.workflowV2DefinitionReady = true;
      return { ...clone(definition), revision: Number(definition.revision ?? 1) };
    },
    async fetchWorkflow(workflowId) {
      if (!state.workflowV2DefinitionReady) {
        throw new Error(`Workflow not found: ${workflowId}`);
      }
      return createNewWorkflowDefinition({ id: workflowId, name: "Agent Workflow V2 Draft" });
    },
    async saveWorkflowDraft(workflowId, definition) {
      return { ...clone(definition), id: workflowId, revision: Number(definition.revision ?? 1) + 1 };
    },
    async validateWorkflow() {
      return { valid: true, errors: [] };
    },
    async listWorkflowTools() {
      return this.listTools();
    },
    async publishWorkflow(workflowId) {
      const version = state.workflowV2Versions.length + 1;
      const published = {
        id: `${workflowId}_v${version}`,
        workflowId,
        version,
        status: "published",
        publishedAt: new Date().toISOString(),
      };
      state.workflowV2Versions = [...state.workflowV2Versions, published];
      return clone(published);
    },
    async listWorkflowVersions() {
      return { versions: state.workflowV2Versions.map(clone) };
    },
    async startWorkflowRun(workflowId, payload = {}) {
      const nodes = workflowV2Workbench().view().canvas.nodes;
      return {
        id: `workflow_run_${Date.now()}`,
        status: "succeeded",
        workflowId,
        workflowVersion: payload.version,
        output: { message: payload.input?.message ? `Echo: ${payload.input.message}` : "OK" },
        finalResult: { data: { message: payload.input?.message ? `Echo: ${payload.input.message}` : "OK" }, artifacts: [] },
        nodeResults: nodes.map((node) => ({ nodeId: node.id, status: "succeeded", input: { message: payload.input?.message ?? "" }, data: { nodeId: node.id } })),
        messages: [],
        executionDetails: { nodes: nodes.filter((node) => node.type !== "end").map((node) => ({ nodeId: node.id, input: { message: payload.input?.message ?? "" }, steps: [{ type: "node_result", status: "succeeded", data: { nodeId: node.id } }] })) },
        events: [],
      };
    },
    async fetchWorkflowRun(runId) {
      return { id: runId, status: "succeeded", workflowVersion: state.workflowV2Versions.at(-1)?.version ?? 1, nodeResults: [], messages: [], executionDetails: { nodes: [] }, events: [] };
    },
    async fetchWorkflowRunNodes() {
      return { nodes: [] };
    },
    async fetchWorkflowRunMessages() {
      return { messages: [] };
    },
    async listWorkflowRunArtifacts() {
      return { artifacts: [] };
    },
    async cancelWorkflowRun(runId) {
      return { id: runId, status: "cancelled", workflowVersion: state.workflowV2Versions.at(-1)?.version ?? 1, nodeResults: [], messages: [], executionDetails: { nodes: [] }, events: [] };
    },
    async *streamWorkflowRunEvents() {},
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
    .workflow-surface { flex: 1; min-height: 0; display: grid; grid-template-columns: 180px minmax(320px, 1fr) 8px var(--workflow-config-panel-width); gap: 12px; overflow: auto; }
    .node-palette, .template-fields, .debug-grid section { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 12px; overflow: auto; }
    .workflow-config-resize-handle { position: relative; min-width: 8px; cursor: col-resize; border-radius: 999px; outline: 0; touch-action: none; }
    .workflow-config-resize-handle::before { content: ""; position: absolute; inset: 8px 3px; border-radius: 999px; background: #cbd5e1; transition: background-color .12s ease, box-shadow .12s ease; }
    .workflow-config-resize-handle:hover::before, .workflow-config-resize-handle:focus::before { background: var(--accent); box-shadow: 0 0 0 3px rgba(37, 99, 235, .16); }
    .workflow-config-resizing, .workflow-config-resizing * { cursor: col-resize !important; user-select: none; }
    .node-config { min-width: 0; width: 100%; max-width: none; display: grid; align-content: start; gap: 10px; overflow: auto; background: #f8fafc; border: 1px solid var(--line); border-radius: 10px; padding: 10px; }
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
    .node-config input[readonly], .node-config textarea[readonly], .node-config select:disabled { cursor: not-allowed; opacity: .68; background: #f1f5f9; }
    .workflow-config-label { display: inline-flex; align-items: flex-start; width: max-content; line-height: 1.2; }
    .workflow-config-required { position: relative; top: -.2em; display: inline-flex; align-items: center; margin-left: 2px; color: #b42318; font-size: 11px; font-weight: 800; line-height: 1; vertical-align: super; }
    .workflow-binding-field { gap: 8px; }
    .workflow-binding-row { display: grid; gap: 6px; padding: 8px; border: 1px solid var(--line); border-radius: 7px; background: #fff; }
    .workflow-binding-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
    .workflow-binding-head small { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0; }
    .workflow-binding-grid { display: grid; grid-template-columns: minmax(0, .85fr) minmax(0, 1fr); gap: 8px; }
    .danger-zone { background: #fffafa; border-color: #f3c6c2; }
    .danger-zone h2 { color: #9f2f27; }
    .subtle-danger { justify-self: start; padding: 6px 9px; min-height: 32px; background: #fff; border-color: #f3b8b2; color: var(--error); }
    .subtle-danger:hover:not(:disabled) { background: #fff1f0; border-color: var(--error); color: var(--error); }
    .node-palette button { width: 100%; margin-bottom: 8px; text-align: left; }
    .node-palette .session-row .nav-item { margin-bottom: 0; }
    .node-palette .session-menu-trigger { width: 34px; margin-bottom: 0; text-align: center; }
    .workflow-v2-mode { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .workflow-v2-mode span { display: inline-flex; align-items: center; justify-content: center; min-height: 34px; padding: 7px 8px; border: 1px solid var(--line); border-radius: 7px; background: #f8fafc; color: var(--muted); font-size: 12px; }
    .workflow-v2-mode span.selected { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); font-weight: 700; }
    .graph-canvas { position: relative; min-height: 0; border: 1px solid var(--line); border-radius: 10px; background: linear-gradient(#e8edf3 1px, transparent 1px), linear-gradient(90deg, #e8edf3 1px, transparent 1px), #fff; background-size: 28px 28px; overflow: auto; }
    .graph-canvas-viewport { position: relative; min-width: 100%; min-height: 100%; }
    .graph-canvas-content { position: relative; min-width: 100%; min-height: 100%; transform-origin: 0 0; }
    .workflow-v2-canvas .graph-canvas-content { min-height: 560px; position: relative; }
    .workflow-v2-empty { margin: 18px; color: var(--muted); }
    .workflow-v2-edge-layer { position: absolute; inset: 0; width: 100%; height: 100%; min-height: 560px; overflow: visible; pointer-events: none; z-index: 1; }
    .workflow-v2-edge-path { fill: none; stroke: #64748b; stroke-width: 2; }
    .workflow-v2-arrowhead-shape { fill: #64748b; stroke: none; }
    .workflow-v2-edge-layer text { fill: #334155; font-size: 11px; paint-order: stroke; stroke: #ffffff; stroke-width: 3px; }
    .workflow-v2-node-wrap { position: absolute; z-index: 2; display: grid; grid-template-columns: minmax(132px, max-content) auto; align-items: center; gap: 8px; }
    .workflow-v2-node { position: relative; min-width: 132px; }
    .workflow-v2-node.selected { border-color: var(--accent); box-shadow: inset 3px 0 0 var(--accent); }
    .workflow-v2-node-status { display: block; color: var(--muted); font-size: 10px; font-weight: 700; }
    .workflow-v2-node.run-status-running { border-color: var(--warning); }
    .workflow-v2-node.run-status-succeeded { border-color: var(--success); }
    .workflow-v2-node.run-status-failed { border-color: var(--error); }
    .workflow-v2-handle-list { display: grid; gap: 8px; align-items: center; }
    .workflow-v2-handle { min-width: 44px; min-height: 32px; border: 1px solid var(--line); border-radius: 6px; background: #ffffff; color: var(--accent); font-size: 11px; cursor: pointer; }
    .workflow-v2-edge-panel { border-top: 1px solid var(--line); padding: 10px; background: #ffffff; display: grid; gap: 8px; }
    .workflow-v2-edge-form, .workflow-v2-edge-row, .workflow-v2-inline-form { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)) auto; gap: 8px; align-items: end; }
    .workflow-v2-edge-row { grid-template-columns: minmax(0, 1fr) 100px minmax(0, 1fr) 44px; align-items: center; }
    .workflow-v2-edge-panel select, .workflow-v2-edge-panel input, .workflow-v2-inline-form input, .workflow-v2-inline-form select { width: 100%; min-height: 34px; border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; }
    .workflow-v2-inspector-block { display: grid; gap: 8px; padding-top: 8px; border-top: 1px solid var(--line); }
    .workflow-v2-inspector-block h3 { margin: 0; font-size: 13px; }
    .workflow-v2-bottom-panel { flex: 0 0 auto; min-height: 0; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); overflow: hidden; }
    .workflow-v2-bottom-tabs { display: flex; gap: 2px; align-items: stretch; min-height: 38px; padding: 0 8px; border-bottom: 1px solid var(--line); background: #f8fafc; }
    .workflow-v2-bottom-tab { min-height: 38px; padding: 7px 10px 6px; border: 0; border-bottom: 2px solid transparent; border-radius: 0; background: transparent; color: var(--muted); font-size: 12px; }
    .workflow-v2-bottom-tab.active { border-bottom-color: var(--accent); background: var(--panel); color: var(--accent); font-weight: 700; }
    .workflow-v2-bottom-content { min-height: 0; max-height: 34vh; overflow: auto; }
    .workflow-v2-bottom-content .workflow-v2-edge-panel, .workflow-v2-bottom-content .workflow-v2-execution-trace { border-top: 0; }
    .workflow-v2-run-panel { display: grid; gap: 12px; padding: 12px; background: #ffffff; }
    .workflow-v2-run-section { display: grid; gap: 8px; }
    .workflow-v2-run-section h3 { margin: 0; font-size: 13px; }
    .workflow-v2-run-section textarea { width: 100%; min-height: 76px; resize: vertical; }
    .workflow-v2-run-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .workflow-v2-run-meta { color: var(--muted); font-size: 12px; }
    .workflow-v2-run-output { border-top: 1px solid var(--line); padding-top: 10px; }
    .workflow-v2-run-output-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .workflow-v2-run-output pre { max-height: 180px; overflow: auto; margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: 12px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; }
    .workflow-v2-run-output .message-error { margin: 0; }
    .workflow-v2-execution-trace { display: grid; gap: 8px; border-top: 1px solid var(--line); padding-top: 8px; }
    .workflow-v2-execution-trace h3 { margin: 0; }
    .workflow-v2-execution-list { display: grid; gap: 6px; margin: 0; padding-left: 22px; }
    .workflow-v2-execution-row { width: 100%; display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 8px; align-items: center; text-align: left; padding: 7px 9px; }
    .workflow-v2-execution-row.selected { border-color: var(--accent); background: var(--accent-soft); }
    .workflow-v2-execution-row small { color: var(--muted); }
    .workflow-v2-node-execution { display: grid; gap: 7px; border-top: 1px solid var(--line); padding-top: 9px; }
    .workflow-v2-node-execution header { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
    .workflow-v2-run-payload, .workflow-v2-run-tools, .workflow-v2-run-error { display: grid; gap: 5px; }
    .workflow-v2-run-payload h4, .workflow-v2-run-tools h4, .workflow-v2-run-error h4 { margin: 0; font-size: 12px; color: var(--muted); text-transform: uppercase; }
    .workflow-v2-run-payload pre, .workflow-v2-run-tools pre, .workflow-v2-run-error pre { max-height: 180px; overflow: auto; }
    .workflow-v2-run-payload details, .workflow-v2-run-tools details { border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; background: #fff; }
    .workflow-v2-run-payload code { overflow-wrap: anywhere; }
    .workflow-v2-schema-fields, .workflow-v2-tool-list { display: grid; gap: 6px; }
    .workflow-v2-check { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; }
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
      .workflow-config-resize-handle { display: none; }
      .workflow-binding-grid { grid-template-columns: 1fr; }
      .message-card { width: 100%; }
    }
  </style>`;
}
