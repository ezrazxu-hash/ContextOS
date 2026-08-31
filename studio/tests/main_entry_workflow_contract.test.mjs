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

test("main Workflow node config panel uses compact sections and clear editor borders", () => {
  const source = readFileSync(join(studioRoot, "src/main.js"), "utf-8");
  const renderer = source.slice(source.indexOf("function renderWorkflow()"), source.indexOf("function renderWorkflowCanvasContent()"));
  const styles = source.slice(source.indexOf("function styleTag()"));

  assert.match(renderer, /workflow-config-resize-handle/);
  assert.match(renderer, /--workflow-config-panel-width/);
  assert.match(renderer, /node-config-section basic-info/);
  assert.match(renderer, /node-config-meta/);
  assert.match(renderer, /node-config-section node-config-fields/);
  assert.match(renderer, /node-config-section danger-zone/);
  assert.match(renderer, /node-config-section edge-builder/);
  assert.match(styles, /grid-template-columns:\s*180px minmax\(320px, 1fr\) 8px var\(--workflow-config-panel-width\)/);
  assert.match(styles, /\.workflow-config-resize-handle/s);
  assert.match(styles, /\.node-config textarea\s*\{[^}]*border:\s*1px solid var\(--line-strong\)/s);
  assert.match(styles, /\.node-config textarea:hover/s);
  assert.match(styles, /\.node-config textarea:focus/s);
});

test("main Workflow node config renderer applies visibility editability required and examples", () => {
  const source = readFileSync(join(studioRoot, "src/main.js"), "utf-8");
  const renderer = source.slice(source.indexOf("function renderWorkflowNodeConfig"), source.indexOf("function renderSelectedToolMetadata"));
  const listener = source.slice(source.indexOf("document.querySelectorAll(\"[data-workflow-config-path]\")"), source.indexOf("const workflowTestInput"));
  const styles = source.slice(source.indexOf("function styleTag()"));

  assert.match(source, /visibility:\s*"hidden"/);
  assert.match(source, /editable:\s*false/);
  assert.match(renderer, /workflow-config-required/);
  assert.match(renderer, /workflow-config-label/);
  assert.match(renderer, /aria-label="Required"/);
  assert.match(renderer, />\*<\/span>/);
  assert.doesNotMatch(renderer, />Required<\/span>/);
  assert.match(styles, /\.workflow-config-label\s*\{[^}]*display:\s*inline-flex/s);
  assert.match(styles, /\.workflow-config-required\s*\{[^}]*vertical-align:\s*super/s);
  assert.match(styles, /\.workflow-config-required\s*\{[^}]*position:\s*relative/s);
  assert.match(renderer, /placeholder="\$\{escapeAttr\(field\.example/);
  assert.match(renderer, /readonly/);
  assert.match(renderer, /disabled/);
  assert.match(listener, /isEditableWorkflowConfigPath/);
});

test("main Workflow node config uses binding controls for data references", () => {
  const source = readFileSync(join(studioRoot, "src/main.js"), "utf-8");
  const renderer = source.slice(source.indexOf("function renderWorkflowBindingField"), source.indexOf("function renderSelectedToolMetadata"));
  const updater = source.slice(source.indexOf("function updateSelectedWorkflowBinding"), source.indexOf("async function openWorkflow"));
  const helpers = source.slice(source.indexOf("function workflowReferenceValueFromControls"), source.indexOf("function formatWorkflowValue"));

  assert.match(source, /binding:\s*"template_variables"/);
  assert.match(source, /binding:\s*"tool_args"/);
  assert.match(source, /binding:\s*"reference"/);
  assert.match(renderer, /data-workflow-binding-control/);
  assert.match(renderer, /Message history/);
  assert.match(renderer, /workflowToolArgumentFields/);
  assert.match(updater, /node\.config\[fieldPath\]/);
  assert.match(helpers, /type:\s*"node_output"/);
  assert.match(helpers, /node_id/);
  assert.match(helpers, /type:\s*"workflow_input"/);
});

test("main Workflow page keeps active published version when loading saved templates", () => {
  const source = readFileSync(join(studioRoot, "src/main.js"), "utf-8");
  const loader = source.slice(source.indexOf("async function loadRouteData"), source.indexOf("function isCurrentRouteLoad"));
  const workflowLoader = source.slice(source.indexOf("function loadWorkflowManifest"), source.indexOf("function clearWorkflowDraft"));
  const summary = source.slice(source.indexOf("function workflowTemplateSummary"), source.indexOf("function defaultWorkflowPosition"));

  assert.match(loader, /activeWorkflowVersionFromTemplate\(template\)/);
  assert.match(workflowLoader, /activeVersion = null/);
  assert.match(workflowLoader, /workflowPublishedVersion = activeVersion/);
  assert.match(summary, /active_version_id/);
  assert.match(summary, /status:\s*"published"/);
});
