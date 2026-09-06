import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\tests$/, "");

function moduleUrl(relativePath) {
  return pathToFileURL(join(studioRoot, relativePath)).href;
}

test("T00 routes legacy workflows to the existing editor and schemaVersion 2 to the Agent Workflow editor", async () => {
  const { workflowEditorKindForDefinition } = await import(moduleUrl("src/pages/Workflow/index.js"));

  assert.equal(workflowEditorKindForDefinition({ id: "legacy" }), "legacy");
  assert.equal(workflowEditorKindForDefinition({ id: "v2", schemaVersion: 2 }), "agent-workflow-v2");
});

test("T00 V2 node library exposes only Agent control-flow node types", async () => {
  const { createWorkflowV2Builder } = await import(moduleUrl("src/features/workflow-v2/WorkflowV2Builder.js"));

  const builder = createWorkflowV2Builder();

  assert.deepEqual(builder.nodeLibrary().map((node) => node.type), ["agent", "condition", "workflow", "end"]);
  assert.equal(builder.nodeLibrary().some((node) => ["prompt", "llm", "tool"].includes(node.type)), false);
  assert.throws(() => builder.addNode({ id: "llm-1", type: "llm" }), /Unsupported V2 workflow node type/);
});

test("T19 legacy workflows expose a manual V2 copy entry without converting legacy semantics", async () => {
  const { createWorkflowPage } = await import(moduleUrl("src/pages/Workflow/index.js"));
  const createdDefinitions = [];
  const legacyDefinition = {
    id: "legacy-support",
    name: "Legacy Support",
    schema_version: "1.0",
    runtime: {
      nodes: [
        { id: "prompt-1", type: "prompt" },
        { id: "llm-1", type: "llm" },
      ],
    },
    $state: { dirty: true },
  };

  const page = await createWorkflowPage(
    {
      async createWorkflow(definition) {
        createdDefinitions.push(definition);
        return { id: definition.id, definition };
      },
    },
    { workflowDefinition: legacyDefinition, initialManifest: legacyDefinition },
  );

  const view = page.view();
  assert.equal(view.legacy.status, "legacy");
  assert.deepEqual(view.legacy.actions.map((action) => action.id), ["create-v2-copy"]);

  const result = await page.createV2Copy();

  assert.equal(result.definition.schemaVersion, 2);
  assert.equal(result.definition.id, "legacy-support-v2-copy");
  assert.deepEqual(result.definition.nodes, []);
  assert.deepEqual(result.definition.edges, []);
  assert.equal(result.definition.migration.strategy, "manual-rebuild");
  assert.equal(JSON.stringify(createdDefinitions[0]).includes("$state"), false);
});

test("T19 new workflow creation defaults to Agent Workflow V2", async () => {
  const { createNewWorkflowDefinition, workflowEditorKindForDefinition } = await import(
    moduleUrl("src/pages/Workflow/index.js")
  );

  const definition = createNewWorkflowDefinition({ id: "new-agent-flow", name: "New Agent Flow" });

  assert.equal(definition.schemaVersion, 2);
  assert.equal(workflowEditorKindForDefinition(definition), "agent-workflow-v2");
  assert.deepEqual(definition.nodes, []);
  assert.deepEqual(definition.edges, []);
});

test("T20 starter Agent Workflow V2 definition is immediately publishable", async () => {
  const { createStarterWorkflowV2Definition } = await import(moduleUrl("src/pages/Workflow/index.js"));
  const { createWorkflowV2Workbench } = await import(moduleUrl("src/pages/Workflow/WorkflowV2Workbench.js"));

  const definition = createStarterWorkflowV2Definition({ id: "agent-workflow-v2-draft", name: "Agent Workflow V2 Draft" });
  const workbench = createWorkflowV2Workbench({ workflowDefinition: definition });

  assert.equal(definition.schemaVersion, 2);
  assert.deepEqual(definition.nodes.map((node) => node.type), ["agent", "end"]);
  assert.equal(definition.nodes[0].config.instruction, "Answer the user's request clearly using the provided workflow input.");
  assert.deepEqual(definition.nodes[0].config.outputSchema, {
    type: "object",
    required: ["summary"],
    properties: { summary: { type: "string" } },
  });
  assert.deepEqual(definition.edges, [
    { source: "START", target: "agent-1" },
    { source: "agent-1", target: "end-1" },
  ]);
  assert.equal(workbench.validate().valid, true);
});
