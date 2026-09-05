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
      return { node: view.nodes.find((node) => node.id === selectedNode.id) ?? null, conditionInspector: conditionInspectorView(state, view.nodes, selectedNode.id) };
    },
    updateSelectedEndConfig(patch) {
      const selectedNode = selectedEndNode(state, builder);
      const view = builder.updateEndNodeConfig(selectedNode.id, patch);
      syncDefinition(state, builder);
      return { node: view.nodes.find((node) => node.id === selectedNode.id) ?? null, endInspector: endInspectorView(view.nodes, selectedNode.id) };
    },
    addOutputSchemaField(field) {
      const selectedNode = selectedAgentNode(state, builder);
      const schemaBuilder = createWorkflowV2SchemaBuilder(selectedNode.config?.outputSchema ?? null);
      schemaBuilder.addField(field);
      const view = builder.updateAgentNodeConfig(selectedNode.id, { outputSchema: schemaBuilder.toJsonSchema() });
      syncDefinition(state, builder);
      return {
        node: view.nodes.find((node) => node.id === selectedNode.id) ?? null,
        schemaBuilder: schemaBuilder.view(),
      };
    },
    connectCanvasEdge(source, target, options = {}) {
      const view = builder.connect(source, target, options);
      syncDefinition(state, builder);
      return { accepted: true, edge: canvasEdge(view.edges[view.edges.length - 1], view.edges.length - 1) };
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
    validate() {
      const validation = builder.validate();
      state.validationIssues = validation.errors.map(cloneIssue);
      return validation;
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
      state.lastRun = { status: "running", runId: null, workflowVersion: payload.version, output: null, error: null, nodeResults: [], messages: [], executionDetails: { nodes: [] } };
      const run = await apiClient.startWorkflowRun(state.definition.id, cloneDefinition(payload));
      state.lastRun = normalizeRun(run);
      return cloneDefinition(run);
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
        nodeLibrary: {
          items: builder.nodeLibrary(),
        },
        canvas: {
          role: "workflow-v2-canvas",
          nodes: workflowView.nodes.map((node) => ({ ...cardNode(node), runStatus: nodeRunStatusById.get(node.id) ?? "pending" })),
          edges: workflowView.edges.map(canvasEdge),
        },
        nodeConfig: {
          selectedNodeId: state.selectedNodeId,
          groups: selectedNode?.type === "agent" ? agentInspectorGroups() : selectedNode?.type === "condition" ? conditionInspectorGroups() : selectedNode?.type === "end" ? endInspectorGroups() : [],
          value: selectedNode?.type === "agent" ? cloneDefinition(selectedNode.config ?? {}) : null,
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
        },
        validationPanel: {
          issues: state.validationIssues.map(cloneIssue),
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
        runPanel: state.lastRun ? runPanel(state.lastRun) : null,
        draft: {
          revision: state.definition.revision,
        },
      };
    },
  };
}

function normalizeRun(run) {
  return {
    status: run.status,
    runId: run.id ?? run.runId ?? null,
    workflowVersion: run.workflowVersion,
    output: run.output ?? null,
    error: run.error ?? null,
    nodeResults: Array.isArray(run.nodeResults) ? run.nodeResults.map(cloneDefinition) : [],
    messages: Array.isArray(run.messages) ? run.messages.map(cloneDefinition) : [],
    executionDetails: run.executionDetails ? cloneDefinition(run.executionDetails) : { nodes: [] },
  };
}

function nodeRunStatuses(run) {
  const statuses = new Map();
  if (!run?.nodeResults) {
    return statuses;
  }
  run.nodeResults.forEach((result) => {
    statuses.set(result.nodeId, result.status);
  });
  return statuses;
}

function runPanel(run) {
  return {
    status: run.status,
    runId: run.runId,
    workflowVersion: run.workflowVersion,
    output: run.output,
    error: run.error,
    messages: run.messages.map(cloneDefinition),
    executionDetails: cloneDefinition(run.executionDetails),
  };
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

function syncDefinition(state, builder) {
  const view = builder.view();
  state.definition = { ...state.definition, nodes: view.nodes, edges: view.edges };
}

function workflowToolIds(definition) {
  if (!Array.isArray(definition.tools)) {
    return [];
  }
  return definition.tools.map((tool) => (typeof tool === "string" ? tool : tool.id)).filter(Boolean);
}

function canvasEdge(edge, index) {
  return { ...edge, id: `${index}:${edge.source}->${edge.target}` };
}

function cardNode(node) {
  if (node.type !== "agent") {
    return node;
  }
  const config = node.config ?? {};
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
    dataSources: nodes
      .filter((node) => node.type === "agent" && node.config?.outputSchema?.type === "object")
      .flatMap((node) => outputSchemaFields(node.config.outputSchema).map((field) => ({ nodeId: node.id, path: field.path, type: field.type, enum: field.enum ?? [] }))),
  };
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
