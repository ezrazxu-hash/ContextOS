import { createWorkflowV2Builder } from "../../features/workflow-v2/WorkflowV2Builder.js";
import { createWorkflowV2SchemaBuilder } from "../../features/workflow-v2/WorkflowV2SchemaBuilder.js";
import { createWorkflowV2ToolPolicyEditor } from "../../features/workflow-v2/WorkflowV2ToolPolicyEditor.js";

export function createWorkflowV2Workbench(options = {}) {
  const apiClient = options.apiClient ?? {};
  const initialDefinition = options.workflowDefinition ?? null;
  const builder = createWorkflowV2Builder(initialDefinition);
  const state = {
    definition: initialDefinition
      ? { ...initialDefinition, nodes: builder.view().nodes, edges: builder.view().edges }
      : { id: "workflow", name: "Workflow", schemaVersion: 2, revision: 1, tools: [], nodes: [], edges: [] },
    selectedNodeId: null,
    validationIssues: [],
    toolCatalog: [],
    workflowCatalog: Array.isArray(options.workflowCatalog) ? options.workflowCatalog.map(cloneDefinition) : [],
    editorMode: options.editorMode === "advanced" ? "advanced" : "simple",
    versions: [],
    lastRun: null,
    saveStatus: "saved",
    nextNodeNumber: 1,
  };

  return {
    nodeLibrary() {
      return builder.nodeLibrary();
    },
    dropLibraryNode(type, position) {
      const node = { id: nextNodeId(type, state), type, position: { x: position.x, y: position.y }, config: {} };
      builder.addNode(node);
      state.selectedNodeId = node.id;
      syncDefinition(state, builder);
      return { node };
    },
    moveCanvasNode(nodeId, position) {
      const view = builder.updateNodePosition(nodeId, position);
      syncDefinition(state, builder);
      return { node: view.nodes.find((node) => node.id === nodeId) ?? null };
    },
    updateSelectedAgentConfig(patch) {
      if (!state.selectedNodeId) {
        throw new Error("No workflow node is selected");
      }
      const view = builder.updateAgentNodeConfig(state.selectedNodeId, patch);
      syncDefinition(state, builder);
      refreshReferenceIssues(state);
      return { node: view.nodes.find((node) => node.id === state.selectedNodeId) ?? null };
    },
    async loadWorkflowTools() {
      const response = apiClient.listWorkflowTools
        ? await apiClient.listWorkflowTools()
        : { tools: [] };
      state.toolCatalog = Array.isArray(response.tools) ? response.tools.map(cloneDefinition) : [];
      return this.view();
    },
    setWorkflowToolRegistry(toolIds) {
      state.definition = { ...state.definition, tools: Array.isArray(toolIds) ? toolIds.map(String) : [] };
      return this.view();
    },
    updateSelectedToolPolicy(policy) {
      const selectedNode = selectedAgentNode(state, builder);
      const editor = createWorkflowV2ToolPolicyEditor({
        catalog: state.toolCatalog,
        workflowTools: workflowToolIds(state.definition),
        policy: { ...(selectedNode.config?.toolPolicy ?? { mode: "disabled" }), ...policy },
      });
      const view = builder.updateAgentNodeConfig(selectedNode.id, { toolPolicy: editor.view().policy });
      syncDefinition(state, builder);
      return { node: view.nodes.find((node) => node.id === selectedNode.id) ?? null, toolSelector: editor.view() };
    },
    updateSelectedConditionConfig(patch) {
      const selectedNode = selectedConditionNode(state, builder);
      const view = builder.updateConditionNodeConfig(selectedNode.id, patch);
      syncDefinition(state, builder);
      refreshReferenceIssues(state);
      return { node: view.nodes.find((node) => node.id === selectedNode.id) ?? null, conditionInspector: conditionInspectorView(state, view.nodes, selectedNode.id) };
    },
    addSelectedConditionBranch({ branch, target } = {}) {
      const selectedNode = selectedConditionNode(state, builder);
      const nextBranch = cloneDefinition(branch ?? {});
      const currentBranches = Array.isArray(selectedNode.config?.branches) ? selectedNode.config.branches : [];
      const edgeView = builder.connect(selectedNode.id, target, nextBranch.handle ? { sourceHandle: nextBranch.handle } : {});
      const view = builder.updateConditionNodeConfig(selectedNode.id, { branches: [...currentBranches, nextBranch] });
      syncDefinition(state, builder);
      refreshReferenceIssues(state);
      return {
        node: view.nodes.find((node) => node.id === selectedNode.id) ?? null,
        edge: edgeView.edges[edgeView.edges.length - 1] ?? null,
        conditionInspector: conditionInspectorView(state, view.nodes, selectedNode.id),
      };
    },
    updateSelectedEndConfig(patch) {
      const selectedNode = selectedEndNode(state, builder);
      const view = builder.updateEndNodeConfig(selectedNode.id, patch);
      syncDefinition(state, builder);
      return { node: view.nodes.find((node) => node.id === selectedNode.id) ?? null, endInspector: endInspectorView(view.nodes, selectedNode.id) };
    },
    updateSelectedWorkflowRefConfig(patch) {
      const selectedNode = selectedWorkflowRefNode(state, builder);
      const view = builder.updateWorkflowRefNodeConfig(selectedNode.id, patch);
      syncDefinition(state, builder);
      refreshReferenceIssues(state);
      return { node: view.nodes.find((node) => node.id === selectedNode.id) ?? null, workflowInspector: workflowInspectorView(state, view.nodes, selectedNode.id) };
    },
    addOutputSchemaField(field) {
      const selectedNode = selectedAgentNode(state, builder);
      const schemaBuilder = createWorkflowV2SchemaBuilder(selectedNode.config?.outputSchema ?? null);
      schemaBuilder.addField(field);
      const view = builder.updateAgentNodeConfig(selectedNode.id, { outputSchema: schemaBuilder.toJsonSchema() });
      syncDefinition(state, builder);
      refreshReferenceIssues(state);
      return {
        node: view.nodes.find((node) => node.id === selectedNode.id) ?? null,
        schemaBuilder: schemaBuilder.view(),
      };
    },
    connectCanvasEdge(source, target, options = {}) {
      const view = builder.connect(source, target, options);
      syncDefinition(state, builder);
      return { accepted: true, edge: canvasEdge(view.edges[view.edges.length - 1], view.edges.length - 1, view.nodes) };
    },
    updateCanvasEdge(edgeId, patch) {
      const view = builder.updateEdge(edgeId, patch);
      syncDefinition(state, builder);
      refreshReferenceIssues(state);
      const edgeIndex = edgeIndexFromId(edgeId);
      const edge = edgeIndex >= 0 ? view.edges[edgeIndex] ?? null : null;
      return { edge: edge ? canvasEdge(edge, edgeIndex, view.nodes) : null };
    },
    removeCanvasEdge(edgeId) {
      const view = builder.removeEdge(edgeId);
      syncDefinition(state, builder);
      refreshReferenceIssues(state);
      return view;
    },
    removeNode(nodeId) {
      const view = builder.removeNode(nodeId);
      if (state.selectedNodeId === nodeId) {
        state.selectedNodeId = null;
      }
      syncDefinition(state, builder);
      return view;
    },
    selectNode(nodeId) {
      state.selectedNodeId = builder.view().nodes.some((node) => node.id === nodeId) ? nodeId : null;
      return this.view();
    },
    setEditorMode(mode) {
      state.editorMode = mode === "advanced" ? "advanced" : "simple";
      return this.view();
    },
    setDraftRevision(revision) {
      const numeric = Number(revision);
      if (Number.isFinite(numeric) && numeric > 0) {
        state.definition = { ...state.definition, revision: Math.floor(numeric) };
      }
      return this.view();
    },
    validate() {
      const validation = builder.validate();
      const referenceIssues = schemaReferenceIssues(state.definition, state.workflowCatalog);
      state.validationIssues = [...validation.errors, ...referenceIssues].map(cloneIssue);
      return { valid: state.validationIssues.length === 0, errors: state.validationIssues.map(cloneIssue) };
    },
    async validateWithBackend() {
      const validation = apiClient.validateWorkflow
        ? await apiClient.validateWorkflow(state.definition.id, cloneDefinition(state.definition))
        : this.validate();
      state.validationIssues = (validation.errors ?? validation.issues ?? []).map(cloneIssue);
      return validation;
    },
    async publishWorkflow() {
      const validation = await this.validateWithBackend();
      if (!validation.valid) {
        throw new Error("Workflow validation failed");
      }
      if (!apiClient.publishWorkflow) {
        throw new Error("apiClient.publishWorkflow is required");
      }
      try {
        const published = await apiClient.publishWorkflow(state.definition.id);
        await this.refreshWorkflowVersions();
        return cloneDefinition(published);
      } catch (error) {
        const issues = error?.validation?.errors ?? error?.errors ?? [];
        state.validationIssues = issues.map(cloneIssue);
        throw error;
      }
    },
    async refreshWorkflowVersions() {
      if (!apiClient.listWorkflowVersions) {
        state.versions = [];
        return this.view();
      }
      const response = await apiClient.listWorkflowVersions(state.definition.id);
      state.versions = Array.isArray(response.versions) ? response.versions.map(cloneDefinition) : [];
      return this.view();
    },
    async startRun(payload) {
      if (!payload?.version) {
        throw new Error("Workflow run requires an explicit published version");
      }
      if (!apiClient.startWorkflowRun) {
        throw new Error("apiClient.startWorkflowRun is required");
      }
      state.lastRun = { status: "running", streamStatus: "idle", runId: null, workflowVersion: payload.version, output: null, error: null, finalResult: null, artifacts: [], nodeResults: [], messages: [], executionDetails: { nodes: [] }, timeline: [], nodeStatuses: new Map(), lastSequence: 0 };
      const run = await apiClient.startWorkflowRun(state.definition.id, cloneDefinition(payload));
      state.lastRun = normalizeRun(run);
      return cloneDefinition(run);
    },
    async subscribeRunEvents(options = {}) {
      if (!state.lastRun?.runId) {
        throw new Error("No workflow run is available");
      }
      if (!apiClient.streamWorkflowRunEvents) {
        throw new Error("apiClient.streamWorkflowRunEvents is required");
      }
      state.lastRun.streamStatus = "connected";
      try {
        for await (const rawEvent of apiClient.streamWorkflowRunEvents(state.lastRun.runId, options)) {
          applyRunEvent(state.lastRun, normalizeRunEvent(rawEvent));
        }
        state.lastRun.streamStatus = "closed";
      } catch (error) {
        state.lastRun.streamStatus = "disconnected";
        throw error;
      }
      return this.view();
    },
    async cancelRun() {
      if (!state.lastRun?.runId) {
        throw new Error("No workflow run is available");
      }
      if (!apiClient.cancelWorkflowRun) {
        throw new Error("apiClient.cancelWorkflowRun is required");
      }
      const run = await apiClient.cancelWorkflowRun(state.lastRun.runId);
      state.lastRun = normalizeRun(run);
      return cloneDefinition(run);
    },
    async loadRunDetail(runId) {
      if (!apiClient.fetchWorkflowRun) {
        throw new Error("apiClient.fetchWorkflowRun is required");
      }
      const run = await apiClient.fetchWorkflowRun(runId);
      const [nodes, messages, artifacts] = await Promise.all([
        apiClient.fetchWorkflowRunNodes ? apiClient.fetchWorkflowRunNodes(runId) : { nodes: [] },
        apiClient.fetchWorkflowRunMessages ? apiClient.fetchWorkflowRunMessages(runId) : { messages: [] },
        apiClient.listWorkflowRunArtifacts ? apiClient.listWorkflowRunArtifacts(runId) : { artifacts: [] },
      ]);
      state.lastRun = normalizeRun(run);
      state.lastRun.messages = [];
      state.lastRun.historyDetail = {
        nodes: Array.isArray(nodes.nodes) ? nodes.nodes.map(cloneDefinition) : [],
        messages: Array.isArray(messages.messages) ? messages.messages.map(messageView) : [],
        artifacts: Array.isArray(artifacts.artifacts) ? artifacts.artifacts.map(artifactRef) : [],
      };
      return this.view();
    },
    async downloadArtifact(artifactId) {
      if (!apiClient.downloadWorkflowArtifactContent) {
        throw new Error("apiClient.downloadWorkflowArtifactContent is required");
      }
      return apiClient.downloadWorkflowArtifactContent(artifactId);
    },
    async saveDraft() {
      if (!apiClient.saveWorkflowDraft) {
        throw new Error("apiClient.saveWorkflowDraft is required");
      }
      const saved = await apiClient.saveWorkflowDraft(state.definition.id, cloneDefinition(state.definition));
      state.definition = cloneDefinition(saved);
      state.saveStatus = "saved";
      return cloneDefinition(saved);
    },
    view() {
      const workflowView = builder.view();
      const selectedNode = workflowView.nodes.find((node) => node.id === state.selectedNodeId) ?? null;
      const nodeRunStatusById = nodeRunStatuses(state.lastRun);
      return {
        kind: "agent-workflow-v2-workbench",
        schemaVersion: 2,
        editorMode: state.editorMode,
        nodeLibrary: {
          items: builder.nodeLibrary(),
        },
        canvas: {
          role: "workflow-v2-canvas",
          nodes: workflowView.nodes.map((node) => ({
            ...cardNode(node, state),
            handles: nodeHandles(node, workflowView.edges),
            runStatus: nodeRunStatusById.get(node.id) ?? "pending",
          })),
          edges: workflowView.edges.map((edge, index) => canvasEdge(edge, index, workflowView.nodes)),
        },
        edgeConfig: edgeConfigView(workflowView),
        nodeConfig: {
          selectedNodeId: state.selectedNodeId,
          groups: selectedNode?.type === "agent" ? agentInspectorGroups() : selectedNode?.type === "condition" ? conditionInspectorGroups() : selectedNode?.type === "end" ? endInspectorGroups() : selectedNode?.type === "workflow" ? workflowInspectorGroups() : [],
          visibleGroups: selectedNode ? visibleInspectorGroups(selectedNode, state.editorMode) : [],
          fields: selectedNode ? inspectorFieldsForNode(selectedNode, workflowView.edges) : [],
          branchNext: selectedNode ? branchNextView(selectedNode, workflowView.edges) : [],
          value: selectedNode?.type === "agent" || selectedNode?.type === "workflow" ? cloneDefinition(selectedNode.config ?? {}) : null,
          schemaBuilder: selectedNode?.type === "agent"
            ? createWorkflowV2SchemaBuilder(selectedNode.config?.outputSchema ?? null).view()
            : null,
          toolSelector: selectedNode?.type === "agent"
            ? createWorkflowV2ToolPolicyEditor({
              catalog: state.toolCatalog,
              workflowTools: workflowToolIds(state.definition),
              policy: selectedNode.config?.toolPolicy ?? { mode: "disabled" },
            }).view()
            : null,
          conditionInspector: selectedNode?.type === "condition"
            ? conditionInspectorView(state, workflowView.nodes, selectedNode.id)
            : null,
          endInspector: selectedNode?.type === "end"
            ? endInspectorView(workflowView.nodes, selectedNode.id)
            : null,
          workflowInspector: selectedNode?.type === "workflow"
            ? workflowInspectorView(state, workflowView.nodes, selectedNode.id)
            : null,
        },
        validationPanel: {
          issues: state.validationIssues.map(cloneIssue),
          locators: validationLocators(state.validationIssues),
        },
        workflowTools: {
          catalog: state.toolCatalog.map(cloneDefinition),
          selectedIds: workflowToolIds(state.definition),
        },
        toolbar: {
          saveStatus: state.saveStatus,
          draftRevision: state.definition.revision,
          actions: ["validate", "publish", "run"],
          versions: state.versions.map(cloneDefinition),
        },
        runPanel: state.lastRun ? runPanel(state.lastRun, state.selectedNodeId, workflowView.nodes) : null,
        draft: {
          revision: state.definition.revision,
        },
      };
    },
  };
}

function normalizeRun(run) {
  const nodeStatuses = new Map();
  (Array.isArray(run.nodeResults) ? run.nodeResults : []).forEach((result) => {
    nodeStatuses.set(result.nodeId, result.status);
  });
  return {
    status: run.status,
    streamStatus: run.streamStatus ?? "closed",
    runId: run.id ?? run.runId ?? null,
    workflowVersion: run.workflowVersion,
    output: run.output ?? null,
    error: run.error ?? null,
    finalResult: run.finalResult ? cloneDefinition(run.finalResult) : null,
    artifacts: Array.isArray(run.artifacts) ? run.artifacts.map(artifactRef) : [],
    nodeResults: Array.isArray(run.nodeResults) ? run.nodeResults.map(cloneDefinition) : [],
    messages: Array.isArray(run.messages) ? run.messages.map(messageView) : [],
    executionDetails: run.executionDetails ? executionDetailsView(run.executionDetails) : { nodes: [] },
    timeline: Array.isArray(run.events) ? run.events.map(normalizeRunEvent) : [],
    historyDetail: run.historyDetail ?? null,
    nodeStatuses,
    lastSequence: Array.isArray(run.events) ? run.events.reduce((max, event) => Math.max(max, Number(event.sequence) || 0), 0) : 0,
  };
}

function nodeRunStatuses(run) {
  if (run?.nodeStatuses) {
    return new Map(run.nodeStatuses);
  }
  return new Map();
}

function runPanel(run, selectedNodeId = null, workflowNodes = []) {
  const details = nodeExecutionDetails(run, workflowNodes);
  const panel = {
    status: run.status,
    runId: run.runId,
    workflowVersion: run.workflowVersion,
    output: run.output,
    error: run.error,
    messages: run.messages.map(cloneDefinition),
    executionDetails: cloneDefinition(run.executionDetails),
  };
  if (run.streamStatus && run.streamStatus !== "closed") {
    panel.streamStatus = run.streamStatus;
  }
  if (run.status === "running") {
    panel.actions = ["cancel"];
  }
  if (run.error?.code === "WORKFLOW_LIMIT_EXCEEDED") {
    panel.failure = failureView(run.error);
  }
  if (run.timeline.length > 0) {
    panel.timeline = run.timeline.map(cloneDefinition);
  }
  if (run.finalResult) {
    panel.finalResult = {
      ...cloneDefinition(run.finalResult),
      artifacts: artifactsView(run.finalResult.artifacts),
    };
  }
  if (run.artifacts.length > 0) {
    panel.artifacts = artifactsView(run.artifacts);
  }
  if (run.historyDetail) {
    panel.historyDetail = historyDetailView(run);
  }
  if (details.length > 0) {
    panel.nodeExecutionDetails = details;
  }
  if (selectedNodeId) {
    panel.selectedNodeExecution = details.find((node) => node.nodeId === selectedNodeId) ?? null;
  }
  return panel;
}

function historyDetailView(run) {
  const tabs = ["result", "timeline", "nodes", "messages"];
  if ((run.historyDetail.artifacts ?? []).length > 0 || run.artifacts.length > 0) {
    tabs.push("artifacts");
  }
  if (run.error) {
    tabs.push("error");
  }
  return {
    tabs,
    workflowVersion: run.workflowVersion,
    status: run.status,
    output: cloneDefinition(run.output),
    finalResult: run.finalResult ? cloneDefinition(run.finalResult) : null,
    timeline: run.timeline.map(cloneDefinition),
    nodes: (run.historyDetail.nodes ?? []).map(cloneDefinition),
    messages: (run.historyDetail.messages ?? []).map(cloneDefinition),
    artifacts: artifactsView(run.historyDetail.artifacts ?? run.artifacts),
    error: run.error ? cloneDefinition(run.error) : null,
  };
}

function applyRunEvent(run, event) {
  if (!event || event.sequence <= run.lastSequence) {
    return;
  }
  run.lastSequence = event.sequence;
  run.timeline.push(cloneDefinition(event));
  if (event.eventType === "WorkflowStarted") {
    run.status = "running";
  }
  if (event.eventType === "WorkflowCompleted") {
    run.status = "succeeded";
    run.finalResult = event.payload?.finalResult ? cloneDefinition(event.payload.finalResult) : run.finalResult;
  }
  if (event.eventType === "WorkflowFailed") {
    run.status = event.payload?.status === "cancelled" ? "cancelled" : "failed";
    run.error = event.payload?.error ? cloneDefinition(event.payload.error) : run.error;
  }
  if (event.nodeId && event.eventType === "NodeStarted") {
    run.nodeStatuses.set(event.nodeId, "running");
  }
  if (event.nodeId && event.eventType === "NodeCompleted") {
    run.nodeStatuses.set(event.nodeId, "succeeded");
    upsertNodeResult(run, event.nodeId, "succeeded", event.payload?.data ?? null);
  }
  if (event.nodeId && event.eventType === "NodeFailed") {
    run.nodeStatuses.set(event.nodeId, "failed");
    upsertNodeResult(run, event.nodeId, "failed", null);
  }
  appendExecutionStepFromEvent(run, event);
}

function failureView(error) {
  return {
    code: error.code,
    message: error.message,
    limit: error.limit ?? null,
    nodeId: error.nodeId ?? null,
  };
}

function normalizeRunEvent(rawEvent) {
  const event = rawEvent?.data?.eventType ? rawEvent.data : rawEvent;
  return {
    runId: event?.runId ?? null,
    nodeId: event?.nodeId ?? null,
    timestamp: event?.timestamp ?? null,
    sequence: Number(event?.sequence) || 0,
    eventType: event?.eventType ?? rawEvent?.type ?? "message",
    payload: event?.payload ?? {},
  };
}

function upsertNodeResult(run, nodeId, status, data) {
  const existing = run.nodeResults.find((result) => result.nodeId === nodeId);
  if (existing) {
    existing.status = status;
    if (data !== null) {
      existing.data = cloneDefinition(data);
    }
    return;
  }
  run.nodeResults.push({ nodeId, status, data });
}

function appendExecutionStepFromEvent(run, event) {
  if (!event.nodeId) {
    return;
  }
  const node = executionNode(run, event.nodeId);
  if (event.eventType === "LlmCallStarted") {
    node.steps.push({ type: "llm_call", index: event.payload?.index ?? null, status: "running" });
  }
  if (event.eventType === "ToolCallStarted") {
    node.steps.push({ type: "tool_call", toolCallId: event.payload?.toolCallId ?? null, name: event.payload?.name ?? null });
  }
  if (event.eventType === "ToolCallCompleted") {
    node.steps.push({ type: "tool_result", toolCallId: event.payload?.toolCallId ?? null, name: event.payload?.name ?? null, status: event.payload?.status ?? null, error: event.payload?.error ?? null });
  }
  if (event.eventType === "SchemaValidationSucceeded" || event.eventType === "SchemaValidationFailed") {
    node.steps.push({ type: "schema_validation", status: event.payload?.status ?? (event.eventType === "SchemaValidationSucceeded" ? "succeeded" : "failed"), error: event.payload?.error ?? null });
  }
  if (event.eventType === "NodeCompleted") {
    node.steps.push({ type: "node_result", status: "succeeded", data: event.payload?.data ?? null });
  }
}

function executionNode(run, nodeId) {
  let node = run.executionDetails.nodes.find((item) => item.nodeId === nodeId);
  if (!node) {
    node = { nodeId, steps: [] };
    run.executionDetails.nodes.push(node);
  }
  return node;
}

function nextNodeId(type, state) {
  const id = `${type}-${state.nextNodeNumber}`;
  state.nextNodeNumber += 1;
  return id;
}

function selectedAgentNode(state, builder) {
  if (!state.selectedNodeId) {
    throw new Error("No workflow node is selected");
  }
  const selectedNode = builder.view().nodes.find((node) => node.id === state.selectedNodeId);
  if (!selectedNode || selectedNode.type !== "agent") {
    throw new Error(`Selected workflow node is not an Agent node: ${state.selectedNodeId}`);
  }
  return selectedNode;
}

function selectedConditionNode(state, builder) {
  if (!state.selectedNodeId) {
    throw new Error("No workflow node is selected");
  }
  const selectedNode = builder.view().nodes.find((node) => node.id === state.selectedNodeId);
  if (!selectedNode || selectedNode.type !== "condition") {
    throw new Error(`Selected workflow node is not a Condition node: ${state.selectedNodeId}`);
  }
  return selectedNode;
}

function selectedEndNode(state, builder) {
  if (!state.selectedNodeId) {
    throw new Error("No workflow node is selected");
  }
  const selectedNode = builder.view().nodes.find((node) => node.id === state.selectedNodeId);
  if (!selectedNode || selectedNode.type !== "end") {
    throw new Error(`Selected workflow node is not an End node: ${state.selectedNodeId}`);
  }
  return selectedNode;
}

function selectedWorkflowRefNode(state, builder) {
  if (!state.selectedNodeId) {
    throw new Error("No workflow node is selected");
  }
  const selectedNode = builder.view().nodes.find((node) => node.id === state.selectedNodeId);
  if (!selectedNode || selectedNode.type !== "workflow") {
    throw new Error(`Selected workflow node is not a Workflow Ref node: ${state.selectedNodeId}`);
  }
  return selectedNode;
}

function syncDefinition(state, builder) {
  const view = builder.view();
  state.definition = { ...state.definition, nodes: view.nodes, edges: view.edges };
}

function refreshReferenceIssues(state) {
  state.validationIssues = schemaReferenceIssues(state.definition, state.workflowCatalog);
}

function workflowToolIds(definition) {
  if (!Array.isArray(definition.tools)) {
    return [];
  }
  return definition.tools.map((tool) => (typeof tool === "string" ? tool : tool.id)).filter(Boolean);
}

function canvasEdge(edge, index, nodes = []) {
  const route = routeCanvasEdge(edge, nodes);
  return {
    ...edge,
    id: `${index}:${edge.source}->${edge.target}`,
    label: workflowEdgeLabel(edge, nodes),
    path: route.path,
    labelPosition: route.labelPosition,
    sourcePoint: route.sourcePoint,
    endPoint: route.endPoint,
    markerEnd: "url(#workflow-v2-arrowhead)",
    blockedByNodeIds: route.blockedByNodeIds,
  };
}

function edgeIndexFromId(edgeId) {
  const index = Number(String(edgeId).split(":", 1)[0]);
  return Number.isInteger(index) && index >= 0 ? index : -1;
}

function edgeConfigView(workflowView) {
  const nodes = workflowView.nodes ?? [];
  return {
    sources: [
      { id: "START", label: "START", type: "start", handles: [{ id: "", label: "success" }] },
      ...nodes
        .filter((node) => node.type !== "end")
        .map((node) => ({ id: node.id, label: node.config?.name || node.id, type: node.type, handles: nodeHandles(node, workflowView.edges).outputs })),
    ],
    targets: [
      ...nodes.map((node) => ({ id: node.id, label: node.config?.name || node.id, type: node.type })),
      { id: "END", label: "END", type: "end" },
    ],
    edges: workflowView.edges.map((edge, index) => canvasEdge(edge, index, nodes)),
  };
}

const WORKFLOW_V2_NODE_WIDTH = 148;
const WORKFLOW_V2_NODE_HEIGHT = 68;
const WORKFLOW_V2_EDGE_PADDING = 28;

function routeCanvasEdge(edge, nodes) {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const source = nodesById.get(edge.source);
  const target = nodesById.get(edge.target);
  const sourceCenterX = Number(source?.position?.x ?? 0) + WORKFLOW_V2_NODE_WIDTH / 2;
  const targetCenterX = Number(target?.position?.x ?? sourceCenterX + 220) + WORKFLOW_V2_NODE_WIDTH / 2;
  const leftToRight = sourceCenterX <= targetCenterX;
  const start = source
    ? {
        x: Number(source.position?.x ?? 0) + (leftToRight ? WORKFLOW_V2_NODE_WIDTH + 8 : -8),
        y: Number(source.position?.y ?? 0) + WORKFLOW_V2_NODE_HEIGHT / 2,
      }
    : { x: 20, y: Number(target?.position?.y ?? 20) + WORKFLOW_V2_NODE_HEIGHT / 2 };
  const end = target
    ? {
        x: Number(target.position?.x ?? 0) + (leftToRight ? -8 : WORKFLOW_V2_NODE_WIDTH + 8),
        y: Number(target.position?.y ?? 0) + WORKFLOW_V2_NODE_HEIGHT / 2,
      }
    : { x: Number(source?.position?.x ?? 20) + WORKFLOW_V2_NODE_WIDTH + 62, y: Number(source?.position?.y ?? 20) + WORKFLOW_V2_NODE_HEIGHT / 2 };
  const blockers = edgeBlockers(edge, nodes, start, end);

  if (blockers.length === 0) {
    return {
      path: `M ${Math.round(start.x)} ${Math.round(start.y)} L ${Math.round(end.x)} ${Math.round(end.y)}`,
      labelPosition: { x: Math.round((start.x + end.x) / 2), y: Math.round((start.y + end.y) / 2) - 6 },
      sourcePoint: { x: Math.round(start.x), y: Math.round(start.y) },
      endPoint: { x: Math.round(end.x), y: Math.round(end.y) },
      blockedByNodeIds: [],
    };
  }

  const minTop = Math.min(start.y, end.y, ...blockers.map((node) => Number(node.position?.y ?? 0)));
  const below = Math.max(start.y, end.y, ...blockers.map((node) => Number(node.position?.y ?? 0) + WORKFLOW_V2_NODE_HEIGHT)) + WORKFLOW_V2_EDGE_PADDING;
  const routeY = minTop - WORKFLOW_V2_EDGE_PADDING > 12 ? minTop - WORKFLOW_V2_EDGE_PADDING : below;
  const direction = end.x >= start.x ? 1 : -1;
  const turnA = start.x + direction * 32;
  const turnB = end.x - direction * 32;
  return {
    path: `M ${Math.round(start.x)} ${Math.round(start.y)} H ${Math.round(turnA)} V ${Math.round(routeY)} H ${Math.round(turnB)} V ${Math.round(end.y)} H ${Math.round(end.x)}`,
    labelPosition: { x: Math.round((turnA + turnB) / 2), y: Math.round(routeY) - 6 },
    sourcePoint: { x: Math.round(start.x), y: Math.round(start.y) },
    endPoint: { x: Math.round(end.x), y: Math.round(end.y) },
    blockedByNodeIds: blockers.map((node) => node.id),
  };
}

function workflowEdgeLabel(edge, nodes) {
  const handle = String(edge.sourceHandle ?? "");
  const sourceNode = nodes.find((node) => node.id === edge.source);
  if (sourceNode?.type !== "condition") {
    return handle || "success";
  }
  if (handle === "default") {
    return "default";
  }
  const branch = Array.isArray(sourceNode.config?.branches)
    ? sourceNode.config.branches.find((item) => String(item?.handle ?? item?.id ?? "") === handle)
    : null;
  if (!branch) {
    return handle ? `branch: ${handle}` : "branch";
  }
  const path = Array.isArray(branch.source?.path) && branch.source.path.length > 0
    ? branch.source.path.map(String).join(".")
    : "value";
  return `${path} ${operatorLabel(branch.operator)} ${formatBranchValue(branch.value)}`;
}

function operatorLabel(operator) {
  return {
    equals: "==",
    notEquals: "!=",
    greaterThan: ">",
    greaterThanOrEqual: ">=",
    lessThan: "<",
    lessThanOrEqual: "<=",
    contains: "contains",
    startsWith: "starts with",
    endsWith: "ends with",
    exists: "exists",
    notExists: "not exists",
    in: "in",
    notIn: "not in",
    isEmpty: "is empty",
    isNotEmpty: "is not empty",
  }[operator] ?? String(operator ?? "==");
}

function formatBranchValue(value) {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function edgeBlockers(edge, nodes, start, end) {
  const left = Math.min(start.x, end.x);
  const right = Math.max(start.x, end.x);
  return nodes.filter((node) => {
    if (node.id === edge.source || node.id === edge.target) {
      return false;
    }
    const nodeLeft = Number(node.position?.x ?? 0);
    const nodeRight = nodeLeft + WORKFLOW_V2_NODE_WIDTH;
    const nodeTop = Number(node.position?.y ?? 0);
    const nodeBottom = nodeTop + WORKFLOW_V2_NODE_HEIGHT;
    if (nodeRight <= left || nodeLeft >= right) {
      return false;
    }
    const crossesVerticalRange = start.y >= nodeTop && start.y <= nodeBottom || end.y >= nodeTop && end.y <= nodeBottom;
    return crossesVerticalRange;
  });
}

function nodeHandles(node, edges = []) {
  const inputs = [{ id: "in", label: "in" }];
  if (node.type === "end") {
    return { inputs, outputs: [] };
  }
  if (node.type === "condition") {
    const edgeHandles = edges
      .filter((edge) => edge.source === node.id && edge.sourceHandle)
      .map((edge) => ({ id: String(edge.sourceHandle), label: String(edge.sourceHandle) }));
    const branchHandles = Array.isArray(node.config?.branches)
      ? node.config.branches.map((branch) => branch?.handle).filter(Boolean).map((handle) => ({ id: String(handle), label: String(handle) }))
      : [];
    return { inputs, outputs: uniqueHandles([...branchHandles, ...edgeHandles, { id: "default", label: "default" }]) };
  }
  return { inputs, outputs: [{ id: "", label: "success" }] };
}

function uniqueHandles(handles) {
  const seen = new Set();
  return handles.filter((handle) => {
    if (!handle?.id || seen.has(handle.id)) {
      return false;
    }
    seen.add(handle.id);
    return true;
  });
}

function cardNode(node, state) {
  const config = node.config ?? {};
  if (node.type === "condition") {
    return {
      ...node,
      card: {
        title: config.name || node.id,
        subtitle: "Condition",
        summary: {
          sourceField: firstConditionSourceField(config),
          branchCount: Array.isArray(config.branches) ? config.branches.length : 0,
        },
      },
    };
  }
  if (node.type === "workflow") {
    const referenced = state.workflowCatalog.find((workflow) => workflow.id === config.workflowId) ?? null;
    return {
      ...node,
      card: {
        title: config.name || node.id,
        subtitle: "Workflow",
        summary: {
          workflowId: config.workflowId ?? null,
          version: config.version ?? null,
          input: schemaSummary(referenced?.inputSchema),
          output: schemaSummary(referenced?.outputSchema),
        },
      },
    };
  }
  if (node.type !== "agent") {
    return node;
  }
  return {
    ...node,
    card: {
      title: config.name || node.id,
      subtitle: "Agent",
      summary: {
        goal: config.name || "",
        output: outputFieldNames(config.outputSchema),
        tools: toolCount(config.toolPolicy),
      },
    },
  };
}

function visibleInspectorGroups(node, editorMode) {
  if (node.type === "agent") {
    const simple = [
      { id: "goal", label: "Goal" },
      { id: "output", label: "Output" },
      { id: "tools", label: "Tools" },
      { id: "branch", label: "Branch / Next" },
    ];
    if (editorMode !== "advanced") {
      return simple;
    }
    return [
      ...simple,
      { id: "jsonSchema", label: "JSON Schema" },
      { id: "retry", label: "Retry" },
      { id: "timeout", label: "Timeout" },
      { id: "contextSources", label: "Context Sources" },
      { id: "messageContextStrategy", label: "Message Context Strategy" },
      { id: "runtimeDetail", label: "Runtime Detail" },
    ];
  }
  if (node.type === "workflow" && editorMode === "advanced") {
    return [
      { id: "workflow", label: "Workflow" },
      { id: "input", label: "Input Mapping" },
      { id: "messageContextStrategy", label: "Message Context Strategy" },
    ];
  }
  if (node.type === "condition") {
    return [
      { id: "source", label: "Source" },
      { id: "branches", label: "Branches" },
    ];
  }
  return [];
}

function validationLocators(issues) {
  return issues
    .map((issue) => {
      const nodeId = issue.nodeId ?? issue.node_id ?? null;
      if (!nodeId) {
        return null;
      }
      return {
        nodeId,
        field: issue.field ?? null,
        target: { panel: "nodeConfig", nodeId },
      };
    })
    .filter(Boolean);
}

function firstConditionSourceField(config) {
  const branch = Array.isArray(config.branches) ? config.branches[0] : null;
  const source = branch?.source;
  return source?.path?.join(".") ?? null;
}

function schemaSummary(schema) {
  if (!schema || schema.type !== "object") {
    return [];
  }
  return Object.keys(schema.properties ?? {});
}

function agentInspectorGroups() {
  return [
    { id: "basic", label: "Basic" },
    { id: "goal", label: "Goal / Instruction" },
    { id: "context", label: "Context" },
    { id: "output", label: "Output" },
    { id: "tools", label: "Tools" },
    { id: "retry", label: "Retry" },
  ];
}

function conditionInspectorGroups() {
  return [
    { id: "source", label: "Source" },
    { id: "branches", label: "Branches" },
    { id: "default", label: "Default" },
  ];
}

function endInspectorGroups() {
  return [
    { id: "message", label: "Final Message" },
    { id: "artifacts", label: "Artifacts" },
    { id: "data", label: "Structured Data" },
  ];
}

function workflowInspectorGroups() {
  return [
    { id: "workflow", label: "Workflow" },
    { id: "input", label: "Input Mapping" },
    { id: "context", label: "Message Context" },
  ];
}

function inspectorFieldsForNode(node, edges = []) {
  if (node.type === "agent") {
    return [
      { id: "goal", label: "Goal", visible: true, editable: true, ui: "textarea", source: "config.instruction" },
      { id: "output", label: "Output", visible: true, editable: true, ui: "schemaBuilder", source: "config.outputSchema" },
      { id: "tools", label: "Tools", visible: true, editable: true, ui: "multiSelect", source: "config.toolPolicy" },
      { id: "branchNext", label: "Branch / Next", visible: true, editable: false, ui: "edgeSummary", source: `edges[source=${node.id}]` },
    ];
  }
  if (node.type === "condition") {
    return conditionInspectorGroups().map((group) => ({ ...group, visible: true, editable: true, ui: group.id === "branches" ? "branchBuilder" : "select", source: `config.${group.id}` }));
  }
  if (node.type === "workflow") {
    return workflowInspectorGroups().map((group) => ({ ...group, visible: true, editable: true, ui: group.id === "input" ? "bindingList" : "select", source: `config.${group.id}` }));
  }
  if (node.type === "end") {
    return endInspectorGroups().map((group) => ({ ...group, visible: true, editable: true, ui: group.id === "data" ? "bindingSelect" : "select", source: `config.finalResult.${group.id}` }));
  }
  return [];
}

function branchNextView(node, edges = []) {
  return edges
    .filter((edge) => edge.source === node.id)
    .map((edge) => ({ label: edge.sourceHandle || "success", target: edge.target }));
}

function conditionInspectorView(state, nodes, conditionNodeId) {
  const conditionNode = nodes.find((node) => node.id === conditionNodeId);
  const sourceNodes = nodes
    .filter((node) => node.type === "agent" && node.config?.outputSchema?.type === "object")
    .map((node) => ({ id: node.id, label: node.config?.name || node.id }));
  const fields = sourceNodes.flatMap((sourceNode) => outputSchemaFields(nodes.find((node) => node.id === sourceNode.id)?.config?.outputSchema).map((field) => ({ ...field, nodeId: sourceNode.id })));
  const firstField = fields[0] ?? null;
  return {
    nodeId: conditionNodeId,
    branches: Array.isArray(conditionNode?.config?.branches) ? cloneDefinition(conditionNode.config.branches) : [],
    defaultTarget: conditionNode?.config?.defaultTarget ?? conditionNode?.config?.default_target ?? null,
    sourceNodes,
    fields: fields.map((field) => ({ path: field.path, type: field.type, nodeId: field.nodeId, enum: field.enum ?? [] })),
    operatorOptions: operatorOptionsForField(firstField),
    targetNodes: nodes.filter((node) => node.id !== conditionNodeId).map((node) => ({ id: node.id, type: node.type, label: node.config?.name || node.id })),
    selectedWorkflowTools: workflowToolIds(state.definition),
    issues: issuesForNode(state.validationIssues, conditionNodeId),
  };
}

function endInspectorView(nodes, endNodeId) {
  const endNode = nodes.find((node) => node.id === endNodeId);
  const finalResult = endNode?.config?.finalResult ?? {};
  return {
    nodeId: endNodeId,
    defaults: {
      message: "lastVisibleAssistant",
      artifacts: "allVisible",
      data: "none",
    },
    binding: {
      message: finalResult.message ?? { mode: "lastVisibleAssistant" },
      artifacts: finalResult.artifacts ?? { mode: "allVisible" },
      data: finalResult.data ?? null,
    },
    artifactMapping: {
      type: "artifactRef",
      visibleFields: ["id", "name", "mimeType", "createdByNodeId", "visible"],
      hiddenFields: ["uri", "storageKey"],
      defaultMode: "allVisible",
    },
    dataSources: nodes
      .filter((node) => node.type === "agent" && node.config?.outputSchema?.type === "object")
      .flatMap((node) => outputSchemaFields(node.config.outputSchema).map((field) => ({ nodeId: node.id, path: field.path, type: field.type, enum: field.enum ?? [] }))),
  };
}

function workflowInspectorView(state, nodes, workflowNodeId) {
  const workflowNode = nodes.find((node) => node.id === workflowNodeId);
  const config = workflowNode?.config ?? {};
  const workflowOptions = state.workflowCatalog.map((workflow) => ({ id: workflow.id, name: workflow.name ?? workflow.id }));
  const selectedWorkflow = state.workflowCatalog.find((workflow) => workflow.id === config.workflowId) ?? state.workflowCatalog[0] ?? null;
  return {
    nodeId: workflowNodeId,
    workflowId: config.workflowId ?? selectedWorkflow?.id ?? null,
    version: config.version ?? null,
    workflowOptions,
    versionOptions: Array.isArray(selectedWorkflow?.versions) ? selectedWorkflow.versions.map(cloneDefinition) : [],
    messageContextMode: config.messageContextMode ?? "inherit",
    messageContextOptions: [
      { value: "inherit", label: "Inherit" },
      { value: "isolated", label: "Isolated" },
    ],
    inputMappings: outputSchemaFields(selectedWorkflow?.inputSchema ?? null).map((field) => ({
      name: field.path.join("."),
      path: field.path,
      type: field.type,
      required: Array.isArray(selectedWorkflow?.inputSchema?.required) && selectedWorkflow.inputSchema.required.includes(field.path[0]),
      binding: cloneDefinition(config.inputBindings?.[field.path.join(".")] ?? config.inputBindings?.[field.path[0]] ?? null),
      sourceOptions: workflowRefSourceOptions(nodes, workflowNodeId),
    })),
    issues: issuesForNode(state.validationIssues, workflowNodeId),
  };
}

function workflowRefSourceOptions(nodes, workflowNodeId) {
  const nodeOutputOptions = nodes
    .filter((node) => node.id !== workflowNodeId && node.type === "agent" && node.config?.outputSchema?.type === "object")
    .flatMap((node) => outputSchemaFields(node.config.outputSchema).map((field) => ({
      kind: "nodeOutput",
      nodeId: node.id,
      path: field.path,
      type: field.type,
      label: `${node.config?.name || node.id}.${field.path.join(".")}`,
    })));
  return [
    { kind: "workflowInput", label: "User Input", path: ["message"], type: "string" },
    ...nodeOutputOptions,
    { kind: "constant", label: "Constant" },
    { kind: "artifact", label: "Artifact", type: "artifactRef" },
  ];
}

function schemaReferenceIssues(definition, workflowCatalog) {
  const nodes = Array.isArray(definition.nodes) ? definition.nodes : [];
  const issues = [];
  nodes.forEach((node, index) => {
    if (node.type === "condition") {
      issues.push(...conditionReferenceIssues(node, index, nodes));
    }
    if (node.type === "workflow") {
      issues.push(...workflowRefReferenceIssues(node, index, nodes, workflowCatalog, definition));
    }
  });
  return issues;
}

function conditionReferenceIssues(node, nodeIndex, nodes) {
  const branches = Array.isArray(node.config?.branches) ? node.config.branches : [];
  return branches.flatMap((branch, branchIndex) => {
    const source = branch.source ?? {};
    const sourceNode = nodes.find((candidate) => candidate.id === source.nodeId);
    const sourceSchema = sourceNode?.config?.outputSchema ?? null;
    const fieldSchema = schemaAtPath(sourceSchema, source.path);
    if (!fieldSchema) {
      return [referenceIssue("condition_source_field_not_found", `nodes[${nodeIndex}].config.branches[${branchIndex}].source.path`, node.id, "Condition source field is not defined by output schema")];
    }
    if (!conditionOperatorMatchesSchema(branch.operator, fieldSchema)) {
      return [referenceIssue("condition_operator_type_mismatch", `nodes[${nodeIndex}].config.branches[${branchIndex}].operator`, node.id, "Condition operator is not compatible with source field type")];
    }
    return [];
  });
}

function workflowRefReferenceIssues(node, nodeIndex, nodes, workflowCatalog, definition) {
  const selectedWorkflow = workflowCatalog.find((workflow) => workflow.id === node.config?.workflowId);
  const inputSchema = selectedWorkflow?.inputSchema ?? null;
  const bindings = node.config?.inputBindings ?? {};
  const issues = [];
  const required = Array.isArray(inputSchema?.required) ? inputSchema.required : [];
  required.forEach((name) => {
    if (!bindings[name]) {
      issues.push(referenceIssue("workflow_ref_required_input_missing", `nodes[${nodeIndex}].config.inputBindings.${name}`, node.id, "Workflow input is required"));
    }
  });
  Object.entries(bindings).forEach(([name, binding]) => {
    const sourceSchema = valueRefSchema(binding, definition.inputSchema ?? definitionInputSchemaFallback(), nodes);
    const targetSchema = schemaAtPath(inputSchema, [name]);
    if (!sourceSchema) {
      issues.push(referenceIssue("workflow_ref_source_field_not_found", `nodes[${nodeIndex}].config.inputBindings.${name}`, node.id, "Workflow input mapping source field is not defined"));
      return;
    }
    if (targetSchema && !schemaTypesCompatible(sourceSchema, targetSchema)) {
      issues.push(referenceIssue("workflow_ref_input_type_mismatch", `nodes[${nodeIndex}].config.inputBindings.${name}`, node.id, "Workflow input mapping type is incompatible"));
    }
  });
  return issues;
}

function valueRefSchema(valueRef, workflowInputSchema, nodes) {
  if (!valueRef || typeof valueRef !== "object") {
    return null;
  }
  if (valueRef.kind === "constant") {
    return schemaForValue(valueRef.value);
  }
  if (valueRef.kind === "workflowInput") {
    return schemaAtPath(workflowInputSchema, valueRef.path);
  }
  if (valueRef.kind === "nodeOutput") {
    const sourceNode = nodes.find((node) => node.id === valueRef.nodeId);
    return schemaAtPath(sourceNode?.config?.outputSchema ?? null, valueRef.path);
  }
  if (valueRef.kind === "artifact") {
    return { type: "object", format: "artifactRef" };
  }
  return null;
}

function definitionInputSchemaFallback() {
  return { type: "object", properties: { message: { type: "string" } } };
}

function schemaAtPath(schema, path) {
  if (!Array.isArray(path) || path.length === 0) {
    return null;
  }
  let current = schema;
  for (const segment of path) {
    if (!current || current.type !== "object" || !current.properties || !current.properties[segment]) {
      return null;
    }
    current = current.properties[segment];
  }
  return current;
}

function conditionOperatorMatchesSchema(operator, schema) {
  const normalized = normalizeOperator(operator ?? "equals");
  const type = schemaType(schema);
  if (["greater_than", "greater_than_or_equal", "less_than", "less_than_or_equal"].includes(normalized)) {
    return type === "number" || type === "integer";
  }
  if (["starts_with", "ends_with"].includes(normalized)) {
    return type === "string";
  }
  if (normalized === "contains") {
    return type === "string" || type === "array";
  }
  return true;
}

function schemaTypesCompatible(sourceSchema, targetSchema) {
  const source = schemaType(sourceSchema);
  const target = schemaType(targetSchema);
  return source === target || (source === "integer" && target === "number");
}

function schemaType(schema) {
  if (Array.isArray(schema?.enum)) {
    return "string";
  }
  return schema?.type ?? "";
}

function schemaForValue(value) {
  if (typeof value === "boolean") {
    return { type: "boolean" };
  }
  if (typeof value === "number") {
    return { type: Number.isInteger(value) ? "integer" : "number" };
  }
  if (typeof value === "string") {
    return { type: "string" };
  }
  if (Array.isArray(value)) {
    return { type: "array" };
  }
  if (value && typeof value === "object") {
    return { type: "object" };
  }
  return null;
}

function normalizeOperator(operator) {
  return String(operator)
    .replace(/-/g, "_")
    .replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
    .replace(/^_/, "")
    .toLowerCase();
}

function referenceIssue(code, field, nodeId, message) {
  return { code, field, message, node_id: nodeId };
}

function issuesForNode(issues, nodeId) {
  return issues.filter((issue) => issue.node_id === nodeId).map(cloneIssue);
}

function outputSchemaFields(schema, prefix = []) {
  if (!schema?.properties) {
    return [];
  }
  return Object.entries(schema.properties).flatMap(([name, child]) => {
    const path = [...prefix, name];
    if (child?.type === "object") {
      return outputSchemaFields(child, path);
    }
    return [{ path, type: child?.type ?? "unknown", enum: Array.isArray(child?.enum) ? child.enum : [] }];
  });
}

function operatorOptionsForField(field) {
  const common = ["equals", "notEquals", "exists", "notExists", "in", "notIn", "isEmpty", "isNotEmpty"];
  if (field?.type === "number" || field?.type === "integer") {
    return [...common, "greaterThan", "greaterThanOrEqual", "lessThan", "lessThanOrEqual"].map(operatorOption);
  }
  if (field?.type === "string") {
    return [...common, "contains", "startsWith", "endsWith"].map(operatorOption);
  }
  return common.map(operatorOption);
}

function operatorOption(value) {
  return { value, label: value };
}

function nodeExecutionDetails(run, workflowNodes = []) {
  const resultByNodeId = new Map(run.nodeResults.map((result) => [result.nodeId, result]));
  const executionByNodeId = new Map((run.executionDetails.nodes ?? []).map((node) => [node.nodeId, node]));
  const nodeIds = [];
  for (const node of run.executionDetails.nodes ?? []) {
    if (node?.nodeId && !nodeIds.includes(node.nodeId)) nodeIds.push(node.nodeId);
  }
  for (const result of run.nodeResults ?? []) {
    if (result?.nodeId && !nodeIds.includes(result.nodeId)) nodeIds.push(result.nodeId);
  }
  if (run.status === "running") {
    for (const node of workflowNodes) {
      if (node?.id && node.type !== "end" && !nodeIds.includes(node.id)) nodeIds.push(node.id);
    }
  }
  return nodeIds.map((nodeId, index) => {
    const node = executionByNodeId.get(nodeId) ?? {};
    const result = resultByNodeId.get(nodeId) ?? {};
    const events = run.timeline.filter((event) => event.nodeId === nodeId);
    const started = events.find((event) => event.eventType === "NodeStarted");
    const finished = [...events].reverse().find((event) => ["NodeCompleted", "NodeFailed"].includes(event.eventType));
    const durationMs = node.durationMs ?? durationBetween(started?.timestamp, finished?.timestamp);
    const output = Object.prototype.hasOwnProperty.call(result, "data") ? result.data : node.output ?? null;
    const error = result.error ?? node.error ?? (finished?.eventType === "NodeFailed" ? finished.payload?.error ?? null : null);
    return {
      nodeId,
      order: index + 1,
      status: result.status ?? run.nodeStatuses.get(nodeId) ?? (run.status === "running" && started ? "running" : "pending"),
      input: result.input ?? node.input ?? null,
      output,
      error: error ? cloneDefinition(error) : null,
      durationMs: durationMs === null || durationMs === undefined ? null : (Number.isFinite(Number(durationMs)) ? Number(durationMs) : null),
      artifacts: artifactsView(result.artifacts),
      steps: Array.isArray(node.steps) ? node.steps.map(cloneDefinition) : [],
    };
  });
}

function durationBetween(startedAt, finishedAt) {
  if (!startedAt || !finishedAt) return null;
  const duration = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  return Number.isFinite(duration) && duration >= 0 ? duration : null;
}

function messageView(message) {
  const view = cloneDefinition(message);
  if (Array.isArray(view.artifacts)) {
    view.artifacts = artifactsView(view.artifacts);
  }
  return view;
}

function executionDetailsView(executionDetails) {
  const view = cloneDefinition(executionDetails);
  view.nodes = Array.isArray(view.nodes) ? view.nodes.map((node) => ({
    ...node,
    steps: Array.isArray(node.steps) ? node.steps.map(stepView) : [],
  })) : [];
  return view;
}

function stepView(step) {
  const view = cloneDefinition(step);
  if (Array.isArray(view.artifacts)) {
    view.artifacts = artifactsView(view.artifacts);
  }
  return view;
}

function artifactsView(artifacts) {
  return Array.isArray(artifacts) ? artifacts.map(artifactRef) : [];
}

function artifactRef(artifact) {
  return {
    id: artifact.id,
    name: artifact.name,
    mimeType: artifact.mimeType,
    createdByNodeId: artifact.createdByNodeId,
    visible: artifact.visible,
    downloadAction: { type: "workflowArtifactDownload", artifactId: artifact.id },
  };
}

function outputFieldNames(outputSchema) {
  if (!outputSchema?.properties) {
    return [];
  }
  return Object.keys(outputSchema.properties);
}

function toolCount(toolPolicy) {
  if (Array.isArray(toolPolicy?.tools)) {
    return toolPolicy.tools.length;
  }
  if (Array.isArray(toolPolicy?.toolIds)) {
    return toolPolicy.toolIds.length;
  }
  if (Array.isArray(toolPolicy?.allowedTools)) {
    return toolPolicy.allowedTools.length;
  }
  return 0;
}

function cloneIssue(issue) {
  return { ...issue };
}

function cloneDefinition(definition) {
  return JSON.parse(JSON.stringify(definition));
}
