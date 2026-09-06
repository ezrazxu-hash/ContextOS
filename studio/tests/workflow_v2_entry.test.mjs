import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\tests$/, "");

function moduleUrl(relativePath) {
  return pathToFileURL(join(studioRoot, relativePath)).href;
}

test("T20 routes every workflow definition to the Agent Workflow V2 editor", async () => {
  const { createWorkflowPage, workflowEditorKindForDefinition } = await import(moduleUrl("src/pages/Workflow/index.js"));

  assert.equal(workflowEditorKindForDefinition({ id: "legacy" }), "agent-workflow-v2");
  assert.equal(workflowEditorKindForDefinition({ id: "legacy", schemaVersion: 1 }), "agent-workflow-v2");
  assert.equal(workflowEditorKindForDefinition({ id: "v2", schemaVersion: 2 }), "agent-workflow-v2");

  const page = await createWorkflowPage({}, { workflowDefinition: { id: "legacy", schemaVersion: 1 } });
  assert.equal(page.view().kind, "agent-workflow-v2-workbench");
});

test("T00 V2 node library exposes only Agent control-flow node types", async () => {
  const { createWorkflowV2Builder } = await import(moduleUrl("src/features/workflow-v2/WorkflowV2Builder.js"));

  const builder = createWorkflowV2Builder();

  assert.deepEqual(builder.nodeLibrary().map((node) => node.type), ["agent", "condition", "workflow", "end"]);
  assert.equal(builder.nodeLibrary().some((node) => ["prompt", "llm", "tool"].includes(node.type)), false);
  assert.throws(() => builder.addNode({ id: "llm-1", type: "llm" }), /Unsupported V2 workflow node type/);
});

test("T20 Workflow page no longer exports Legacy migration helpers", async () => {
  const module = await import(moduleUrl("src/pages/Workflow/index.js"));

  assert.equal("createV2CopyFromLegacyDefinition" in module, false);
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
  assert.deepEqual(definition.nodes.map((node) => `${node.id}:${node.type}`), [
    "analyze-request:agent",
    "route-category:condition",
    "technical-answer:agent",
    "business-answer:agent",
    "general-answer:agent",
    "generate-final:agent",
    "end-1:end",
  ]);
  assert.deepEqual(definition.tools, ["context.echo"]);
  assert.equal(definition.nodes[0].config.name, "Analyze Request");
  assert.equal(definition.nodes[0].config.toolPolicy.mode, "auto");
  assert.deepEqual(definition.nodes[0].config.toolPolicy.allowedTools, ["context.echo"]);
  assert.deepEqual(definition.nodes[0].config.outputSchema, {
    type: "object",
    required: ["category", "topic", "confidence", "summary"],
    properties: {
      category: { type: "string", enum: ["technical", "business", "general"] },
      topic: { type: "string" },
      confidence: { type: "number" },
      summary: { type: "string" },
    },
  });
  assert.deepEqual(definition.nodes.find((node) => node.id === "generate-final").config.outputSchema, {
    type: "object",
    required: ["summary", "category"],
    properties: { summary: { type: "string" }, category: { type: "string" } },
  });
  assert.deepEqual(definition.edges, [
    { source: "START", target: "analyze-request" },
    { source: "analyze-request", target: "route-category" },
    { source: "route-category", target: "technical-answer", sourceHandle: "technical" },
    { source: "route-category", target: "business-answer", sourceHandle: "business" },
    { source: "route-category", target: "general-answer", sourceHandle: "default" },
    { source: "technical-answer", target: "generate-final" },
    { source: "business-answer", target: "generate-final" },
    { source: "general-answer", target: "generate-final" },
    { source: "generate-final", target: "end-1" },
  ]);
  assert.equal(workbench.validate().valid, true);
});
