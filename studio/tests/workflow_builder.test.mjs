import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\tests$/, "");

function moduleUrl(relativePath) {
  return pathToFileURL(join(studioRoot, relativePath)).href;
}

test("Prompt LLM Tool Output graph serializes to runtime/ui Manifest", async () => {
  const { createWorkflowBuilder } = await import(moduleUrl("src/features/workflow-builder/WorkflowBuilder.js"));

  const builder = createWorkflowBuilder();
  builder.addNode({ id: "prompt", type: "prompt", config: { template: "Question: {{input}}", output_key: "prompt_text" } });
  builder.addNode({ id: "llm", type: "llm", config: { model: "default", prompt: "{{prompt}}", output_key: "answer" } });
  builder.addNode({ id: "tool", type: "tool", config: { tool_name: "web_search", output_key: "tool_result" } });
  builder.addNode({ id: "output", type: "output", config: { source: "$state.tool_result" } });
  builder.connect("START", "prompt");
  builder.connect("prompt", "llm");
  builder.connect("llm", "tool");
  builder.connect("tool", "output");
  builder.connect("output", "END");

  const manifest = builder.serializeManifest({ id: "research-agent", name: "Research Agent", version: "1.0.0" });

  assert.deepEqual(builder.nodeLibrary().map((node) => node.type), [
    "prompt",
    "llm",
    "tool",
    "condition",
    "output",
  ]);
  assert.equal(manifest.schema_version, "1.0");
  assert.deepEqual(manifest.runtime.edges, [
    { source: "START", target: "prompt" },
    { source: "prompt", target: "llm" },
    { source: "llm", target: "tool" },
    { source: "tool", target: "output" },
    { source: "output", target: "END" },
  ]);
  assert.equal(manifest.runtime.nodes[2].config.tool_name, "web_search");
  assert.equal(manifest.runtime.nodes[0].position, undefined);
});

test("invalid graph is rejected locally and backend validator remains authoritative", async () => {
  const { createWorkflowBuilder } = await import(moduleUrl("src/features/workflow-builder/WorkflowBuilder.js"));

  const calls = [];
  const builder = createWorkflowBuilder({
    async validateTemplate(manifest) {
      calls.push(manifest.template.id);
      return { valid: false, error: { field_path: "graph.edges[0].to", code: "unknown_node" } };
    },
  });
  builder.addNode({ id: "llm", type: "llm", config: {} });
  builder.connect("llm", "missing");

  const local = builder.validate();
  const saved = await builder.save({ id: "broken", name: "Broken", version: "1.0.0" });

  assert.equal(local.valid, false);
  assert.equal(local.issues[0].fieldPath, "graph.edges[0].to");
  assert.equal(saved.status, "rejected");
  assert.equal(saved.authority, "backend");
  assert.deepEqual(calls, ["broken"]);
});

test("saved workflow reopens with the same manifest", async () => {
  const { createWorkflowBuilder } = await import(moduleUrl("src/features/workflow-builder/WorkflowBuilder.js"));

  let storedManifest = null;
  const apiClient = {
    async validateTemplate() {
      return { valid: true, issues: [] };
    },
    async saveTemplate(manifest) {
      storedManifest = manifest;
      return { id: manifest.template.id, manifest };
    },
    async fetchTemplate(templateId) {
      assert.equal(templateId, "research-agent");
      return { id: templateId, manifest: storedManifest };
    },
  };
  const builder = createWorkflowBuilder(apiClient);
  builder.addNode({ id: "prompt", type: "prompt", config: { template: "{{input}}", output_key: "prompt_text" } });
  builder.connect("START", "prompt");
  builder.connect("prompt", "END");

  await builder.save({ id: "research-agent", name: "Research Agent", version: "1.0.0" });
  const reopened = await createWorkflowBuilder(apiClient).open("research-agent");

  assert.deepEqual(reopened.serializeManifest(), storedManifest);
});

test("UI08-T01: workflow canvas exposes keyboard select and delete alternatives", async () => {
  const { createWorkflowBuilder } = await import(moduleUrl("src/features/workflow-builder/WorkflowBuilder.js"));
  const builder = createWorkflowBuilder();
  builder.addNode({ id: "prompt", type: "prompt", config: { template: "{{input}}" } });
  builder.addNode({ id: "tool", type: "tool", config: { tool_id: "web_search" } });
  builder.connect("prompt", "tool");

  const selected = builder.handleCanvasKey({ key: "Enter", nodeId: "prompt" });
  const deleted = builder.handleCanvasKey({ key: "Delete" });

  assert.equal(selected.canvas.ariaLabel, "Workflow canvas");
  assert.equal(selected.canvas.keyboardShortcuts.select, "Enter");
  assert.equal(selected.selectedNodeId, "prompt");
  assert.deepEqual(deleted.nodes.map((node) => node.id), ["tool"]);
  assert.deepEqual(deleted.edges, []);
});

test("START and END cannot be added or deleted as regular nodes", async () => {
  const { createWorkflowBuilder } = await import(moduleUrl("src/features/workflow-builder/WorkflowBuilder.js"));
  const builder = createWorkflowBuilder();

  assert.throws(() => builder.addNode({ id: "START", type: "start" }), /system boundary/i);
  assert.throws(() => builder.addNode({ id: "END", type: "end" }), /system boundary/i);

  const view = builder.handleCanvasKey({ key: "Enter", nodeId: "START" });
  const deleted = builder.handleCanvasKey({ key: "Delete" });

  assert.equal(view.selectedNodeId, null);
  assert.deepEqual(deleted.nodes, []);
});
