import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\tests$/, "");

function moduleUrl(relativePath) {
  return pathToFileURL(join(studioRoot, relativePath)).href;
}

function manifest() {
  return {
    template: { id: "research-agent", name: "Research Agent", version: "1.0.0" },
    graph: {
      state_schema: "default_chat_state",
      nodes: [{ id: "writer", type: "output", config: { output_key: "answer", output: "ok" } }],
      edges: [{ from: "START", to: "writer" }, { from: "writer", to: "END" }],
    },
    context: {
      policy: "balanced",
      budget: { high_watermark: 0.8, target_watermark: 0.65 },
      restore: { mode: "auto", max_tokens_per_restore: 12000, max_restore_per_turn: 3 },
    },
    checkpoint: { enabled: true },
    ui: { editable_messages: true, expose_context_panel: true },
  };
}

test("restore mode edit saves the same manifest shape", async () => {
  const { createTemplateEditor } = await import(moduleUrl("src/features/template-editor/TemplateEditor.js"));

  const saved = [];
  const editor = createTemplateEditor({
    async saveTemplate(payload) {
      saved.push(payload);
      return { id: payload.template.id, manifest: payload };
    },
  }, manifest());

  editor.setRestoreMode("manual");
  const result = await editor.save();

  assert.equal(result.status, "saved");
  assert.equal(saved[0].context.restore.mode, "manual");
  assert.deepEqual(Object.keys(saved[0]).sort(), ["checkpoint", "context", "graph", "template", "ui"]);
});

test("compile field errors are visible with field path", async () => {
  const { createTemplateEditor } = await import(moduleUrl("src/features/template-editor/TemplateEditor.js"));

  const editor = createTemplateEditor({
    async compileTemplate() {
      return { status: 400, error: { field_path: "graph.nodes[0].extension", code: "unknown_extension" } };
    },
  }, manifest());

  const view = await editor.compile();

  assert.equal(view.compile.status, "error");
  assert.equal(view.compile.fieldPath, "graph.nodes[0].extension");
});

test("successful compile enables test run", async () => {
  const { createTemplateEditor } = await import(moduleUrl("src/features/template-editor/TemplateEditor.js"));

  const calls = [];
  const editor = createTemplateEditor({
    async compileTemplate() {
      return { status: 200, compiled: true };
    },
    async runTemplate(templateId, payload) {
      calls.push([templateId, payload]);
      return { graph_state: { answer: "ok" } };
    },
  }, manifest());

  await editor.compile();
  const run = await editor.runTest({ input: "hello" });

  assert.deepEqual(calls, [["research-agent", { graph_state: { input: "hello" } }]]);
  assert.equal(run.graphState.answer, "ok");
});
