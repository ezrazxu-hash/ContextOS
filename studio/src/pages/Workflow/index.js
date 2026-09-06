export const WorkflowPage = {
  kind: "studio-page",
  name: "Workflow",
};

export async function createWorkflowPage(apiClient, options = {}) {
  if (workflowEditorKindForDefinition(options.workflowDefinition) === "agent-workflow-v2") {
    const { createWorkflowV2Workbench } = await import("./WorkflowV2Workbench.js");
    return createWorkflowV2Workbench({ ...options, apiClient });
  }
  const { createWorkflowWorkbench } = await import("./WorkflowWorkbench.js");
  const legacyWorkbench = createWorkflowWorkbench({ ...options, apiClient });
  const legacyDefinition = options.workflowDefinition ?? options.initialManifest ?? {};

  return {
    ...legacyWorkbench,
    async createV2Copy() {
      const definition = createV2CopyFromLegacyDefinition(legacyDefinition);
      return apiClient.createWorkflow(definition);
    },
    view() {
      return {
        ...legacyWorkbench.view(),
        legacy: {
          status: "legacy",
          actions: [
            {
              id: "create-v2-copy",
              label: "Create V2 Copy",
              strategy: "manual-rebuild",
            },
          ],
        },
      };
    },
  };
}

export function workflowEditorKindForDefinition(definition = null) {
  return Number(definition?.schemaVersion ?? definition?.schema_version ?? 1) === 2 ? "agent-workflow-v2" : "legacy";
}

export function createNewWorkflowDefinition({ id = "new-agent-workflow", name = "New Agent Workflow" } = {}) {
  return {
    id,
    name,
    schemaVersion: 2,
    nodes: [],
    edges: [],
    tools: [],
    runtimeLimits: {},
  };
}

export function createStarterWorkflowV2Definition({ id = "new-agent-workflow", name = "New Agent Workflow" } = {}) {
  return {
    id,
    name,
    schemaVersion: 2,
    revision: 1,
    tools: [],
    nodes: [
      {
        id: "agent-1",
        type: "agent",
        position: { x: 80, y: 120 },
        config: {
          instruction: "Answer the user's request clearly using the provided workflow input.",
          visibility: "visible",
          toolPolicy: { mode: "disabled" },
          outputSchema: {
            type: "object",
            required: ["summary"],
            properties: { summary: { type: "string" } },
          },
        },
      },
      { id: "end-1", type: "end", position: { x: 280, y: 120 } },
    ],
    edges: [
      { source: "START", target: "agent-1" },
      { source: "agent-1", target: "end-1" },
    ],
    runtimeLimits: {},
  };
}

export function createV2CopyFromLegacyDefinition(definition = {}) {
  const sourceId = definition.template?.id ?? definition.id ?? "legacy-workflow";
  const sourceName = definition.template?.name ?? definition.name ?? sourceId;
  const legacyNodeTypes = legacyNodeTypesForDefinition(definition);

  return {
    id: `${sourceId}-v2-copy`,
    name: `${sourceName} (V2 Copy)`,
    description: `Manual Agent Workflow V2 rebuild shell copied from legacy workflow ${sourceId}.`,
    schemaVersion: 2,
    nodes: [],
    edges: [],
    tools: [],
    runtimeLimits: {},
    migration: {
      sourceWorkflowId: sourceId,
      sourceSchemaVersion: String(
        definition.schemaVersion ?? definition.schema_version ?? definition.workflow_schema_version ?? "1",
      ),
      strategy: "manual-rebuild",
      legacyNodeTypes,
    },
  };
}

function legacyNodeTypesForDefinition(definition) {
  const nodes = Array.isArray(definition.nodes)
    ? definition.nodes
    : Array.isArray(definition.runtime?.nodes)
      ? definition.runtime.nodes
      : [];
  return [...new Set(nodes.map((node) => node.type).filter(Boolean))].sort();
}
