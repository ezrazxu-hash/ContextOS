import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\tests$/, "");

function moduleUrl(relativePath) {
  return pathToFileURL(join(studioRoot, relativePath)).href;
}

test("T72 frontend registry covers backend node catalog types", async () => {
  const { createWorkflowNodeRegistry } = await import(moduleUrl("src/workflow/nodes/registry.js"));
  const registry = createWorkflowNodeRegistry();
  const backendCatalogTypes = ["prompt", "llm", "tool", "condition", "output"];

  assert.deepEqual(registry.nodeTypes(), ["START", "END", ...backendCatalogTypes]);
  for (const type of backendCatalogTypes) {
    const definition = registry.get(type);
    assert.equal(typeof definition.renderNode, "function");
    assert.equal(typeof definition.renderConfig, "function");
  }
});

test("T72 missing renderer fails explicitly instead of showing generic box", async () => {
  const { createWorkflowNodeRegistry } = await import(moduleUrl("src/workflow/nodes/registry.js"));
  const registry = createWorkflowNodeRegistry();

  assert.throws(() => registry.get("unknown"), /Workflow node renderer is not registered: unknown/);
});

test("T72 config renderer exposes concrete fields for supported nodes", async () => {
  const { createWorkflowNodeRegistry } = await import(moduleUrl("src/workflow/nodes/registry.js"));
  const registry = createWorkflowNodeRegistry();

  assert.deepEqual(registry.get("prompt").renderConfig().fields.map((field) => field.path), ["role", "template", "variables", "input_mapping"]);
  assert.deepEqual(registry.get("llm").renderConfig().fields.map((field) => field.path), ["provider", "model", "max_tokens", "system_prompt", "prompt", "temperature", "input_mapping"]);
  assert.deepEqual(registry.get("tool").renderConfig().fields.map((field) => field.path), ["tool_name", "args"]);
  assert.deepEqual(registry.get("condition").renderConfig().fields.map((field) => field.path), ["source", "operator", "value"]);
});
