export const TemplatePage = {
  kind: "studio-page",
  name: "Template",
};

export async function createTemplatePage(apiClient, manifest) {
  const { createTemplateWorkbench } = await import("./TemplateWorkbench.js");
  const template = manifest?.template;
  const workbench = createTemplateWorkbench({
    apiClient,
    templates: template ? [template] : [],
    initialTemplateId: template?.id ?? null,
  });
  if (template) {
    await workbench.loadSelectedTemplate();
  }
  return workbench;
}
