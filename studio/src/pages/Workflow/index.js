export const WorkflowPage = {
  kind: "studio-page",
  name: "Workflow",
};

export async function createWorkflowPage(apiClient) {
  const { createWorkflowBuilder } = await import("../../features/workflow-builder/WorkflowBuilder.js");
  return createWorkflowBuilder(apiClient);
}
