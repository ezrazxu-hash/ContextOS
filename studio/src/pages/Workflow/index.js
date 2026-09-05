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
  return createWorkflowWorkbench({ ...options, apiClient });
}

export function workflowEditorKindForDefinition(definition = null) {
  return Number(definition?.schemaVersion ?? definition?.schema_version ?? 1) === 2 ? "agent-workflow-v2" : "legacy";
}
