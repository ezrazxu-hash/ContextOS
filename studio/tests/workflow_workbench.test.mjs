import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\tests$/, "");

function moduleUrl(relativePath) {
  return pathToFileURL(join(studioRoot, relativePath)).href;
}

function createMemoryPlatform() {
  const storage = new Map();
  return {
    readUiState(key) {
      return storage.get(key) ?? null;
    },
    writeUiState(key, value) {
      storage.set(key, value);
    },
  };
}

test("UI05-T01-TC01: resizing side panels keeps workflow canvas dimensions valid", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
  });

  workbench.resizePanel("left", 360);
  workbench.resizePanel("right", 420);

  const view = workbench.view();

  assert.equal(view.kind, "workflow-workbench");
  assert.deepEqual(view.columns.map((column) => column.id), ["node-library", "canvas", "node-config"]);
  assert.equal(view.columns[0].width, 360);
  assert.equal(view.columns[2].width, 420);
  assert.equal(view.canvas.role, "workflow-canvas");
  assert.equal(view.canvas.width, view.columns[1].width);
  assert.ok(view.canvas.width >= view.canvas.minWidth);
});

test("UI05-T01-TC02: dirty workflow protects refresh and preserves node drafts across selection changes", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
  });

  workbench.addNode({ id: "llm", type: "llm", config: { model: "default" } });
  workbench.addNode({ id: "tool", type: "tool", config: { tool_name: "search" } });
  workbench.selectNode("llm");
  workbench.updateNodeConfigDraft({ model: "fast-model" });
  workbench.selectNode("tool");
  workbench.selectNode("llm");

  const view = workbench.view();

  assert.equal(view.header.status, "dirty");
  assert.equal(view.header.actions.save.enabled, true);
  assert.equal(view.refreshProtection.enabled, true);
  assert.match(view.refreshProtection.message, /unsaved workflow changes/i);
  assert.deepEqual(view.nodeConfig.draft, { model: "fast-model" });
  assert.equal(view.nodeConfig.hasUncommittedChanges, true);
});

test("UI05-T01-TC03: successful save clears dirty workflow state", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const savedTemplates = [];
  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
    apiClient: {
      async validateTemplate() {
        return { valid: true, issues: [] };
      },
      async saveTemplate(manifest) {
        savedTemplates.push(manifest.template.id);
      },
    },
  });

  workbench.addNode({ id: "llm", type: "llm", config: { model: "default", prompt: "{{input}}", output_key: "answer" } });
  assert.equal(workbench.view().header.status, "dirty");

  const result = await workbench.save({ id: "research-agent", name: "Research Agent", version: "1.0.0" });

  const view = workbench.view();
  assert.equal(result.status, "saved");
  assert.deepEqual(savedTemplates, ["research-agent"]);
  assert.equal(view.header.status, "saved");
  assert.equal(view.header.actions.save.enabled, false);
  assert.equal(view.refreshProtection.enabled, false);
});

test("UI05-T02-TC01: searching Tool only shows related runtime library nodes", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
  });

  workbench.searchNodeLibrary("Tool");

  const matches = workbench.view().nodeLibrary.items;
  assert.deepEqual(matches.map((node) => node.type), ["tool"]);
  assert.equal(matches[0].category, "Tools");
  assert.match(matches[0].label, /TOOL/);
});

test("UI05-T02-TC02: dropping library nodes creates unique manifest node ids at stable positions", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
  });

  const first = workbench.dropLibraryNode("prompt", { x: 120, y: 160 });
  const second = workbench.dropLibraryNode("prompt", { x: 180, y: 220 });
  const manifest = workbench.serializeManifest();

  assert.notEqual(first.node.id, second.node.id);
  assert.deepEqual(manifest.runtime.nodes.map((node) => node.id), [first.node.id, second.node.id]);
  assert.deepEqual(workbench.view().canvas.nodes.map((node) => node.position), [
    { x: 120, y: 160 },
    { x: 180, y: 220 },
  ]);
  assert.equal(first.preview.dropPosition.x, 120);
});

test("T81 node library only creates V1 runtime-supported workflow nodes", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
  });

  assert.deepEqual(
    workbench.view().nodeLibrary.items.map((node) => node.type),
    ["prompt", "llm", "tool", "condition", "output"],
  );

  const llm = workbench.dropLibraryNode("llm", { x: 120, y: 160 });
  assert.equal(llm.node.type, "llm");
  assert.deepEqual(llm.node.position, { x: 120, y: 160 });
  assert.throws(() => workbench.dropLibraryNode("agent", { x: 0, y: 0 }), /not supported/i);
  assert.throws(() => workbench.dropLibraryNode("router", { x: 0, y: 0 }), /not supported/i);
  assert.throws(() => workbench.dropLibraryNode("START", { x: 0, y: 0 }), /not supported/i);
});

test("UI05-T02-TC03: unsupported validator node types cannot be created from the library", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
    manifestSchema: {
      supportedNodeTypes: ["agent", "prompt", "tool"],
    },
  });

  assert.deepEqual(
    workbench.view().nodeLibrary.items.map((node) => node.type),
    ["prompt", "tool"],
  );
  assert.throws(
    () => workbench.dropLibraryNode("context_operator", { x: 0, y: 0 }),
    /not supported by the active workflow schema/i,
  );
  assert.deepEqual(workbench.serializeManifest().runtime.nodes, []);
});

test("UI05-T03-TC01: Backspace in a focused config input does not delete selected canvas nodes", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
  });

  const dropped = workbench.dropLibraryNode("llm", { x: 100, y: 100 });
  workbench.selectNode(dropped.node.id);

  const result = workbench.handleCanvasKeyDown({
    key: "Backspace",
    targetRole: "input",
  });

  assert.equal(result.handled, false);
  assert.deepEqual(
    workbench.serializeManifest().runtime.nodes.map((node) => node.id),
    [dropped.node.id],
  );
});

test("UI05-T03-TC02: fit view frames the complete workflow graph", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
  });

  workbench.dropLibraryNode("prompt", { x: 100, y: 120 });
  workbench.dropLibraryNode("tool", { x: 500, y: 420 });
  workbench.setCanvasTool("pan");

  const fit = workbench.fitCanvasView();
  const view = workbench.view();

  assert.equal(view.canvas.toolbar.activeTool, "pan");
  assert.deepEqual(
    view.canvas.toolbar.tools.map((tool) => tool.id),
    ["pointer", "pan", "zoom", "fit", "grid"],
  );
  assert.deepEqual(fit.bounds, { minX: 100, minY: 120, maxX: 500, maxY: 420 });
  assert.equal(view.canvas.viewport.mode, "fit");
  assert.deepEqual(view.canvas.viewport.bounds, fit.bounds);
});

test("UI05-T03-TC04: Ctrl wheel zooms the workflow canvas within bounded limits", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
  });

  const zoomedIn = workbench.handleCanvasWheel({ ctrlKey: true, deltaY: -120 });
  const zoomedOut = workbench.handleCanvasWheel({ ctrlKey: true, deltaY: 120 });
  for (let index = 0; index < 40; index += 1) {
    workbench.handleCanvasWheel({ ctrlKey: true, deltaY: 120 });
  }

  assert.equal(zoomedIn.handled, true);
  assert.ok(zoomedIn.viewport.zoom > 1);
  assert.equal(zoomedOut.handled, true);
  assert.equal(workbench.view().canvas.viewport.zoom, 0.4);
  assert.equal(workbench.view().canvas.viewport.minZoom, 0.4);
  assert.equal(workbench.view().canvas.viewport.maxZoom, 2);
});

test("UI05-T03-TC05: ordinary wheel preserves scroll behavior and canvas zoom", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
  });

  const result = workbench.handleCanvasWheel({ ctrlKey: false, deltaY: -120 });

  assert.deepEqual(result, { handled: false });
  assert.equal(workbench.view().canvas.viewport.zoom, 1);
  assert.equal(workbench.view().header.dirty, false);
});

test("UI05-T03-TC06: right button drag pans the workflow canvas without dirtying the manifest", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
  });

  const started = workbench.startCanvasPan({
    button: 2,
    targetRole: "canvas",
    clientX: 120,
    clientY: 140,
    scrollLeft: 40,
    scrollTop: 60,
  });
  const moved = workbench.moveCanvasPan({ clientX: 90, clientY: 105 });
  const ended = workbench.endCanvasPan();

  assert.equal(started.handled, true);
  assert.equal(started.preventContextMenu, true);
  assert.deepEqual(moved, { handled: true, scrollLeft: 70, scrollTop: 95 });
  assert.deepEqual(ended, { handled: true });
  assert.equal(workbench.view().canvas.viewport.panning, false);
  assert.equal(workbench.view().header.dirty, false);
});

test("UI05-T03-TC07: ordinary right click does not leave the workflow canvas panning", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
  });

  const started = workbench.startCanvasPan({
    button: 2,
    targetRole: "canvas",
    clientX: 120,
    clientY: 140,
    scrollLeft: 40,
    scrollTop: 60,
  });
  const ended = workbench.endCanvasPan();

  assert.equal(started.handled, true);
  assert.deepEqual(ended, { handled: true });
  assert.equal(workbench.view().canvas.viewport.panning, false);
  assert.equal(workbench.view().canvas.viewport.panMoved, false);
});

test("UI05-T03-TC03: deleting a selected node removes connected edges from the draft manifest", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
  });

  const llm = workbench.dropLibraryNode("llm", { x: 100, y: 100 }).node;
  const tool = workbench.dropLibraryNode("tool", { x: 300, y: 100 }).node;
  const output = workbench.dropLibraryNode("output", { x: 500, y: 100 }).node;
  workbench.connect(llm.id, tool.id);
  workbench.connect(tool.id, output.id);
  workbench.selectNode(tool.id);

  const result = workbench.handleCanvasKeyDown({ key: "Delete", targetRole: "canvas" });
  const manifest = workbench.serializeManifest();

  assert.equal(result.handled, true);
  assert.deepEqual(
    manifest.runtime.nodes.map((node) => node.id),
    [llm.id, output.id],
  );
  assert.deepEqual(manifest.runtime.edges, []);
  assert.equal(workbench.view().nodeConfig.selectedNodeId, null);
});

test("T94 Node Config delete action removes the selected node and clears the panel", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
  });

  const prompt = workbench.dropLibraryNode("prompt", { x: 100, y: 100 }).node;
  const tool = workbench.dropLibraryNode("tool", { x: 300, y: 100 }).node;
  const output = workbench.dropLibraryNode("output", { x: 500, y: 100 }).node;
  workbench.connect("START", prompt.id);
  workbench.connect(prompt.id, tool.id);
  workbench.connect(tool.id, output.id);
  workbench.connect(output.id, "END");
  workbench.selectNode(tool.id);

  const before = workbench.view().nodeConfig;
  const deleted = workbench.deleteSelectedNode();
  const view = workbench.view();
  const manifest = workbench.serializeManifest();

  assert.equal(before.actions.delete.enabled, true);
  assert.equal(before.actions.delete.tone, "danger");
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.nodeId, tool.id);
  assert.equal(deleted.removedEdgeCount, 2);
  assert.deepEqual(manifest.runtime.nodes.map((node) => node.id), [prompt.id, output.id]);
  assert.deepEqual(manifest.runtime.edges, [
    { source: "START", target: prompt.id },
    { source: output.id, target: "END" },
  ]);
  assert.equal(view.nodeConfig.selectedNodeId, null);
  assert.equal(view.nodeConfig.actions.delete.enabled, false);
});

test("UI05-T04-TC04: Delete removes only the selected canvas edge", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
  });

  const prompt = workbench.dropLibraryNode("prompt", { x: 100, y: 100 }).node;
  const tool = workbench.dropLibraryNode("tool", { x: 300, y: 100 }).node;
  const output = workbench.dropLibraryNode("output", { x: 500, y: 100 }).node;
  workbench.connect(prompt.id, tool.id);
  workbench.connect(tool.id, output.id);
  const edgeId = workbench.view().canvas.edges.find((edge) => edge.from === prompt.id && edge.to === tool.id).id;

  const selected = workbench.selectCanvasEdge(edgeId);
  const result = workbench.handleCanvasKeyDown({ key: "Delete", targetRole: "canvas" });
  const manifest = workbench.serializeManifest();

  assert.equal(selected.selected, true);
  assert.equal(result.handled, true);
  assert.deepEqual(
    manifest.runtime.nodes.map((node) => node.id),
    [prompt.id, tool.id, output.id],
  );
  assert.deepEqual(
    manifest.runtime.edges.map((edge) => `${edge.source ?? edge.from}->${edge.target ?? edge.to}`),
    [`${tool.id}->${output.id}`],
  );
  assert.equal(workbench.view().canvas.selectedEdgeId, null);
});

test("T82 moving a node updates its manifest position and keeps selection", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
  });

  const llm = workbench.dropLibraryNode("llm", { x: 100, y: 100 }).node;
  workbench.selectNode(llm.id);
  const moved = workbench.moveCanvasNode(llm.id, { x: 320, y: 240 });

  const manifest = workbench.serializeManifest();
  const manifestNode = manifest.runtime.nodes[0];
  assert.deepEqual(moved.node.position, { x: 320, y: 240 });
  assert.equal(manifestNode.position, undefined);
  assert.deepEqual(manifest.ui.nodes[llm.id].position, { x: 320, y: 240 });
  assert.equal(workbench.view().nodeConfig.selectedNodeId, llm.id);
  assert.equal(workbench.view().header.dirty, true);
});

test("T82 duplicating a selected node clones config without cloning edges", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
  });

  const llm = workbench.dropLibraryNode("llm", { x: 100, y: 100 }).node;
  const output = workbench.dropLibraryNode("output", { x: 300, y: 100 }).node;
  workbench.updateNodeConfig(llm.id, { model: "default", output_key: "answer" });
  workbench.connectCanvasEdge(llm.id, output.id);
  workbench.selectNode(llm.id);

  const duplicate = workbench.duplicateSelectedNode({ x: 40, y: 24 });
  const manifest = workbench.serializeManifest();

  assert.notEqual(duplicate.node.id, llm.id);
  assert.equal(duplicate.node.type, "llm");
  assert.deepEqual(duplicate.node.config, { model: "default", output_key: "answer" });
  assert.deepEqual(duplicate.node.position, { x: 140, y: 124 });
  assert.deepEqual(
    manifest.runtime.nodes.map((node) => node.id),
    [llm.id, output.id, duplicate.node.id],
  );
  assert.deepEqual(manifest.runtime.edges, [{ source: llm.id, target: output.id }]);
  assert.equal(workbench.view().nodeConfig.selectedNodeId, duplicate.node.id);
});

test("UI05-T04-TC01: Condition True/False edge labels and handles serialize stably", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
  });

  const condition = workbench.dropLibraryNode("condition", { x: 100, y: 100 }).node;
  const tool = workbench.dropLibraryNode("tool", { x: 300, y: 40 }).node;
  const output = workbench.dropLibraryNode("output", { x: 300, y: 180 }).node;

  workbench.connectCanvasEdge(condition.id, tool.id, { branch: "true" });
  workbench.connectCanvasEdge(condition.id, output.id, { branch: "false" });

  const manifest = workbench.serializeManifest();
  assert.deepEqual(manifest.runtime.edges, [
    { source: condition.id, target: tool.id, route: "true" },
    { source: condition.id, target: output.id, route: "false" },
  ]);
  assert.deepEqual(
    workbench.view().canvas.edges.map((edge) => edge.label),
    ["True", "False"],
  );
  assert.deepEqual(workbench.view().canvas.nodes.find((node) => node.id === condition.id).handles.outputs, ["true", "false"]);
});

test("UI05-T04-TC02: backend rejected edges are highlighted in canvas and validation panel", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
    apiClient: {
      async validateTemplate() {
        return {
          valid: false,
          error: { field_path: "runtime.edges[0]", code: "invalid_edge", message: "Condition branch is unsupported" },
        };
      },
    },
  });

  const condition = workbench.dropLibraryNode("condition", { x: 100, y: 100 }).node;
  const tool = workbench.dropLibraryNode("tool", { x: 300, y: 100 }).node;
  workbench.connectCanvasEdge(condition.id, tool.id, { branch: "true" });

  const validation = await workbench.validateWithBackend();
  const view = workbench.view();

  assert.equal(validation.valid, false);
  assert.equal(view.canvas.edges[0].status, "invalid");
  assert.equal(view.canvas.edges[0].error.code, "invalid_edge");
  assert.deepEqual(view.validationPanel.issues, [
    {
      fieldPath: "runtime.edges[0]",
      code: "invalid_edge",
      message: "Condition branch is unsupported",
      target: { kind: "edge", index: 0, from: condition.id, to: tool.id },
    },
  ]);
});

test("UI05-T04-TC03: deleting an edge keeps both endpoint nodes", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
  });

  const llm = workbench.dropLibraryNode("llm", { x: 100, y: 100 }).node;
  const output = workbench.dropLibraryNode("output", { x: 300, y: 100 }).node;
  const edge = workbench.connectCanvasEdge(llm.id, output.id);

  workbench.deleteCanvasEdge(edge.edge.id);

  const manifest = workbench.serializeManifest();
  assert.deepEqual(
    manifest.runtime.nodes.map((node) => node.id),
    [llm.id, output.id],
  );
  assert.deepEqual(manifest.runtime.edges, []);
});

test("T83 reconnecting an edge replaces the draft edge without changing nodes", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
  });

  const llm = workbench.dropLibraryNode("llm", { x: 100, y: 100 }).node;
  const tool = workbench.dropLibraryNode("tool", { x: 300, y: 100 }).node;
  const output = workbench.dropLibraryNode("output", { x: 500, y: 100 }).node;
  const edge = workbench.connectCanvasEdge(llm.id, output.id);

  const reconnected = workbench.reconnectCanvasEdge(edge.edge.id, { source: tool.id, target: output.id });
  const manifest = workbench.serializeManifest();

  assert.equal(reconnected.accepted, true);
  assert.deepEqual(manifest.runtime.edges, [{ source: tool.id, target: output.id }]);
  assert.deepEqual(
    manifest.runtime.nodes.map((node) => node.id),
    [llm.id, tool.id, output.id],
  );
  assert.equal(workbench.view().header.dirty, true);
});

test("T83 invalid edge reconnect keeps the original edge", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
  });

  const llm = workbench.dropLibraryNode("llm", { x: 100, y: 100 }).node;
  const output = workbench.dropLibraryNode("output", { x: 300, y: 100 }).node;
  const edge = workbench.connectCanvasEdge(llm.id, output.id);

  const reconnected = workbench.reconnectCanvasEdge(edge.edge.id, { source: "missing", target: output.id });
  const manifest = workbench.serializeManifest();

  assert.equal(reconnected.accepted, false);
  assert.equal(reconnected.issue.code, "unknown_node");
  assert.deepEqual(manifest.runtime.edges, [{ source: llm.id, target: output.id }]);
});

test("T85 Prompt node config exposes template assembly fields", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
  });

  const prompt = workbench.dropLibraryNode("prompt", { x: 100, y: 100 }).node;
  workbench.selectNode(prompt.id);

  const config = workbench.view().nodeConfig;

  assert.deepEqual(
    config.sections.map((section) => section.id),
    ["template", "io"],
  );
  assert.deepEqual(
    config.sections.flatMap((section) => section.fields.map((field) => field.path)),
    ["role", "template", "variables", "input_mapping", "output_key"],
  );
  assert.deepEqual(
    config.sections.flatMap((section) => section.fields.filter((field) => field.required).map((field) => field.path)),
    ["template", "output_key"],
  );
});

test("T85 Prompt node local config validation maps required fields to controls", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
  });

  const prompt = workbench.dropLibraryNode("prompt", { x: 100, y: 100 }).node;
  workbench.selectNode(prompt.id);

  const validation = workbench.validateSelectedNodeConfig();

  assert.equal(validation.valid, false);
  assert.deepEqual(
    validation.errors.map((error) => error.fieldPath),
    [
      `runtime.nodes[${prompt.id}].config.template`,
      `runtime.nodes[${prompt.id}].config.output_key`,
    ],
  );
});

test("T84 LLM node config exposes backend executable fields", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
  });

  const llm = workbench.dropLibraryNode("llm", { x: 100, y: 100 }).node;
  workbench.selectNode(llm.id);

  const config = workbench.view().nodeConfig;

  assert.deepEqual(
    config.sections.map((section) => section.id),
    ["model", "prompt", "io"],
  );
  assert.deepEqual(
    config.sections.flatMap((section) => section.fields.map((field) => field.path)),
    ["provider", "model", "max_tokens", "system_prompt", "prompt", "temperature", "input_mapping", "output_key"],
  );
  assert.deepEqual(
    config.sections.flatMap((section) => section.fields.filter((field) => field.required).map((field) => field.path)),
    ["model", "prompt", "output_key"],
  );
});

test("T84 LLM node local config validation maps required fields to controls", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
  });

  const llm = workbench.dropLibraryNode("llm", { x: 100, y: 100 }).node;
  workbench.selectNode(llm.id);

  const validation = workbench.validateSelectedNodeConfig();

  assert.equal(validation.valid, false);
  assert.deepEqual(
    validation.errors.map((error) => error.fieldPath),
    [
      `runtime.nodes[${llm.id}].config.model`,
      `runtime.nodes[${llm.id}].config.prompt`,
      `runtime.nodes[${llm.id}].config.output_key`,
    ],
  );
});

test("UI05-T05-TC02: Tool node config omits model-only fields", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
  });

  const tool = workbench.dropLibraryNode("tool", { x: 100, y: 100 }).node;
  workbench.selectNode(tool.id);

  const paths = workbench.view().nodeConfig.sections.flatMap((section) => section.fields.map((field) => field.path));

  assert.deepEqual(paths, ["tool_name", "args", "output_key"]);
  assert.ok(!paths.includes("model"));
  assert.ok(!paths.includes("system_prompt"));
});

test("T86 Tool node config exposes executable tool fields", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
  });

  const tool = workbench.dropLibraryNode("tool", { x: 100, y: 100 }).node;
  workbench.selectNode(tool.id);

  const config = workbench.view().nodeConfig;

  assert.deepEqual(
    config.sections.map((section) => section.id),
    ["tool", "io"],
  );
  assert.deepEqual(
    config.sections.flatMap((section) => section.fields.map((field) => field.path)),
    ["tool_name", "args", "output_key"],
  );
  assert.deepEqual(
    config.sections.flatMap((section) => section.fields.filter((field) => field.required).map((field) => field.path)),
    ["tool_name", "output_key"],
  );
});

test("T87 Condition node config exposes branch condition fields", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
  });

  const condition = workbench.dropLibraryNode("condition", { x: 100, y: 100 }).node;
  workbench.selectNode(condition.id);

  const config = workbench.view().nodeConfig;

  assert.deepEqual(
    config.sections.map((section) => section.id),
    ["condition"],
  );
  assert.deepEqual(
    config.sections.flatMap((section) => section.fields.map((field) => field.path)),
    ["source", "operator", "value", "state_key"],
  );
  assert.deepEqual(
    config.sections.flatMap((section) => section.fields.filter((field) => field.required).map((field) => field.path)),
    ["source", "operator"],
  );
});

test("T88 Router node is reserved and cannot be created from the library", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
  });

  assert.throws(() => workbench.dropLibraryNode("router", { x: 100, y: 100 }), /not supported/i);
});

test("T89 Output node config exposes final output source", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
  });

  const output = workbench.dropLibraryNode("output", { x: 100, y: 100 }).node;
  workbench.selectNode(output.id);

  const config = workbench.view().nodeConfig;

  assert.deepEqual(config.sections.map((section) => section.id), ["output"]);
  assert.deepEqual(
    config.sections.flatMap((section) => section.fields.map((field) => field.path)),
    ["source"],
  );
  assert.deepEqual(
    config.sections.flatMap((section) => section.fields.filter((field) => field.required).map((field) => field.path)),
    ["source"],
  );
});

test("T89 canvas exposes START and END as non-library boundary nodes", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
  });

  const view = workbench.view();

  assert.deepEqual(view.canvas.boundaryNodes.map((node) => node.id), ["START", "END"]);
  assert.deepEqual(view.canvas.boundaryNodes.map((node) => node.locked), [true, true]);
  assert.deepEqual(
    view.nodeLibrary.items.map((node) => node.type),
    ["prompt", "llm", "tool", "condition", "output"],
  );
});

test("UI05-T05-TC03: backend field errors map back to concrete config controls", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
    apiClient: {
      async validateTemplate() {
        return {
          valid: false,
          error: {
            field_path: "runtime.nodes[0].config.model",
            code: "required",
            message: "Model is required",
          },
        };
      },
    },
  });

  const llm = workbench.dropLibraryNode("llm", { x: 100, y: 100 }).node;
  workbench.selectNode(llm.id);

  const local = workbench.validateSelectedNodeConfig();
  const backend = await workbench.validateWithBackend();
  const field = workbench.view().nodeConfig.sections.flatMap((section) => section.fields).find((item) => item.path === "model");

  assert.equal(local.valid, false);
  assert.equal(backend.valid, false);
  assert.deepEqual(field.error, {
    fieldPath: "runtime.nodes[0].config.model",
    code: "required",
    message: "Model is required",
  });
  assert.deepEqual(workbench.view().nodeConfig.validation, {
    valid: false,
    errors: [
      {
        sectionId: "model",
        fieldPath: "runtime.nodes[0].config.model",
        code: "required",
        message: "Model is required",
      },
    ],
  });
});

test("UI05-T07-TC01: validation failure disables Publish", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const publishCalls = [];
  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
    apiClient: {
      async validateTemplate() {
        return { valid: false, error: { field_path: "graph.edges[0]", code: "invalid_edge" } };
      },
      async publishTemplate(manifest) {
        publishCalls.push(manifest.template.id);
      },
    },
  });

  workbench.dropLibraryNode("llm", { x: 100, y: 100 });

  const validation = await workbench.validateDraft();
  const published = await workbench.publishDraft();
  const view = workbench.view();

  assert.equal(validation.valid, false);
  assert.equal(view.header.actions.publish.enabled, false);
  assert.equal(view.header.actions.publish.reason, "validation_failed");
  assert.equal(published.status, "blocked");
  assert.equal(published.reason, "validation_failed");
  assert.deepEqual(publishCalls, []);
});

test("UI05-T07-TC02: Preview uses draft manifest without changing published version", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const previewedTemplates = [];
  const publishedTemplates = [];
  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
    publishedVersion: "1.0.0",
    apiClient: {
      async previewTemplate(manifest) {
        previewedTemplates.push(manifest.template.version);
        return { status: "previewed", run_id: "preview-1" };
      },
      async publishTemplate(manifest) {
        publishedTemplates.push(manifest.template.version);
        return { status: "published", version: manifest.template.version };
      },
    },
  });

  workbench.dropLibraryNode("llm", { x: 100, y: 100 });

  const preview = await workbench.previewDraft({ input: "hello" });
  const view = workbench.view();

  assert.equal(preview.status, "previewed");
  assert.deepEqual(previewedTemplates, ["1.0.0"]);
  assert.deepEqual(publishedTemplates, []);
  assert.equal(view.header.publish.version, "1.0.0");
  assert.equal(view.header.actions.preview.status, "idle");
});

test("UI05-T07-TC03: Save failure keeps dirty state and user selection", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
    apiClient: {
      async validateTemplate() {
        return { valid: true, issues: [] };
      },
      async saveTemplate() {
        throw new Error("storage unavailable");
      },
    },
  });

  const llm = workbench.dropLibraryNode("llm", { x: 100, y: 100 }).node;
  workbench.selectNode(llm.id);
  const saved = await workbench.saveDraft({ id: "research-agent", name: "Research Agent", version: "1.0.1" });
  const view = workbench.view();

  assert.equal(saved.status, "failed");
  assert.equal(view.header.status, "error");
  assert.equal(view.header.dirty, true);
  assert.equal(view.refreshProtection.enabled, true);
  assert.equal(view.nodeConfig.selectedNodeId, llm.id);
  assert.equal(view.header.actions.save.enabled, true);
});

test("T8A Save Draft persists runtime/ui manifest through workflow API client", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const saved = [];
  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
    apiClient: {
      async validateAgentDraft(agentId, manifest) {
        return { valid: true, agentId, manifest };
      },
      async saveAgentDraft(agentId, manifest) {
        saved.push({ agentId, manifest });
        return { status: "saved", agent_id: agentId, manifest };
      },
    },
  });

  const llm = workbench.dropLibraryNode("llm", { x: 100, y: 120 }).node;
  workbench.updateNodeConfig(llm.id, { model: "default", prompt: "{{input}}", output_key: "answer" });

  const result = await workbench.saveDraft({ id: "research-agent", name: "Research Agent", version: "draft" });

  assert.equal(result.status, "saved");
  assert.equal(saved[0].agentId, "research-agent");
  assert.equal(saved[0].manifest.schema_version, "1.0");
  assert.deepEqual(saved[0].manifest.runtime.nodes[0].position, undefined);
  assert.deepEqual(saved[0].manifest.ui.nodes[llm.id].position, { x: 100, y: 120 });
  assert.equal(workbench.view().header.status, "saved");
});

test("T8B Load Draft restores runtime/ui manifest and keeps save round-trip shape", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const draftManifest = {
    schema_version: "1.0",
    template: { id: "research-agent", name: "Research Agent", version: "draft" },
    runtime: {
      state_schema: "default_chat_state",
      nodes: [
        { id: "planner", type: "llm", config: { model: "default", prompt: "{{input}}", output_key: "answer" } },
        { id: "final", type: "output", config: { source: "$state.answer" } },
      ],
      edges: [
        { source: "START", target: "planner" },
        { source: "planner", target: "final" },
        { source: "final", target: "END" },
      ],
    },
    ui: {
      nodes: {
        planner: { position: { x: 100, y: 120 } },
        final: { position: { x: 420, y: 120 } },
      },
      viewport: { x: 10, y: 20, zoom: 0.8 },
    },
  };
  let savedManifest = null;
  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
    apiClient: {
      async fetchAgentDraft(agentId) {
        return { agent_id: agentId, draft_manifest: draftManifest };
      },
      async saveAgentDraft(agentId, manifest) {
        savedManifest = manifest;
        return { status: "saved", agent_id: agentId, manifest };
      },
    },
  });

  const loaded = await workbench.loadDraft("research-agent");
  const view = workbench.view();
  await workbench.saveDraft({ id: "research-agent", name: "Research Agent", version: "draft" });

  assert.equal(loaded.status, "loaded");
  assert.deepEqual(
    view.canvas.nodes.map((node) => [node.id, node.position]),
    [
      ["planner", { x: 100, y: 120 }],
      ["final", { x: 420, y: 120 }],
    ],
  );
  assert.deepEqual(savedManifest.runtime.edges[0], { source: "START", target: "planner" });
  assert.deepEqual(savedManifest.ui.nodes.final.position, { x: 420, y: 120 });
});

test("T8C dirty workflow blocks navigation until save succeeds", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
    apiClient: {
      async validateAgentDraft() {
        return { valid: true };
      },
      async saveAgentDraft(agentId, manifest) {
        return { status: "saved", agent_id: agentId, manifest };
      },
    },
  });

  const llm = workbench.dropLibraryNode("llm", { x: 100, y: 100 }).node;

  const blocked = workbench.requestNavigation("chat");
  await workbench.saveDraft({ id: "research-agent", name: "Research Agent", version: "draft" });
  const allowed = workbench.requestNavigation("chat");

  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, "unsaved_changes");
  assert.deepEqual(
    workbench.serializeManifest().runtime.nodes.map((node) => node.id),
    [llm.id],
  );
  assert.equal(allowed.allowed, true);
});

test("T8D Validate UI maps structured backend node errors to selected config fields", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const validated = [];
  let runtimeNodeId = "";
  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
    apiClient: {
      async validateAgentDraft(agentId, manifest) {
        validated.push({ agentId, manifest });
        runtimeNodeId = manifest.runtime.nodes[0].id;
        return {
          valid: false,
          errors: [
            {
              code: "llm_config.required",
              field: "runtime.nodes[0].config.prompt",
              message: "LLM node config field is required: prompt",
              node_id: runtimeNodeId,
            },
          ],
          warnings: [],
        };
      },
    },
  });

  const llm = workbench.dropLibraryNode("llm", { x: 100, y: 100 }).node;
  workbench.updateNodeConfig(llm.id, { model: "default", output_key: "answer" });
  workbench.selectNode(llm.id);

  const validation = await workbench.validateDraft({ id: "research-agent", name: "Research Agent", version: "draft" });
  const view = workbench.view();
  const promptField = view.nodeConfig.sections
    .flatMap((section) => section.fields)
    .find((field) => field.path === "prompt");

  assert.equal(validated[0].agentId, "research-agent");
  assert.equal(validation.valid, false);
  assert.equal(view.header.actions.publish.enabled, false);
  assert.equal(promptField.error.code, "llm_config.required");
  assert.deepEqual(view.validationPanel.issues[0].target, { kind: "node_config", nodeId: llm.id, path: "prompt" });
});

test("T8E Publish uses agent publish API and displays immutable version metadata", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const published = [];
  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
    apiClient: {
      async validateAgentDraft() {
        return { valid: true, errors: [], warnings: [] };
      },
      async publishAgent(agentId) {
        published.push(agentId);
        return {
          id: `${agentId}_v1`,
          agent_template_id: agentId,
          version: 1,
          checksum: "abc123",
          status: "published",
          published_at: "2026-08-30T00:00:00Z",
        };
      },
    },
  });

  const llm = workbench.dropLibraryNode("llm", { x: 100, y: 100 }).node;
  const output = workbench.dropLibraryNode("output", { x: 300, y: 100 }).node;
  workbench.updateNodeConfig(llm.id, { model: "default", prompt: "{{input}}", output_key: "answer" });
  workbench.updateNodeConfig(output.id, { source: "$state.answer" });
  workbench.connectCanvasEdge("START", llm.id);
  workbench.connectCanvasEdge(llm.id, output.id);
  workbench.connectCanvasEdge(output.id, "END");

  await workbench.validateDraft({ id: "research-agent", name: "Research Agent", version: "draft" });
  const response = await workbench.publishDraft({ id: "research-agent", name: "Research Agent", version: "draft" });
  const view = workbench.view();

  assert.deepEqual(published, ["research-agent"]);
  assert.equal(response.id, "research-agent_v1");
  assert.equal(view.header.publish.version.id, "research-agent_v1");
  assert.equal(view.header.publish.version.checksum, "abc123");
  assert.equal(view.header.actions.publish.status, "published");
  assert.equal(view.header.dirty, false);
});

test("T90 Test Run starts from published AgentVersion and records run status", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const started = [];
  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
    publishedVersion: { id: "research-agent_v1", version: 1, status: "published" },
    apiClient: {
      async startAgentTestRun(agentVersionId, payload) {
        started.push({ agentVersionId, payload });
        return { run_id: "run-1", status: "completed", output: "OK" };
      },
    },
  });

  const result = await workbench.startTestRun({ input: "Hello" });
  const view = workbench.view();

  assert.deepEqual(started, [{ agentVersionId: "research-agent_v1", payload: { input: "Hello" } }]);
  assert.equal(result.run_id, "run-1");
  assert.equal(view.testRun.status, "completed");
  assert.equal(view.testRun.runId, "run-1");
  assert.equal(view.testRun.output, "OK");
});

test("T90 Workflow node config schemas expose executable business fields", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
  });

  const llm = workbench.dropLibraryNode("llm", { x: 100, y: 100 }).node;
  workbench.selectNode(llm.id);
  const llmFields = workbench.view().nodeConfig.sections.flatMap((section) => section.fields.map((field) => field.path));

  const prompt = workbench.dropLibraryNode("prompt", { x: 240, y: 100 }).node;
  workbench.selectNode(prompt.id);
  const promptFields = workbench.view().nodeConfig.sections.flatMap((section) => section.fields.map((field) => field.path));

  const condition = workbench.dropLibraryNode("condition", { x: 380, y: 100 }).node;
  workbench.selectNode(condition.id);
  const conditionFields = workbench.view().nodeConfig.sections.flatMap((section) => section.fields.map((field) => field.path));

  assert.ok(llmFields.includes("provider"));
  assert.ok(llmFields.includes("max_tokens"));
  assert.ok(promptFields.includes("role"));
  assert.ok(promptFields.includes("variables"));
  assert.ok(conditionFields.includes("state_key"));
});

test("T90 Tool catalog loads registered tool metadata for Tool node config", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
    apiClient: {
      async listTools() {
        return {
          tools: [
            {
              id: "context.echo",
              name: "Context Echo",
              description: "Echoes query",
              input_schema: { type: "object", required: ["query"] },
              output_schema: { type: "object" },
              configurable: false,
            },
          ],
        };
      },
    },
  });

  const loaded = await workbench.loadToolCatalog();
  const tool = workbench.dropLibraryNode("tool", { x: 100, y: 100 }).node;
  workbench.selectNode(tool.id);
  const toolField = workbench.view().nodeConfig.sections.flatMap((section) => section.fields).find((field) => field.path === "tool_name");

  assert.equal(loaded.tools[0].id, "context.echo");
  assert.deepEqual(toolField.options, [{ value: "context.echo", label: "Context Echo" }]);
  assert.equal(toolField.metadata.description, "Echoes query");
  assert.deepEqual(toolField.metadata.input_schema, { type: "object", required: ["query"] });
});

test("T90 Use Agent creates a formal session bound to the published workflow version", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const created = [];
  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
    publishedVersion: { id: "research-agent_v1", version: 1, status: "published" },
    apiClient: {
      async createSessionForWorkflow(payload) {
        created.push(payload);
        return { id: "session-1", current_timeline_id: "timeline-1", agent_version_id: payload.agent_version_id };
      },
    },
  });

  const result = await workbench.useAgent({ id: "research-agent", name: "Research Agent", version: "draft" });

  assert.deepEqual(created, [
    {
      agent_template_id: "research-agent",
      agent_version_id: "research-agent_v1",
      title: "Research Agent",
      workspace_id: "studio",
      metadata: { source: "workflow-builder" },
    },
  ]);
  assert.deepEqual(result.navigation, { route: "/chat", sessionId: "session-1", timelineId: "timeline-1" });
});

test("T90 Test Run failure exposes error without clearing published version", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
    publishedVersion: { id: "research-agent_v1", version: 1, status: "published" },
    apiClient: {
      async startAgentTestRun() {
        throw new Error("runtime failed");
      },
    },
  });

  const result = await workbench.startTestRun({ input: "Hello" });
  const view = workbench.view();

  assert.equal(result.status, "failed");
  assert.equal(view.testRun.status, "failed");
  assert.equal(view.testRun.error.message, "runtime failed");
  assert.equal(view.header.publish.version.id, "research-agent_v1");
});

test("T91 runtime node events highlight canvas nodes without mutating manifest", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
  });

  const llm = workbench.dropLibraryNode("llm", { x: 100, y: 100 }).node;
  const before = workbench.serializeManifest();

  workbench.applyTestRunEvent({ type: "node_started", data: { node_id: llm.id } });
  const running = workbench.view().canvas.nodes.find((node) => node.id === llm.id);
  workbench.applyTestRunEvent({ type: "node_finished", data: { node_id: llm.id } });
  const finished = workbench.view().canvas.nodes.find((node) => node.id === llm.id);

  assert.equal(running.runtimeStatus, "running");
  assert.equal(finished.runtimeStatus, "success");
  assert.deepEqual(workbench.serializeManifest(), before);
});

test("T91 a new test run clears old runtime node highlights", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
    publishedVersion: { id: "research-agent_v1", version: 1, status: "published" },
    apiClient: {
      async startAgentTestRun() {
        return { run_id: "run-2", status: "running" };
      },
    },
  });

  const llm = workbench.dropLibraryNode("llm", { x: 100, y: 100 }).node;
  workbench.applyTestRunEvent({ type: "node_failed", data: { node_id: llm.id, error: "boom" } });
  await workbench.startTestRun({ input: "again" });

  assert.equal(workbench.view().canvas.nodes.find((node) => node.id === llm.id).runtimeStatus, undefined);
});

test("T92 runtime inspector shows events for the selected runtime node", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
  });

  const tool = workbench.dropLibraryNode("tool", { x: 100, y: 100 }).node;
  workbench.applyTestRunEvent({ type: "node_started", data: { node_id: tool.id, input: { query: "hello" } } });
  workbench.applyTestRunEvent({ type: "tool_call", data: { node_id: tool.id, tool_name: "fake_read", args: { id: "doc-1" } } });
  workbench.applyTestRunEvent({ type: "tool_result", data: { node_id: tool.id, result: { text: "OK" } } });
  workbench.applyTestRunEvent({ type: "node_finished", data: { node_id: tool.id, output: { text: "OK" } } });

  const inspector = workbench.inspectRuntimeNode(tool.id);

  assert.equal(inspector.selectedNodeId, tool.id);
  assert.deepEqual(
    inspector.events.map((event) => event.type),
    ["node_started", "tool_call", "tool_result", "node_finished"],
  );
  assert.deepEqual(inspector.latestOutput, { text: "OK" });
  assert.deepEqual(workbench.view().runtimeInspector.events, inspector.events);
});

test("T93 Builder Publish TestRun vertical slice updates canvas and inspector from stream", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  let savedManifest = null;
  let plannerNodeId = null;
  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
    apiClient: {
      async saveAgentDraft(agentId, manifest) {
        savedManifest = manifest;
        return { status: "saved", agent_id: agentId, manifest };
      },
      async fetchAgentDraft(agentId) {
        return { agent_id: agentId, draft_manifest: savedManifest };
      },
      async validateAgentDraft() {
        return { valid: true, errors: [], warnings: [] };
      },
      async publishAgent(agentId) {
        return { id: `${agentId}_v1`, agent_template_id: agentId, version: 1, checksum: "abc123", status: "published" };
      },
      async startAgentTestRun() {
        return { run_id: "run-1", status: "running" };
      },
      async *streamAgentTestRunEvents() {
        yield { type: "node_started", data: { node_id: plannerNodeId, input: { input: "Hello" } } };
        yield { type: "node_finished", data: { node_id: plannerNodeId, output: { answer: "OK" } } };
        yield { type: "graph_finished", data: { output: "OK" } };
      },
    },
  });

  const llm = workbench.dropLibraryNode("llm", { x: 100, y: 120 }).node;
  plannerNodeId = llm.id;
  const output = workbench.dropLibraryNode("output", { x: 420, y: 120 }).node;
  workbench.updateNodeConfig(llm.id, { model: "default", prompt: "{{input}}", output_key: "answer" });
  workbench.updateNodeConfig(output.id, { source: "$state.answer" });
  workbench.connectCanvasEdge("START", llm.id);
  workbench.connectCanvasEdge(llm.id, output.id);
  workbench.connectCanvasEdge(output.id, "END");
  await workbench.saveDraft({ id: "research-agent", name: "Research Agent", version: "draft" });
  await workbench.loadDraft("research-agent");
  await workbench.validateDraft({ id: "research-agent", name: "Research Agent", version: "draft" });
  await workbench.publishDraft({ id: "research-agent", name: "Research Agent", version: "draft" });

  const run = await workbench.startAndStreamTestRun({ input: "Hello" });
  const planner = workbench.view().canvas.nodes.find((node) => node.id === plannerNodeId);
  const inspector = workbench.inspectRuntimeNode(plannerNodeId);

  assert.equal(run.status, "completed");
  assert.equal(planner.runtimeStatus, "success");
  assert.deepEqual(inspector.latestOutput, { answer: "OK" });
  assert.equal(workbench.view().testRun.output, "OK");
});

test("T93 Test Run trace keeps graph and node events in order", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
    publishedVersion: { id: "research-agent_v1", version: 1, status: "published" },
    apiClient: {
      async startAgentTestRun() {
        return { run_id: "run-1", status: "running" };
      },
      async *streamAgentTestRunEvents() {
        yield { type: "graph_started", data: { trace_id: "trace-1" } };
        yield { type: "node_started", data: { node_id: "planner", input: { input: "Hello" } } };
        yield { type: "condition_route", data: { node_id: "branch", route: "true" } };
        yield { type: "graph_finished", data: { trace_id: "trace-1", output: "OK" } };
      },
    },
  });

  await workbench.startAndStreamTestRun({ input: "Hello" });

  assert.deepEqual(
    workbench.view().testRun.trace.map((event) => event.type),
    ["graph_started", "node_started", "condition_route", "graph_finished"],
  );
  assert.equal(workbench.view().testRun.trace[2].data.route, "true");
});
