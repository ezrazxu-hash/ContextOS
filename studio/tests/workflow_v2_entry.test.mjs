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
