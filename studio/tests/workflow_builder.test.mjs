import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\tests$/, "");

function moduleUrl(relativePath) {
  return pathToFileURL(join(studioRoot, relativePath)).href;
}

test("Agent Tool Output graph serializes to V1 Manifest", async () => {
  const { createWorkflowBuilder } = await import(moduleUrl("src/features/workflow-builder/WorkflowBuilder.js"));

  const builder = createWorkflowBuilder();
  builder.addNode({ id: "agent", type: "agent", config: { model: "default" } });
  builder.addNode({ id: "tool", type: "tool", config: { tool_id: "web_search" } });
  builder.addNode({ id: "output", type: "output", config: { output_key: "answer" } });
  builder.connect("START", "agent");
  builder.connect("agent", "tool");
  builder.connect("tool", "output");
  builder.connect("output", "END");

  const manifest = builder.serializeManifest({ id: "research-agent", name: "Research Agent", version: "1.0.0" });

  assert.deepEqual(builder.nodeLibrary().map((node) => node.type), [
    "agent",
    "llm",
    "prompt",
    "tool",
    "condition",
    "router",
    "subgraph",
    "human_approval",
    "context_operator",
    "memory",
    "output",
    "custom",
  ]);
  assert.deepEqual(manifest.graph.edges, [
    { from: "START", to: "agent" },
    { from: "agent", to: "tool" },
    { from: "tool", to: "output" },
    { from: "output", to: "END" },
  ]);
  assert.equal(manifest.graph.nodes[1].config.tool_id, "web_search");
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
  builder.addNode({ id: "agent", type: "agent", config: {} });
  builder.connect("agent", "missing");

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
  builder.addNode({ id: "agent", type: "agent", config: { model: "default" } });
  builder.connect("START", "agent");
  builder.connect("agent", "END");

  await builder.save({ id: "research-agent", name: "Research Agent", version: "1.0.0" });
  const reopened = await createWorkflowBuilder(apiClient).open("research-agent");

  assert.deepEqual(reopened.serializeManifest(), storedManifest);
});

test("UI08-T01: workflow canvas exposes keyboard select and delete alternatives", async () => {
  const { createWorkflowBuilder } = await import(moduleUrl("src/features/workflow-builder/WorkflowBuilder.js"));
  const builder = createWorkflowBuilder();
  builder.addNode({ id: "agent", type: "agent", config: { model: "default" } });
  builder.addNode({ id: "tool", type: "tool", config: { tool_id: "web_search" } });
  builder.connect("agent", "tool");

  const selected = builder.handleCanvasKey({ key: "Enter", nodeId: "agent" });
  const deleted = builder.handleCanvasKey({ key: "Delete" });

  assert.equal(selected.canvas.ariaLabel, "Workflow canvas");
  assert.equal(selected.canvas.keyboardShortcuts.select, "Enter");
  assert.equal(selected.selectedNodeId, "agent");
  assert.deepEqual(deleted.nodes.map((node) => node.id), ["tool"]);
  assert.deepEqual(deleted.edges, []);
});
