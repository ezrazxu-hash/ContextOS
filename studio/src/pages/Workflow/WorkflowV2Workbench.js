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
      state.lastRun = { status: "running", runId: null, workflowVersion: payload.version, output: null, error: null, finalResult: null, artifacts: [], nodeResults: [], messages: [], executionDetails: { nodes: [] } };
      const run = await apiClient.startWorkflowRun(state.definition.id, cloneDefinition(payload));
      state.lastRun = normalizeRun(run);
      return cloneDefinition(run);
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
          groups: selectedNode?.type === "agent" ? agentInspectorGroups() : selectedNode?.type === "condition" ? conditionInspectorGroups() : selectedNode?.type === "end" ? endInspectorGroups() : selectedNode?.type === "workflow" ? workflowInspectorGroups() : [],
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
    finalResult: run.finalResult ? cloneDefinition(run.finalResult) : null,
    artifacts: Array.isArray(run.artifacts) ? run.artifacts.map(artifactRef) : [],
    nodeResults: Array.isArray(run.nodeResults) ? run.nodeResults.map(cloneDefinition) : [],
    messages: Array.isArray(run.messages) ? run.messages.map(messageView) : [],
    executionDetails: run.executionDetails ? executionDetailsView(run.executionDetails) : { nodes: [] },
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
  const panel = {
    status: run.status,
    runId: run.runId,
    workflowVersion: run.workflowVersion,
    output: run.output,
    error: run.error,
    messages: run.messages.map(cloneDefinition),
    executionDetails: cloneDefinition(run.executionDetails),
  };
  if (run.finalResult) {
    panel.finalResult = {
      ...cloneDefinition(run.finalResult),
      artifacts: artifactsView(run.finalResult.artifacts),
    };
  }
  if (run.artifacts.length > 0) {
    panel.artifacts = artifactsView(run.artifacts);
  }
  const details = nodeExecutionDetails(run);
  if (details.some((node) => node.artifacts.length > 0)) {
    panel.nodeExecutionDetails = details;
  }
  return panel;
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

function workflowInspectorGroups() {
  return [
    { id: "workflow", label: "Workflow" },
    { id: "input", label: "Input Mapping" },
    { id: "context", label: "Message Context" },
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

function nodeExecutionDetails(run) {
  const resultByNodeId = new Map(run.nodeResults.map((result) => [result.nodeId, result]));
  return (run.executionDetails.nodes ?? []).map((node) => {
    const result = resultByNodeId.get(node.nodeId) ?? {};
    return {
      nodeId: node.nodeId,
      status: result.status ?? null,
      artifacts: artifactsView(result.artifacts),
      steps: Array.isArray(node.steps) ? node.steps.map(cloneDefinition) : [],
    };
  });
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
