export function createTemplateEditor(apiClient, initialManifest) {
  const state = {
    manifest: cloneManifest(initialManifest),
    compile: null,
  };

  return {
    view() {
      return {
        manifest: cloneManifest(state.manifest),
        compile: state.compile,
      };
    },
    setRestoreMode(mode) {
      state.manifest.context.restore.mode = mode;
      return this.view();
    },
    async save() {
      const response = await apiClient.saveTemplate(cloneManifest(state.manifest));
      state.manifest = cloneManifest(response.manifest ?? state.manifest);
      return { status: "saved", manifest: cloneManifest(state.manifest) };
    },
    async compile() {
      const response = await apiClient.compileTemplate(cloneManifest(state.manifest));
      if (response.status === 200 || response.compiled) {
        state.compile = { status: "compiled" };
      } else {
        state.compile = {
          status: "error",
          fieldPath: response.error?.field_path ?? response.error?.fieldPath ?? "",
          code: response.error?.code,
        };
      }
      return this.view();
    },
    async runTest(input) {
      if (state.compile?.status !== "compiled") {
        return { status: "blocked", reason: "compile_required" };
      }
      const response = await apiClient.runTemplate(state.manifest.template.id, {
        graph_state: { input: input.input },
      });
      return { status: "started", graphState: response.graph_state };
    },
  };
}

function cloneManifest(manifest) {
  return JSON.parse(JSON.stringify(manifest));
}
