import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\tests$/, "");

function mainSource() {
  return readFileSync(join(studioRoot, "src/main.js"), "utf-8");
}

function sourceSlice(source, start, end) {
  return source.slice(source.indexOf(start), source.indexOf(end));
}

test("T20 main Workflow route loads only Agent Workflow V2 runtime data", () => {
  const source = mainSource();
  const loader = sourceSlice(source, "} else if (requestedRoute === \"/workflow\")", "    }\n    state.toast");

  assert.match(loader, /fetchWorkflowTools\(client\)/);
  assert.match(loader, /workflowV2Workbench\(\)\.loadWorkflowTools\(\)/);
  assert.match(loader, /workflowV2Workbench\(\)\.refreshWorkflowVersions\(\)/);
  assert.doesNotMatch(loader, /fetchTemplates/);
  assert.doesNotMatch(loader, /fetchTemplate/);
  assert.doesNotMatch(loader, /loadWorkflowManifest/);
});

test("T20 main Workflow renderer exposes only the Agent Workflow V2 page", () => {
  const source = mainSource();
  const renderer = sourceSlice(source, "function renderWorkflow()", "function renderWorkflowV2NodeLibrary");
  const v2Renderer = sourceSlice(source, "function renderWorkflowV2()", "function renderWorkflowV2NodeLibrary");
  const v2NodeLibrary = sourceSlice(source, "function renderWorkflowV2NodeLibrary", "function renderWorkflowCanvasContent");

  assert.match(renderer, /return renderWorkflowV2\(\)/);
  assert.doesNotMatch(renderer, /renderWorkflowLegacy/);
  assert.doesNotMatch(renderer, /schemaVersion=1/);
  assert.match(v2Renderer, /Agent Workflow V2/);
  assert.match(v2NodeLibrary, /AGENT_WORKFLOW_V2_NODE_TYPES/);
  assert.match(v2NodeLibrary, /data-action="add-workflow-v2-node"/);
  assert.doesNotMatch(v2Renderer, /data-action="add-workflow-node"/);
  assert.doesNotMatch(v2Renderer, /Add Prompt/);
  assert.doesNotMatch(v2Renderer, /Legacy Workflow/);
});

test("T20 main Workflow action handler keeps only V2 Workflow actions", () => {
  const source = mainSource();
  const handler = sourceSlice(source, "async function handleAction", "function handleWorkflowNodePointerDown");

  assert.match(handler, /add-workflow-v2-node/);
  assert.match(handler, /select-workflow-v2-node/);
  assert.match(handler, /save-workflow-v2-draft/);
  assert.match(handler, /validate-workflow-v2/);
  assert.match(handler, /publish-workflow-v2/);
  assert.match(handler, /run-workflow-v2/);
  assert.doesNotMatch(handler, /add-workflow-node/);
  assert.doesNotMatch(handler, /connect-workflow-edge/);
  assert.doesNotMatch(handler, /preview-workflow-graph/);
  assert.doesNotMatch(handler, /publish-workflow"/);
  assert.doesNotMatch(handler, /test-workflow/);
  assert.doesNotMatch(handler, /use-workflow-agent/);
});

test("T20 main Workflow V2 page wires draft validate publish and run actions to Workflow V2 APIs", () => {
  const source = mainSource();
  const v2Renderer = sourceSlice(source, "function renderWorkflowV2()", "function renderWorkflowV2NodeLibrary()");
  const listener = sourceSlice(source, "const workflowV2RunInput", "const workflowEdgeSource");
  const handler = sourceSlice(source, "async function handleAction", "function handleWorkflowNodePointerDown");
  const workbenchFactory = sourceSlice(source, "function workflowV2Workbench()", "function runtimeClient()");
  const realClient = sourceSlice(source, "function realClient()", "function mockClient()");
  const mockClient = sourceSlice(source, "function mockClient()", "async function getJson");

  assert.match(source, /createStarterWorkflowV2Definition/);
  assert.match(workbenchFactory, /workflowDefinition:\s*createStarterWorkflowV2Definition/);
  assert.match(workbenchFactory, /selectNode\("analyze-request"\)/);
  assert.match(v2Renderer, /data-action="save-workflow-v2-draft"/);
  assert.match(v2Renderer, /data-action="validate-workflow-v2"/);
  assert.match(v2Renderer, /data-action="publish-workflow-v2"/);
  assert.match(v2Renderer, /data-action="run-workflow-v2"/);
  assert.match(v2Renderer, /data-testid="workflow-v2-agent-instruction"/);
  assert.match(listener, /workflow-v2-agent-instruction/);
  assert.match(listener, /updateSelectedAgentConfig/);
  assert.doesNotMatch(v2Renderer, /data-action="not-implemented" disabled>Save Draft/);
  assert.match(handler, /save-workflow-v2-draft/);
  assert.match(handler, /validate-workflow-v2/);
  assert.match(handler, /publish-workflow-v2/);
  assert.match(handler, /run-workflow-v2/);
  assert.match(source, /workflowV2Workbench\(\)/);
  assert.match(source, /ensureWorkflowV2Definition/);
  assert.match(realClient, /createWorkflow:/);
  assert.match(realClient, /saveWorkflowDraft:/);
  assert.match(realClient, /validateWorkflow:/);
  assert.match(realClient, /publishWorkflow:/);
  assert.match(realClient, /startWorkflowRun:/);
  assert.match(mockClient, /createWorkflow/);
  assert.match(mockClient, /saveWorkflowDraft/);
  assert.match(mockClient, /validateWorkflow/);
  assert.match(mockClient, /publishWorkflow/);
  assert.match(mockClient, /startWorkflowRun/);
});
