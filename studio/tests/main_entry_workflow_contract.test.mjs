import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\tests$/, "");

test("main Workflow page exposes only V1 executable node library entries", () => {
  const source = readFileSync(join(studioRoot, "src/main.js"), "utf-8");

  assert.match(source, /"prompt"/);
  assert.match(source, /"llm"/);
  assert.match(source, /"tool"/);
  assert.match(source, /"condition"/);
  assert.match(source, /"output"/);
  assert.doesNotMatch(source, /"router"/);
  assert.doesNotMatch(source, /"agent", "tool"/);
  assert.doesNotMatch(source, /"context_operator"/);
});

test("main Workflow save path serializes runtime and ui sections separately", () => {
  const source = readFileSync(join(studioRoot, "src/main.js"), "utf-8");
  const serializer = source.slice(source.indexOf("function serializeWorkflowManifest()"), source.indexOf("function loadWorkflowManifest("));

  assert.match(serializer, /serializeGraph/);
  assert.doesNotMatch(serializer, /state_schema/);
});

test("main Workflow page exposes real edge creation and graph preview actions", () => {
  const source = readFileSync(join(studioRoot, "src/main.js"), "utf-8");

  assert.match(source, /data-action="select-edge-source"/);
  assert.match(source, /data-action="connect-workflow-edge"/);
  assert.match(source, /data-action="preview-workflow-graph"/);
  assert.match(source, /previewAgentGraph/);
  assert.match(source, /workflowGraphPreview/);
});

test("main Workflow page renders saved edges instead of hiding the graph topology", () => {
  const source = readFileSync(join(studioRoot, "src/main.js"), "utf-8");
  const renderer = source.slice(source.indexOf("function renderWorkflow()"), source.indexOf("function renderTemplate()"));

  assert.match(renderer, /state\.workflowEdges\.map/);
  assert.match(renderer, /workflow-edge/);
  assert.match(renderer, /START/);
  assert.match(renderer, /END/);
});

test("main Workflow page exposes a selected Node delete action that clears connected edges", () => {
  const source = readFileSync(join(studioRoot, "src/main.js"), "utf-8");
  const renderer = source.slice(source.indexOf("function renderWorkflow()"), source.indexOf("function renderTemplate()"));
  const handler = source.slice(source.indexOf("async function handleAction"), source.indexOf("function handleWorkflowNodePointerDown"));
  const deleteFunction = source.slice(source.indexOf("function deleteWorkflowNode"), source.indexOf("function selectWorkflowEdge"));

  assert.match(renderer, /data-action="delete-workflow-node"/);
  assert.match(handler, /delete-workflow-node/);
  assert.match(deleteFunction, /workflowNodes\.filter/);
  assert.match(deleteFunction, /workflowEdges\.filter/);
  assert.match(deleteFunction, /workflowSelectedNodeId = null/);
});
