export const WorkflowPage = {
  kind: "studio-page",
  name: "Workflow",
};

export async function createWorkflowPage(apiClient, options = {}) {
  const { createWorkflowWorkbench } = await import("./WorkflowWorkbench.js");
  return createWorkflowWorkbench({ ...options, apiClient });
}
