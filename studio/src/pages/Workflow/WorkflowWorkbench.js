import { createWorkbenchLayout } from "../../design-system/layout/workbenchLayout.js";
import { createWorkflowBuilder } from "../../features/workflow-builder/WorkflowBuilder.js";
import { serializeGraph } from "../../workflow/manifest/model.js";

const DEFAULT_VIEWPORT_WIDTH = 1280;
const MIN_CANVAS_ZOOM = 0.4;
const MAX_CANVAS_ZOOM = 2;
const CANVAS_WHEEL_ZOOM_STEP = 0.1;
const NODE_LIBRARY = [
  { type: "prompt", label: "PROMPT", category: "Prompt" },
  { type: "llm", label: "LLM", category: "Model" },
  { type: "tool", label: "TOOL", category: "Tools" },
  { type: "condition", label: "CONDITION", category: "Flow" },
  { type: "output", label: "OUTPUT", category: "Output" },
];
const CANVAS_TOOLS = ["pointer", "pan", "zoom", "fit", "grid"];
const NODE_CONFIG_SCHEMAS = {
  prompt: [
    {
      id: "template",
      fields: [
        { path: "role", label: "Role", example: "user" },
        { path: "template", label: "Template", required: true, example: "Summarize {{input}}" },
        { path: "variables", label: "Variables", visibility: "hidden", editable: false },
      ],
    },
    {
      id: "io",
      fields: [
        { path: "input_mapping", label: "Input Mapping", binding: "template_variables", sourceField: "template" },
        { path: "output_key", label: "Output Key", visibility: "hidden", editable: false },
      ],
    },
  ],
  llm: [
    {
      id: "model",
      fields: [
        { path: "provider", label: "Provider", example: "openai-compatible" },
        { path: "model", label: "Model", required: true, example: "default" },
        { path: "max_tokens", label: "Max Tokens", example: "512" },
      ],
    },
    {
      id: "prompt",
      fields: [
        { path: "system_prompt", label: "System Prompt", example: "You are helpful." },
        { path: "prompt", label: "Prompt", required: true, example: "Summarize {{input}}" },
        { path: "temperature", label: "Temperature", example: "0.2" },
      ],
    },
    {
      id: "io",
      fields: [
        { path: "input_mapping", label: "Input Mapping", binding: "template_variables", sourceField: "prompt" },
        { path: "output_key", label: "Output Key", visibility: "hidden", editable: false },
      ],
    },
  ],
  tool: [
    { id: "tool", fields: [{ path: "tool_name", label: "Tool", required: true, example: "context.echo" }] },
    {
      id: "io",
      fields: [
        { path: "args", label: "Arguments", binding: "tool_args" },
        { path: "output_key", label: "Output Key", visibility: "hidden", editable: false },
      ],
    },
  ],
  condition: [
    {
      id: "condition",
      fields: [
        { path: "source", label: "Source", required: true, binding: "reference" },
        { path: "operator", label: "Operator", required: true, example: "gte" },
        { path: "value", label: "Value", example: "80" },
        { path: "state_key", label: "State Key", visibility: "hidden", editable: false },
      ],
    },
  ],
  output: [{ id: "output", fields: [{ path: "source", label: "Source", required: true, binding: "reference" }] }],
};
const FALLBACK_PLATFORM = {
  readUiState() {
    return null;
  },
  writeUiState() {},
};

export function createWorkflowWorkbench(options = {}) {
  const apiClient = options.apiClient ?? {};
  const platform = options.platform ?? FALLBACK_PLATFORM;
  const layout = createWorkbenchLayout(platform, {
    layoutId: "workflow",
    viewportWidth: options.viewportWidth ?? DEFAULT_VIEWPORT_WIDTH,
  });
  const builder = createWorkflowBuilder(apiClient, options.initialManifest ?? null);
  const configDrafts = new Map();
  const draftDirty = new Set();
  const state = {
    dirty: false,
    status: "saved",
    selectedNodeId: null,
    lastValidation: null,
    publish: {
      status: "idle",
      version: options.publishedVersion ?? null,
      lastValidated: false,
      changeSummary: null,
    },
    testRun: {
      status: "idle",
      runId: null,
      output: null,
      error: null,
    },
    nodeLibraryQuery: "",
    nextNodeNumber: 1,
    activeCanvasTool: "pointer",
    canvasViewport: { mode: "manual", bounds: null, zoom: 1 },
    canvasPan: null,
    selectedEdgeId: null,
    edgeErrors: new Map(),
    runtimeNodeStatus: new Map(),
    runtimeEvents: [],
    selectedRuntimeNodeId: null,
    toolCatalog: [],
    toolCatalogStatus: "idle",
    validationIssues: [],
    configFieldErrors: new Map(),
    nodeConfigValidation: { valid: true, errors: [] },
    collapsedSubgraphs: new Set(),
  };
  function markDirty() {
    state.dirty = true;
    state.status = "dirty";
  }

  function deleteSelectedNode() {
    const nodeId = state.selectedNodeId;
    if (!nodeId) {
      return { deleted: false, nodeId: null, removedEdgeCount: 0 };
    }
    const workflowView = builder.view();
    const node = selectedNode(workflowView, nodeId);
    if (!node) {
      state.selectedNodeId = null;
      return { deleted: false, nodeId, removedEdgeCount: 0 };
    }
    const removedEdgeCount = workflowView.edges.filter((edge) => edge.from === nodeId || edge.to === nodeId).length;
    builder.removeNode(nodeId);
    configDrafts.delete(nodeId);
    draftDirty.delete(nodeId);
    state.configFieldErrors.delete(nodeId);
    state.runtimeNodeStatus.delete(nodeId);
    if (state.selectedRuntimeNodeId === nodeId) {
      state.selectedRuntimeNodeId = null;
    }
    state.selectedNodeId = null;
    state.selectedEdgeId = null;
    state.validationIssues = [];
    state.nodeConfigValidation = { valid: true, errors: [] };
    markDirty();
    return { deleted: true, nodeId, removedEdgeCount };
  }

  return {
    nodeLibrary() {
      return libraryItems(builder, options.manifestSchema, state.nodeLibraryQuery);
    },
    addNode(node) {
      const result = builder.addNode(node);
      markDirty();
      return result;
    },
    connect(source, target, condition = null) {
      const result = builder.connect(source, target, condition);
      markDirty();
      return result;
    },
    updateNodeConfig(nodeId, patch) {
      const result = builder.updateNodeConfig(nodeId, patch);
      if (state.selectedNodeId === nodeId) {
        configDrafts.set(nodeId, { ...selectedNodeConfig(result, nodeId) });
      }
      markDirty();
      return result;
    },
    connectCanvasEdge(source, target, options = {}) {
      const condition = options.branch ?? null;
      const edge = { from: source, to: target, ...(condition ? { condition } : {}) };
      const localIssue = validateEdgeDraft(builder.view(), edge);
      if (localIssue) {
        state.validationIssues = [localIssue];
        return { accepted: false, issue: localIssue };
      }
      builder.connect(source, target, condition);
      markDirty();
      const index = builder.view().edges.length - 1;
      return { accepted: true, edge: canvasEdge(builder.view().edges[index], index, state.edgeErrors) };
    },
    deleteCanvasEdge(edgeId) {
      const parsed = parseEdgeId(edgeId);
      const workflowView = builder.view();
      const edge = workflowView.edges[parsed.index];
      if (!edge || edgeIdFor(edge, parsed.index) !== edgeId) {
        return { deleted: false };
      }
      builder.removeEdge(edge);
      if (state.selectedEdgeId === edgeId) {
        state.selectedEdgeId = null;
      }
      state.edgeErrors.delete(parsed.index);
      state.validationIssues = [];
      markDirty();
      return { deleted: true };
    },
    selectCanvasEdge(edgeId) {
      const parsed = parseEdgeId(edgeId);
      const workflowView = builder.view();
      const edge = workflowView.edges[parsed.index];
      if (!edge || edgeIdFor(edge, parsed.index) !== edgeId) {
        state.selectedEdgeId = null;
        return { selected: false };
      }
      state.selectedEdgeId = edgeId;
      state.selectedNodeId = null;
      return { selected: true, edge: canvasEdge(edge, parsed.index, state.edgeErrors, state.selectedEdgeId) };
    },
    reconnectCanvasEdge(edgeId, nextEndpoint) {
      const parsed = parseEdgeId(edgeId);
      const workflowView = builder.view();
      const edge = workflowView.edges[parsed.index];
      if (!edge || edgeIdFor(edge, parsed.index) !== edgeId) {
        return { accepted: false, issue: { code: "edge_not_found", message: "Workflow edge was not found" } };
      }
      const nextEdge = {
        from: nextEndpoint.source,
        to: nextEndpoint.target,
        ...(nextEndpoint.branch ? { condition: nextEndpoint.branch } : {}),
      };
      const localIssue = validateEdgeDraft(workflowView, nextEdge);
      if (localIssue) {
        state.validationIssues = [localIssue];
        return { accepted: false, issue: localIssue };
      }
      builder.replaceEdge(edge, nextEdge);
      state.edgeErrors.delete(parsed.index);
      state.validationIssues = [];
      markDirty();
      return { accepted: true, edge: canvasEdge(nextEdge, parsed.index, state.edgeErrors) };
    },
    toggleSubGraphCollapse(nodeId) {
      const node = selectedNode(builder.view(), nodeId);
      if (!node || node.type !== "subgraph") {
        throw new Error(`Unknown workflow SubGraph node: ${nodeId}`);
      }
      if (state.collapsedSubgraphs.has(nodeId)) {
        state.collapsedSubgraphs.delete(nodeId);
      } else {
        state.collapsedSubgraphs.add(nodeId);
      }
      return this.view().canvas.nodes.find((item) => item.id === nodeId);
    },
    setCanvasTool(tool) {
      if (!CANVAS_TOOLS.includes(tool)) {
        throw new Error(`Unknown workflow canvas tool: ${tool}`);
      }
      state.activeCanvasTool = tool;
      return this.view().canvas.toolbar;
    },
    fitCanvasView() {
      const bounds = graphBounds(builder.view().nodes);
      state.canvasViewport = { mode: "fit", bounds, zoom: state.canvasViewport.zoom };
      return { bounds };
    },
    handleCanvasWheel(event = {}) {
      if (!event.ctrlKey) {
        return { handled: false };
      }
      const direction = Number(event.deltaY ?? 0) < 0 ? 1 : -1;
      state.canvasViewport = {
        mode: "manual",
        bounds: null,
        zoom: clampZoom(state.canvasViewport.zoom + direction * CANVAS_WHEEL_ZOOM_STEP),
      };
      return { handled: true, viewport: canvasViewportView(state.canvasViewport) };
    },
    startCanvasPan(event = {}) {
      if (event.button !== 2 || isInteractiveCanvasTarget(event.targetRole)) {
        return { handled: false };
      }
      state.canvasPan = {
        startX: Number(event.clientX ?? 0),
        startY: Number(event.clientY ?? 0),
        scrollLeft: Number(event.scrollLeft ?? 0),
        scrollTop: Number(event.scrollTop ?? 0),
        moved: false,
      };
      return { handled: true, preventContextMenu: true };
    },
    moveCanvasPan(event = {}) {
      if (!state.canvasPan) {
        return { handled: false };
      }
      const deltaX = Number(event.clientX ?? state.canvasPan.startX) - state.canvasPan.startX;
      const deltaY = Number(event.clientY ?? state.canvasPan.startY) - state.canvasPan.startY;
      state.canvasPan.moved = state.canvasPan.moved || Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1;
      return {
        handled: true,
        scrollLeft: Math.max(0, Math.round(state.canvasPan.scrollLeft - deltaX)),
        scrollTop: Math.max(0, Math.round(state.canvasPan.scrollTop - deltaY)),
      };
    },
    endCanvasPan() {
      if (!state.canvasPan) {
        return { handled: false };
      }
      state.canvasPan = null;
      return { handled: true };
    },
    handleCanvasKeyDown(event) {
      if (!isDeleteKey(event.key) || isEditableTarget(event.targetRole)) {
        return { handled: false };
      }
      if (state.selectedEdgeId) {
        const result = this.deleteCanvasEdge(state.selectedEdgeId);
        return { handled: result.deleted, ...result };
      }
      if (!state.selectedNodeId) {
        return { handled: false };
      }
      const result = deleteSelectedNode();
      return { handled: result.deleted, ...result };
    },
    resizePanel(panel, size) {
      layout.resizePanel(panel, size);
      return this.view();
    },
    searchNodeLibrary(query) {
      state.nodeLibraryQuery = query ?? "";
      return this.view().nodeLibrary;
    },
    async loadToolCatalog() {
      if (!apiClient.listTools) {
        state.toolCatalog = [];
        state.toolCatalogStatus = "unavailable";
        return { tools: [] };
      }
      state.toolCatalogStatus = "loading";
      try {
        const response = await apiClient.listTools();
        state.toolCatalog = Array.isArray(response.tools) ? response.tools.map(cloneToolMetadata) : [];
        state.toolCatalogStatus = "loaded";
        return { tools: state.toolCatalog.map(cloneToolMetadata) };
      } catch (error) {
        state.toolCatalogStatus = "error";
        return { tools: [], error };
      }
    },
    dropLibraryNode(type, position) {
      ensureSupportedType(type, builder, options.manifestSchema);
      const node = {
        id: nextNodeId(type, state),
        type,
        config: {},
        position: { x: position.x, y: position.y },
      };
      builder.addNode(node);
      state.selectedNodeId = node.id;
      markDirty();
      return {
        node,
        preview: {
          type,
          dropPosition: { ...node.position },
        },
      };
    },
    moveCanvasNode(nodeId, position) {
      const result = builder.updateNodePosition(nodeId, { x: position.x, y: position.y });
      markDirty();
      return { node: selectedNode(result, nodeId) };
    },
    duplicateSelectedNode(offset = {}) {
      if (!state.selectedNodeId) {
        return { node: null };
      }
      const workflowView = builder.view();
      const source = selectedNode(workflowView, state.selectedNodeId);
      if (!source || source.unsupported) {
        return { node: null };
      }
      const sourcePosition = source.position ?? { x: 0, y: 0 };
      const node = {
        id: nextNodeId(source.type, state),
        type: source.type,
        config: { ...(source.config ?? {}) },
        position: {
          x: sourcePosition.x + Number(offset.x ?? 32),
          y: sourcePosition.y + Number(offset.y ?? 32),
        },
      };
      builder.addNode(node);
      state.selectedNodeId = node.id;
      markDirty();
      return { node };
    },
    deleteSelectedNode() {
      return deleteSelectedNode();
    },
    selectNode(nodeId) {
      if (nodeId === "START" || nodeId === "END") {
        state.selectedNodeId = null;
        state.selectedEdgeId = null;
        return this.view();
      }
      state.selectedNodeId = nodeId;
      state.selectedEdgeId = null;
      return this.view();
    },
    updateNodeConfigDraft(patch) {
      if (!state.selectedNodeId) {
        throw new Error("Select a workflow node before editing config");
      }
      const workflowView = builder.view();
      const node = selectedNode(workflowView, state.selectedNodeId);
      const editablePatch = editableConfigPatch(node, patch);
      const current = configDrafts.get(state.selectedNodeId) ?? selectedNodeConfig(workflowView, state.selectedNodeId);
      if (!Object.keys(editablePatch).some((path) => !valuesEquivalent(current[path], editablePatch[path]))) {
        return this.view();
      }
      configDrafts.set(state.selectedNodeId, { ...current, ...editablePatch });
      draftDirty.add(state.selectedNodeId);
      markDirty();
      return this.view();
    },
    validate() {
      state.lastValidation = builder.validate();
      state.status = state.lastValidation.valid ? (state.dirty ? "dirty" : "saved") : "validation";
      return state.lastValidation;
    },
    validateSelectedNodeConfig() {
      const workflowView = builder.view();
      const currentNode = selectedNode(workflowView, state.selectedNodeId);
      const draft = selectedNodeDraft(workflowView, state.selectedNodeId, configDrafts);
      const errors = validateNodeConfig(currentNode, draft);
      state.nodeConfigValidation = { valid: errors.length === 0, errors };
      if (currentNode) {
        state.configFieldErrors.set(currentNode.id, fieldErrorMap(errors));
      }
      return state.nodeConfigValidation;
    },
    async validateDraft(template) {
      return this.validateWithBackend(template);
    },
    async validateWithBackend(template) {
      const workflowView = builder.view();
      const manifest = apiClient.validateAgentDraft && template ? runtimeManifest(workflowView, template) : builder.serializeManifest(template);
      const validation = apiClient.validateAgentDraft && template
        ? await apiClient.validateAgentDraft(template.id, manifest)
        : apiClient.validateTemplate
          ? await apiClient.validateTemplate(manifest)
          : { valid: true, issues: [] };
      state.edgeErrors = new Map();
      state.validationIssues = normalizeValidationIssues(validation, workflowView);
      state.configFieldErrors = configErrorsByNode(state.validationIssues, workflowView);
      state.nodeConfigValidation = selectedConfigValidation(state.selectedNodeId, state.configFieldErrors, workflowView);
      state.lastValidation = validation;
      state.status = validation.valid ? (state.dirty ? "dirty" : "saved") : "validation";
      state.publish.lastValidated = Boolean(validation.valid);
      state.validationIssues.forEach((issue) => {
        if (issue.target?.kind === "edge") {
          state.edgeErrors.set(issue.target.index, issue);
        }
      });
      return validation;
    },
    async previewDraft(options = {}) {
      state.preview = "previewing";
      const manifest = builder.serializeManifest(options.template);
      const response = apiClient.previewTemplate
        ? await apiClient.previewTemplate(manifest, options)
        : { status: "previewed", manifest };
      state.preview = "idle";
      return response;
    },
    async startTestRun(payload = {}) {
      const versionId = state.publish.version?.id;
      if (!versionId || !apiClient.startAgentTestRun) {
        return { status: "blocked", reason: "published_version_required" };
      }
      state.runtimeNodeStatus = new Map();
      state.runtimeEvents = [];
      state.selectedRuntimeNodeId = null;
      state.testRun = { status: "running", runId: null, output: null, error: null };
      try {
        const response = await apiClient.startAgentTestRun(versionId, payload);
        state.testRun = {
          status: response.status ?? "completed",
          runId: response.run_id ?? null,
          output: response.output ?? null,
          error: null,
        };
        return response;
      } catch (error) {
        state.testRun = {
          status: "failed",
          runId: null,
          output: null,
          error: { message: error.message },
        };
        return { status: "failed", error };
      }
    },
    async startAndStreamTestRun(payload = {}) {
      const started = await this.startTestRun(payload);
      if (!started.run_id || !apiClient.streamAgentTestRunEvents) {
        return started;
      }
      for await (const event of apiClient.streamAgentTestRunEvents(started.run_id)) {
        this.applyTestRunEvent(event);
        if (event.type === "graph_finished") {
          state.testRun.status = "completed";
          state.testRun.output = event.data?.output ?? state.testRun.output;
        }
        if (event.type === "graph_failed" || event.type === "error") {
          state.testRun.status = "failed";
          state.testRun.error = { message: event.data?.message ?? event.data?.error ?? "Agent test run failed" };
        }
      }
      return { ...started, status: state.testRun.status, output: state.testRun.output };
    },
    applyTestRunEvent(event) {
      state.runtimeEvents.push({ type: event.type, data: { ...(event.data ?? {}) } });
      const nodeId = event?.data?.node_id;
      if (!nodeId) {
        return this.view().canvas;
      }
      if (event.type === "node_started") {
        state.runtimeNodeStatus.set(nodeId, "running");
      }
      if (event.type === "node_finished") {
        state.runtimeNodeStatus.set(nodeId, "success");
      }
      if (event.type === "node_failed" || event.type === "graph_failed") {
        state.runtimeNodeStatus.set(nodeId, "error");
      }
      return this.view().canvas;
    },
    inspectRuntimeNode(nodeId) {
      state.selectedRuntimeNodeId = nodeId;
      return runtimeInspectorView(state);
    },
    async useAgent(template) {
      const versionId = state.publish.version?.id;
      if (!versionId || !apiClient.createSessionForWorkflow) {
        return { status: "blocked", reason: "published_version_required" };
      }
      const session = await apiClient.createSessionForWorkflow({
        agent_template_id: template.id,
        agent_version_id: versionId,
        title: template.name,
        workspace_id: "studio",
        metadata: { source: "workflow-builder" },
      });
      return {
        status: "created",
        session,
        navigation: {
          route: "/chat",
          sessionId: session.id,
          timelineId: session.current_timeline_id ?? session.currentTimelineId ?? null,
        },
      };
    },
    async publishDraft(template) {
      if (!state.publish.lastValidated || state.status === "validation") {
        return { status: "blocked", reason: "validation_failed" };
      }
      if (apiClient.publishAgent && template?.id) {
        state.publish.status = "publishing";
        const response = await apiClient.publishAgent(template.id);
        state.publish.status = "published";
        state.publish.version = response;
        state.publish.changeSummary = {
          templateId: template.id,
          version: response.version,
          checksum: response.checksum,
        };
        state.dirty = false;
        state.status = "saved";
        return response;
      }
      const manifest = builder.serializeManifest(template);
      state.publish.status = "publishing";
      const response = apiClient.publishTemplate
        ? await apiClient.publishTemplate(manifest)
        : { status: "published", version: manifest.template.version };
      state.publish.status = "published";
      state.publish.version = response.version ?? manifest.template.version;
      state.publish.changeSummary = {
        templateId: manifest.template.id,
        version: state.publish.version,
        nodes: manifest.runtime.nodes.length,
        edges: manifest.runtime.edges.length,
      };
      state.dirty = false;
      state.status = "saved";
      return response;
    },
    serializeManifest(template) {
      return builder.serializeManifest(template);
    },
    async saveDraft(template) {
      return this.save(template);
    },
    async loadDraft(agentId) {
      if (!apiClient.fetchAgentDraft) {
        throw new Error("apiClient.fetchAgentDraft is required to load an agent draft");
      }
      state.status = "loading";
      try {
        const response = await apiClient.fetchAgentDraft(agentId);
        const manifest = response.draft_manifest ?? response.manifest;
        builder.loadManifest(manifest);
        configDrafts.clear();
        draftDirty.clear();
        state.selectedNodeId = null;
        state.dirty = false;
        state.status = "saved";
        return { status: "loaded", manifest };
      } catch (error) {
        state.status = "error";
        state.lastValidation = { valid: false, error: { code: "load_failed", message: error.message } };
        return { status: "failed", error };
      }
    },
    requestNavigation(target) {
      if (state.dirty) {
        return {
          allowed: false,
          target,
          reason: "unsaved_changes",
          message: "You have unsaved workflow changes.",
        };
      }
      return { allowed: true, target };
    },
    async save(template) {
      state.status = "saving";
      flushConfigDrafts(builder, configDrafts, draftDirty);
      if (apiClient.saveAgentDraft) {
        const manifest = runtimeManifest(builder.view(), template);
        try {
          if (apiClient.validateAgentDraft) {
            const validation = await apiClient.validateAgentDraft(template.id, manifest);
            if (!validation.valid) {
              state.status = "validation";
              state.lastValidation = validation;
              return { status: "rejected", authority: "backend", error: validation.error ?? validation.errors?.[0] };
            }
          }
          const result = await apiClient.saveAgentDraft(template.id, manifest);
          configDrafts.clear();
          draftDirty.clear();
          state.dirty = false;
          state.status = "saved";
          return result?.status ? result : { status: "saved", manifest };
        } catch (error) {
          state.dirty = true;
          state.status = "error";
          state.lastValidation = { valid: false, error: { code: "save_failed", message: error.message } };
          return { status: "failed", error };
        }
      }
      let result;
      try {
        result = await builder.save(template);
      } catch (error) {
        state.dirty = true;
        state.status = "error";
        state.lastValidation = { valid: false, error: { code: "save_failed", message: error.message } };
        return { status: "failed", error };
      }
      if (result.status === "saved") {
        configDrafts.clear();
        draftDirty.clear();
        state.dirty = false;
        state.status = "saved";
      } else {
        state.status = "validation";
      }
      return result;
    },
    view() {
      const layoutView = layout.view();
      const workflowView = builder.view();
      const selected = selectedNode(workflowView, state.selectedNodeId);
      const selectedDraft = selectedNodeDraft(workflowView, state.selectedNodeId, configDrafts);
      const configErrors = state.selectedNodeId ? state.configFieldErrors.get(state.selectedNodeId) ?? new Map() : new Map();

      return {
        kind: "workflow-workbench",
        header: {
          title: "Workflow",
          status: state.status,
          dirty: state.dirty,
          validation: state.lastValidation,
          publish: state.publish,
          actions: {
            save: { enabled: state.dirty, status: state.status === "saving" ? "saving" : "idle" },
            preview: { enabled: true, status: state.preview ?? "idle" },
            publish: {
              enabled: state.publish.lastValidated && state.status !== "validation",
              status: state.publish.status,
              reason: state.publish.lastValidated && state.status !== "validation" ? "" : "validation_failed",
            },
          },
        },
        columns: [
          { id: "node-library", role: "navigation", width: layoutView.panels.left.width },
          { id: "canvas", role: "main", width: layoutView.panels.main.width, minWidth: layoutView.panels.main.minWidth },
          {
            id: "node-config",
            role: "complementary",
            width: layoutView.panels.right.width,
            mode: layoutView.panels.right.mode,
          },
        ],
        nodeLibrary: {
          query: state.nodeLibraryQuery,
          items: libraryItems(builder, options.manifestSchema, state.nodeLibraryQuery),
        },
        canvas: {
          role: "workflow-canvas",
          width: layoutView.panels.main.width,
          minWidth: layoutView.panels.main.minWidth,
          toolbar: {
            activeTool: state.activeCanvasTool,
            tools: CANVAS_TOOLS.map((id) => ({ id, active: id === state.activeCanvasTool })),
          },
          viewport: {
            mode: state.canvasViewport.mode,
            bounds: state.canvasViewport.bounds ? { ...state.canvasViewport.bounds } : null,
            zoom: state.canvasViewport.zoom,
            minZoom: MIN_CANVAS_ZOOM,
            maxZoom: MAX_CANVAS_ZOOM,
            panning: Boolean(state.canvasPan),
            panMoved: Boolean(state.canvasPan?.moved),
          },
          boundaryNodes: boundaryNodes(),
          nodes: workflowView.nodes.map((node) => canvasNode(node, state)),
          edges: workflowView.edges.map((edge, index) => canvasEdge(edge, index, state.edgeErrors, state.selectedEdgeId)),
          selectedEdgeId: state.selectedEdgeId,
        },
        nodeConfig: {
          selectedNodeId: state.selectedNodeId,
          draft: selectedDraft,
          schemaDriven: true,
          identity: nodeIdentityFields(selected),
          actions: {
            delete: {
              label: "Delete Node",
              tone: "danger",
              enabled: Boolean(state.selectedNodeId),
              confirmRequired: true,
            },
          },
          sections: nodeConfigSections(selected, selectedDraft, configErrors, state),
          validation: state.nodeConfigValidation,
          hasUncommittedChanges: state.selectedNodeId ? draftDirty.has(state.selectedNodeId) : false,
        },
        refreshProtection: {
          enabled: state.dirty,
          message: state.dirty ? "You have unsaved workflow changes." : "",
        },
        validationPanel: {
          issues: state.validationIssues,
        },
        testRun: {
          ...state.testRun,
          error: state.testRun.error ? { ...state.testRun.error } : null,
          trace: state.runtimeEvents.map(cloneRuntimeEvent),
        },
        runtimeInspector: runtimeInspectorView(state),
      };
    },
  };
}

function selectedNodeConfig(workflowView, nodeId) {
  return { ...(workflowView.nodes.find((node) => node.id === nodeId)?.config ?? {}) };
}

function nodeIdentityFields(node) {
  if (!node) {
    return [];
  }
  return [
    readonlyField("id", "ID", node.id),
    readonlyField("type", "Type", node.type),
  ];
}

function readonlyField(path, label, value) {
  return {
    path,
    label,
    value,
    visibility: "visible",
    editable: false,
    readonly: true,
    disabled: true,
    required: false,
    error: null,
  };
}

function editableConfigPatch(node, patch) {
  if (!node || !patch || typeof patch !== "object") {
    return {};
  }
  const editablePaths = editableConfigPaths(node.type);
  return Object.fromEntries(Object.entries(patch).filter(([path]) => editablePaths.has(path)));
}

function editableConfigPaths(nodeType) {
  return new Set(configFields(nodeType).filter(isEditableConfigField).map((field) => field.path));
}

function configFields(nodeType) {
  return (NODE_CONFIG_SCHEMAS[nodeType] ?? []).flatMap((section) => section.fields);
}

function visibleConfigFields(section) {
  return section.fields.filter((field) => field.visibility !== "hidden");
}

function isEditableConfigField(field) {
  return field.visibility !== "hidden" && field.editable !== false;
}

function fieldViewDefaults(field) {
  const editable = isEditableConfigField(field);
  return {
    visibility: field.visibility ?? "visible",
    editable,
    readonly: !editable,
    disabled: !editable,
    example: field.example ?? "",
    binding: field.binding ?? null,
    sourceField: field.sourceField ?? null,
    requiredLabel: field.required ? "*" : "",
  };
}

function valuesEquivalent(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function flushConfigDrafts(builder, configDrafts, draftDirty) {
  for (const nodeId of draftDirty) {
    const draft = configDrafts.get(nodeId);
    if (draft) {
      builder.updateNodeConfig(nodeId, draft);
    }
  }
}

function canvasViewportView(viewport) {
  return {
    mode: viewport.mode,
    bounds: viewport.bounds ? { ...viewport.bounds } : null,
    zoom: viewport.zoom,
    minZoom: MIN_CANVAS_ZOOM,
    maxZoom: MAX_CANVAS_ZOOM,
  };
}

function clampZoom(value) {
  return Math.max(MIN_CANVAS_ZOOM, Math.min(MAX_CANVAS_ZOOM, Number(value.toFixed(2))));
}

function runtimeManifest(workflowView, template) {
  return serializeGraph({
    template,
    nodes: workflowView.nodes,
    edges: workflowView.edges,
    viewport: workflowView.canvas?.viewport ?? {},
  });
}

function runtimeInspectorView(state) {
  const events = state.runtimeEvents.filter((event) => event.data?.node_id === state.selectedRuntimeNodeId);
  return {
    selectedNodeId: state.selectedRuntimeNodeId,
    events: events.map((event) => ({ type: event.type, data: { ...event.data } })),
    latestOutput: latestRuntimeOutput(events),
  };
}

function latestRuntimeOutput(events) {
  for (const event of [...events].reverse()) {
    if (event.data?.output !== undefined) {
      return event.data.output;
    }
    if (event.data?.result !== undefined) {
      return event.data.result;
    }
  }
  return null;
}

function cloneRuntimeEvent(event) {
  return { type: event.type, data: { ...(event.data ?? {}) } };
}

function cloneToolMetadata(tool) {
  return {
    ...tool,
    input_schema: { ...(tool.input_schema ?? {}) },
    output_schema: { ...(tool.output_schema ?? {}) },
    config_schema: { ...(tool.config_schema ?? {}) },
  };
}

function selectedNode(workflowView, nodeId) {
  return workflowView.nodes.find((node) => node.id === nodeId) ?? null;
}

function nodeConfigSections(node, draft, fieldErrors, state) {
  if (!node) {
    return [];
  }
  return (NODE_CONFIG_SCHEMAS[node.type] ?? []).map((section) => ({
    id: section.id,
    fields: visibleConfigFields(section).map((field) => nodeConfigFieldView(field, draft, fieldErrors, state)),
  })).filter((section) => section.fields.length > 0);
}

function nodeConfigFieldView(field, draft, fieldErrors, state) {
  const base = {
    path: field.path,
    label: field.label,
    required: Boolean(field.required),
    ...fieldViewDefaults(field),
    value: valueAtPath(draft, field.path),
    error: fieldErrors.get(field.path) ?? null,
  };
  if (field.path !== "tool_name") {
    return base;
  }
  const selectedTool = state.toolCatalog.find((tool) => tool.id === base.value) ?? state.toolCatalog[0] ?? null;
  return {
    ...base,
    options: state.toolCatalog.map((tool) => ({ value: tool.id, label: tool.name || tool.id })),
    metadata: selectedTool ? cloneToolMetadata(selectedTool) : null,
  };
}

function validateNodeConfig(node, draft) {
  if (!node) {
    return [];
  }
  return (NODE_CONFIG_SCHEMAS[node.type] ?? [])
    .flatMap((section) => {
      return visibleConfigFields(section)
        .filter((field) => field.required && isBlank(valueAtPath(draft, field.path)))
        .map((field) => ({
          sectionId: section.id,
          fieldPath: `runtime.nodes[${node.id}].config.${field.path}`,
          code: "required",
          message: `${field.label} is required`,
          controlPath: field.path,
        }));
    })
    .map(({ controlPath, ...error }) => error);
}

function valueAtPath(source, path) {
  return path.split(".").reduce((value, segment) => {
    if (!value || typeof value !== "object") {
      return undefined;
    }
    return value[segment];
  }, source);
}

function isBlank(value) {
  return value === undefined || value === null || value === "";
}

function fieldErrorMap(errors) {
  return new Map(errors.map((error) => [configPathFromFieldPath(error.fieldPath), error]));
}

function isDeleteKey(key) {
  return key === "Delete" || key === "Backspace";
}

function isEditableTarget(targetRole) {
  return ["input", "textarea", "contenteditable"].includes(targetRole);
}

function isInteractiveCanvasTarget(targetRole) {
  return ["node", "edge", "button", "input", "textarea", "select", "contenteditable"].includes(targetRole);
}

function graphBounds(nodes) {
  if (nodes.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  const positions = nodes.map((node) => node.position ?? { x: 0, y: 0 });
  return {
    minX: Math.min(...positions.map((position) => position.x)),
    minY: Math.min(...positions.map((position) => position.y)),
    maxX: Math.max(...positions.map((position) => position.x)),
    maxY: Math.max(...positions.map((position) => position.y)),
  };
}

function validateEdgeDraft(workflowView, edge) {
  const nodes = new Set(workflowView.nodes.map((node) => node.id));
  const validSources = new Set([...nodes, "START"]);
  const validTargets = new Set([...nodes, "END"]);
  if (!validSources.has(edge.from) || !validTargets.has(edge.to)) {
    return {
      fieldPath: "runtime.edges",
      code: "unknown_node",
      message: "Edge endpoints must reference existing workflow nodes",
      target: { kind: "edge", from: edge.from, to: edge.to },
    };
  }
  const sourceNode = workflowView.nodes.find((node) => node.id === edge.from);
  if (sourceNode?.type === "condition" && edge.condition && !["true", "false"].includes(edge.condition)) {
    return {
      fieldPath: "runtime.edges",
      code: "condition_route_invalid",
      message: "Condition branch must be true or false",
      target: { kind: "edge", from: edge.from, to: edge.to },
    };
  }
  return null;
}

function canvasNode(node, state) {
  const runtimeStatus = state.runtimeNodeStatus.get(node.id);
  if (node.type !== "subgraph") {
    const withHandles = { ...node, handles: handlesFor(node) };
    return runtimeStatus ? { ...withHandles, runtimeStatus } : withHandles;
  }
  const internalNodeIds = Array.isArray(node.config?.internal_node_ids) ? node.config.internal_node_ids : [];
  const collapsed = state.collapsedSubgraphs.has(node.id);
  return {
    ...node,
    ...(runtimeStatus ? { runtimeStatus } : {}),
    visualRole: "subgraph-container",
    collapsed,
    summary: {
      internalNodeCount: internalNodeIds.length,
      internalNodeIds: [...internalNodeIds],
    },
    validationHint: collapsed ? subgraphValidationHint(internalNodeIds, state.validationIssues) : null,
  };
}

function subgraphValidationHint(internalNodeIds, validationIssues) {
  const internalIssueNodeIds = validationIssues
    .filter((issue) => issue.target?.kind === "node_config" && internalNodeIds.includes(issue.target.nodeId))
    .map((issue) => issue.target.nodeId);
  if (internalIssueNodeIds.length === 0) {
    return null;
  }
  return {
    kind: "subgraph_internal_validation",
    severity: "error",
    internalNodeIds: [...new Set(internalIssueNodeIds)],
    issueCount: internalIssueNodeIds.length,
  };
}

function canvasEdge(edge, index, edgeErrors, selectedEdgeId = null) {
  const error = edgeErrors.get(index) ?? null;
  const id = edgeIdFor(edge, index);
  return {
    ...edge,
    id,
    label: edge.condition ? branchLabel(edge.condition) : "",
    selected: id === selectedEdgeId,
    status: error ? "invalid" : "valid",
    error,
  };
}

function boundaryNodes() {
  return [
    { id: "START", type: "START", label: "Start", locked: true },
    { id: "END", type: "END", label: "End", locked: true },
  ];
}

function edgeIdFor(edge, index) {
  return `${index}:${edge.from}->${edge.to}${edge.condition ? `:${edge.condition}` : ""}`;
}

function parseEdgeId(edgeId) {
  return { index: Number(edgeId.split(":", 1)[0]) };
}

function branchLabel(condition) {
  if (condition === "true") {
    return "True";
  }
  if (condition === "false") {
    return "False";
  }
  return String(condition);
}

function handlesFor(node) {
  if (node.type === "condition") {
    return { inputs: ["in"], outputs: ["true", "false"] };
  }
  return { inputs: ["in"], outputs: ["out"] };
}

function normalizeValidationIssues(validation, workflowView) {
  const rawIssues = validation.issues ?? validation.errors ?? (validation.error ? [validation.error] : []);
  return rawIssues.map((issue) => {
    const fieldPath = issue.fieldPath ?? issue.field_path ?? issue.field ?? "";
    const edgeIndex = edgeIndexFromFieldPath(fieldPath);
    const edge = Number.isInteger(edgeIndex) ? workflowView.edges[edgeIndex] : null;
    const nodeIndex = nodeIndexFromFieldPath(fieldPath);
    const node = issue.node_id
      ? workflowView.nodes.find((item) => item.id === issue.node_id)
      : Number.isInteger(nodeIndex)
        ? workflowView.nodes[nodeIndex]
        : null;
    const configPath = configPathFromFieldPath(fieldPath);
    return {
      fieldPath,
      code: issue.code,
      ...(issue.message ? { message: issue.message } : {}),
      ...(edge
        ? {
            target: { kind: "edge", index: edgeIndex, from: edge.from, to: edge.to },
          }
        : {}),
      ...(node && configPath
        ? {
            sectionId: sectionIdForConfigPath(node.type, configPath),
            target: { kind: "node_config", nodeId: node.id, path: configPath },
          }
        : {}),
    };
  });
}

function edgeIndexFromFieldPath(fieldPath) {
  const match = /^(graph|runtime)\.edges\[(\d+)\]/.exec(fieldPath);
  return match ? Number(match[2]) : null;
}

function nodeIndexFromFieldPath(fieldPath) {
  const match = /^(graph|runtime)\.nodes\[(\d+)\]/.exec(fieldPath);
  return match ? Number(match[2]) : null;
}

function configPathFromFieldPath(fieldPath) {
  const match = /\.config\.(.+)$/.exec(fieldPath);
  return match ? match[1] : "";
}

function sectionIdForConfigPath(nodeType, configPath) {
  return (
    (NODE_CONFIG_SCHEMAS[nodeType] ?? []).find((section) => {
      return section.fields.some((field) => field.path === configPath);
    })?.id ?? ""
  );
}

function configErrorsByNode(issues, workflowView) {
  const errors = new Map();
  issues.forEach((issue) => {
    if (issue.target?.kind !== "node_config") {
      return;
    }
    const node = workflowView.nodes.find((item) => item.id === issue.target.nodeId);
    if (!node) {
      return;
    }
    const nodeErrors = errors.get(node.id) ?? new Map();
    nodeErrors.set(issue.target.path, {
      fieldPath: issue.fieldPath,
      code: issue.code,
      ...(issue.message ? { message: issue.message } : {}),
    });
    errors.set(node.id, nodeErrors);
  });
  return errors;
}

function selectedConfigValidation(selectedNodeId, configFieldErrors, workflowView) {
  if (!selectedNodeId) {
    return { valid: true, errors: [] };
  }
  const node = selectedNode(workflowView, selectedNodeId);
  const errors = [...(configFieldErrors.get(selectedNodeId)?.values() ?? [])].map((error) => ({
    sectionId: sectionIdForConfigPath(node?.type, configPathFromFieldPath(error.fieldPath)),
    fieldPath: error.fieldPath,
    code: error.code,
    ...(error.message ? { message: error.message } : {}),
  }));
  return { valid: errors.length === 0, errors };
}

function libraryItems(builder, manifestSchema, query) {
  const supported = supportedNodeTypes(builder, manifestSchema);
  const normalizedQuery = query.trim().toLowerCase();
  return NODE_LIBRARY.filter((node) => supported.has(node.type)).filter((node) => {
    if (!normalizedQuery) {
      return true;
    }
    return [node.type, node.label].some((value) => value.toLowerCase().includes(normalizedQuery));
  });
}

function supportedNodeTypes(builder, manifestSchema) {
  const builderTypes = new Set(builder.nodeLibrary().map((node) => node.type));
  if (!manifestSchema?.supportedNodeTypes) {
    return builderTypes;
  }
  return new Set(manifestSchema.supportedNodeTypes.filter((type) => builderTypes.has(type)));
}

function ensureSupportedType(type, builder, manifestSchema) {
  if (!supportedNodeTypes(builder, manifestSchema).has(type)) {
    throw new Error(`Workflow node type ${type} is not supported by the active workflow schema`);
  }
}

function nextNodeId(type, state) {
  const normalizedType = type.replace(/_/g, "-");
  const id = `${normalizedType}-${state.nextNodeNumber}`;
  state.nextNodeNumber += 1;
  return id;
}

function selectedNodeDraft(workflowView, nodeId, configDrafts) {
  if (!nodeId) {
    return null;
  }
  return { ...(configDrafts.get(nodeId) ?? selectedNodeConfig(workflowView, nodeId)) };
}
