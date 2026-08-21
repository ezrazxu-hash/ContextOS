export const TemplatePage = {
  kind: "studio-page",
  name: "Template",
};

export async function createTemplatePage(apiClient, manifest) {
  const { createTemplateEditor } = await import("../../features/template-editor/TemplateEditor.js");
  return createTemplateEditor(apiClient, manifest);
}
