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

  workbench.addNode({ id: "agent", type: "agent", config: { model: "default" } });
  workbench.addNode({ id: "tool", type: "tool", config: { tool_id: "search" } });
  workbench.selectNode("agent");
  workbench.updateNodeConfigDraft({ model: "fast-model" });
  workbench.selectNode("tool");
  workbench.selectNode("agent");

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

  workbench.addNode({ id: "agent", type: "agent", config: { model: "default" } });
  assert.equal(workbench.view().header.status, "dirty");

  const result = await workbench.save({ id: "research-agent", name: "Research Agent", version: "1.0.0" });

  const view = workbench.view();
  assert.equal(result.status, "saved");
  assert.deepEqual(savedTemplates, ["research-agent"]);
  assert.equal(view.header.status, "saved");
  assert.equal(view.header.actions.save.enabled, false);
  assert.equal(view.refreshProtection.enabled, false);
});

test("UI05-T02-TC01: searching Context only shows related library nodes", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
  });

  workbench.searchNodeLibrary("Context");

  const matches = workbench.view().nodeLibrary.items;
  assert.deepEqual(matches.map((node) => node.type), ["context_operator"]);
  assert.equal(matches[0].category, "Context");
  assert.match(matches[0].label, /Context Operator/);
});

test("UI05-T02-TC02: dropping library nodes creates unique manifest node ids at stable positions", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
  });

  const first = workbench.dropLibraryNode("agent", { x: 120, y: 160 });
  const second = workbench.dropLibraryNode("agent", { x: 180, y: 220 });
  const manifest = workbench.serializeManifest();

  assert.notEqual(first.node.id, second.node.id);
  assert.deepEqual(manifest.graph.nodes.map((node) => node.id), [first.node.id, second.node.id]);
  assert.deepEqual(workbench.view().canvas.nodes.map((node) => node.position), [
    { x: 120, y: 160 },
    { x: 180, y: 220 },
  ]);
  assert.equal(first.preview.dropPosition.x, 120);
});

test("UI05-T02-TC03: unsupported validator node types cannot be created from the library", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
    manifestSchema: {
      supportedNodeTypes: ["agent", "tool"],
    },
  });

  assert.deepEqual(
    workbench.view().nodeLibrary.items.map((node) => node.type),
    ["agent", "tool"],
  );
  assert.throws(
    () => workbench.dropLibraryNode("context_operator", { x: 0, y: 0 }),
    /not supported by the active workflow schema/i,
  );
  assert.deepEqual(workbench.serializeManifest().graph.nodes, []);
});

test("UI05-T03-TC01: Backspace in a focused prompt input does not delete selected canvas nodes", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
  });

  const dropped = workbench.dropLibraryNode("prompt", { x: 100, y: 100 });
  workbench.selectNode(dropped.node.id);

  const result = workbench.handleCanvasKeyDown({
    key: "Backspace",
    targetRole: "input",
  });

  assert.equal(result.handled, false);
  assert.deepEqual(
    workbench.serializeManifest().graph.nodes.map((node) => node.id),
    [dropped.node.id],
  );
});

test("UI05-T03-TC02: fit view frames the complete workflow graph", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
  });

  workbench.dropLibraryNode("agent", { x: 100, y: 120 });
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

test("UI05-T03-TC03: deleting a selected node removes connected edges from the draft manifest", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
  });

  const agent = workbench.dropLibraryNode("agent", { x: 100, y: 100 }).node;
  const tool = workbench.dropLibraryNode("tool", { x: 300, y: 100 }).node;
  const output = workbench.dropLibraryNode("output", { x: 500, y: 100 }).node;
  workbench.connect(agent.id, tool.id);
  workbench.connect(tool.id, output.id);
  workbench.selectNode(tool.id);

  const result = workbench.handleCanvasKeyDown({ key: "Delete", targetRole: "canvas" });
  const manifest = workbench.serializeManifest();

  assert.equal(result.handled, true);
  assert.deepEqual(
    manifest.graph.nodes.map((node) => node.id),
    [agent.id, output.id],
  );
  assert.deepEqual(manifest.graph.edges, []);
  assert.equal(workbench.view().nodeConfig.selectedNodeId, null);
});

test("UI05-T04-TC01: Condition Yes/No edge labels serialize stably", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
  });

  const condition = workbench.dropLibraryNode("condition", { x: 100, y: 100 }).node;
  const tool = workbench.dropLibraryNode("tool", { x: 300, y: 40 }).node;
  const output = workbench.dropLibraryNode("output", { x: 300, y: 180 }).node;

  workbench.connectCanvasEdge(condition.id, tool.id, { branch: "yes" });
  workbench.connectCanvasEdge(condition.id, output.id, { branch: "no" });

  const manifest = workbench.serializeManifest();
  assert.deepEqual(manifest.graph.edges, [
    { from: condition.id, to: tool.id, condition: "yes" },
    { from: condition.id, to: output.id, condition: "no" },
  ]);
  assert.deepEqual(
    workbench.view().canvas.edges.map((edge) => edge.label),
    ["Yes", "No"],
  );
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
          error: { field_path: "graph.edges[0]", code: "invalid_edge", message: "Router branch is unsupported" },
        };
      },
    },
  });

  const router = workbench.dropLibraryNode("router", { x: 100, y: 100 }).node;
  const tool = workbench.dropLibraryNode("tool", { x: 300, y: 100 }).node;
  workbench.connectCanvasEdge(router.id, tool.id, { branch: "maybe" });

  const validation = await workbench.validateWithBackend();
  const view = workbench.view();

  assert.equal(validation.valid, false);
  assert.equal(view.canvas.edges[0].status, "invalid");
  assert.equal(view.canvas.edges[0].error.code, "invalid_edge");
  assert.deepEqual(view.validationPanel.issues, [
    {
      fieldPath: "graph.edges[0]",
      code: "invalid_edge",
      message: "Router branch is unsupported",
      target: { kind: "edge", index: 0, from: router.id, to: tool.id },
    },
  ]);
});

test("UI05-T04-TC03: deleting an edge keeps both endpoint nodes", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
  });

  const agent = workbench.dropLibraryNode("agent", { x: 100, y: 100 }).node;
  const output = workbench.dropLibraryNode("output", { x: 300, y: 100 }).node;
  const edge = workbench.connectCanvasEdge(agent.id, output.id);

  workbench.deleteCanvasEdge(edge.edge.id);

  const manifest = workbench.serializeManifest();
  assert.deepEqual(
    manifest.graph.nodes.map((node) => node.id),
    [agent.id, output.id],
  );
  assert.deepEqual(manifest.graph.edges, []);
});

test("UI05-T05-TC01: Agent node config shows model tool context retry and checkpoint sections", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
  });

  const agent = workbench.dropLibraryNode("agent", { x: 100, y: 100 }).node;
  workbench.selectNode(agent.id);

  const config = workbench.view().nodeConfig;

  assert.equal(config.schemaDriven, true);
  assert.deepEqual(
    config.sections.map((section) => section.id),
    ["model", "tool_bindings", "context_policy", "retry", "checkpoint"],
  );
  assert.deepEqual(
    config.sections.flatMap((section) => section.fields.map((field) => field.path)),
    ["model", "tools", "context.policy", "retry.max_attempts", "checkpoint.enabled"],
  );
});

test("UI05-T05-TC02: Tool node config omits Agent-only fields", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
  });

  const tool = workbench.dropLibraryNode("tool", { x: 100, y: 100 }).node;
  workbench.selectNode(tool.id);

  const paths = workbench.view().nodeConfig.sections.flatMap((section) => section.fields.map((field) => field.path));

  assert.deepEqual(paths, ["tool_id", "args_schema", "retry.max_attempts"]);
  assert.ok(!paths.includes("model"));
  assert.ok(!paths.includes("checkpoint.enabled"));
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
            field_path: "graph.nodes[0].config.model",
            code: "required",
            message: "Model is required",
          },
        };
      },
    },
  });

  const agent = workbench.dropLibraryNode("agent", { x: 100, y: 100 }).node;
  workbench.selectNode(agent.id);

  const local = workbench.validateSelectedNodeConfig();
  const backend = await workbench.validateWithBackend();
  const field = workbench.view().nodeConfig.sections[0].fields[0];

  assert.equal(local.valid, false);
  assert.equal(backend.valid, false);
  assert.deepEqual(field.error, {
    fieldPath: "graph.nodes[0].config.model",
    code: "required",
    message: "Model is required",
  });
  assert.deepEqual(workbench.view().nodeConfig.validation, {
    valid: false,
    errors: [
      {
        sectionId: "model",
        fieldPath: "graph.nodes[0].config.model",
        code: "required",
        message: "Model is required",
      },
    ],
  });
});

test("UI05-T06-TC01: collapsing and expanding SubGraph keeps serialized manifest identical", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
  });

  const subgraph = workbench.dropLibraryNode("subgraph", { x: 80, y: 80 }).node;
  const agent = workbench.dropLibraryNode("agent", { x: 160, y: 140 }).node;
  workbench.updateNodeConfig(subgraph.id, { internal_node_ids: [agent.id] });
  const before = workbench.serializeManifest();

  workbench.toggleSubGraphCollapse(subgraph.id);
  const collapsed = workbench.serializeManifest();
  workbench.toggleSubGraphCollapse(subgraph.id);
  const expanded = workbench.serializeManifest();

  assert.deepEqual(collapsed, before);
  assert.deepEqual(expanded, before);
  assert.equal(workbench.view().canvas.nodes.find((node) => node.id === subgraph.id).collapsed, false);
});

test("UI05-T06-TC02: collapsed SubGraph shows outer hint for internal validation errors", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
    apiClient: {
      async validateTemplate() {
        return {
          valid: false,
          error: {
            field_path: "graph.nodes[1].config.model",
            code: "required",
            message: "Internal agent model is required",
          },
        };
      },
    },
  });

  const subgraph = workbench.dropLibraryNode("subgraph", { x: 80, y: 80 }).node;
  const agent = workbench.dropLibraryNode("agent", { x: 160, y: 140 }).node;
  workbench.updateNodeConfig(subgraph.id, { internal_node_ids: [agent.id] });
  workbench.toggleSubGraphCollapse(subgraph.id);

  await workbench.validateWithBackend();
  const subgraphNode = workbench.view().canvas.nodes.find((node) => node.id === subgraph.id);

  assert.equal(subgraphNode.collapsed, true);
  assert.deepEqual(subgraphNode.validationHint, {
    kind: "subgraph_internal_validation",
    severity: "error",
    internalNodeIds: [agent.id],
    issueCount: 1,
  });
});

test("UI05-T06-TC03: selecting SubGraph shows its container config in the right panel", async () => {
  const { createWorkflowWorkbench } = await import(moduleUrl("src/pages/Workflow/WorkflowWorkbench.js"));

  const workbench = createWorkflowWorkbench({
    platform: createMemoryPlatform(),
    viewportWidth: 1280,
  });

  const subgraph = workbench.dropLibraryNode("subgraph", { x: 80, y: 80 }).node;
  workbench.updateNodeConfig(subgraph.id, { label: "Research Flow", internal_node_ids: ["agent-1"] });
  workbench.selectNode(subgraph.id);

  const view = workbench.view();

  assert.equal(view.canvas.nodes.find((node) => node.id === subgraph.id).visualRole, "subgraph-container");
  assert.deepEqual(
    view.nodeConfig.sections.map((section) => section.id),
    ["subgraph"],
  );
  assert.deepEqual(
    view.nodeConfig.sections[0].fields.map((field) => field.path),
    ["label", "internal_node_ids"],
  );
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

  workbench.dropLibraryNode("agent", { x: 100, y: 100 });

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

  workbench.dropLibraryNode("agent", { x: 100, y: 100 });

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

  const agent = workbench.dropLibraryNode("agent", { x: 100, y: 100 }).node;
  workbench.selectNode(agent.id);
  const saved = await workbench.saveDraft({ id: "research-agent", name: "Research Agent", version: "1.0.1" });
  const view = workbench.view();

  assert.equal(saved.status, "failed");
  assert.equal(view.header.status, "error");
  assert.equal(view.header.dirty, true);
  assert.equal(view.refreshProtection.enabled, true);
  assert.equal(view.nodeConfig.selectedNodeId, agent.id);
  assert.equal(view.header.actions.save.enabled, true);
});
