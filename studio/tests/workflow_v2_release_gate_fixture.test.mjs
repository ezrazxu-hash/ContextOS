import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\tests$/, "");

function moduleUrl(relativePath) {
  return pathToFileURL(join(studioRoot, relativePath)).href;
}

test("T18 V2 release gate fixture opens without legacy nodes or state paths", async () => {
  const { createWorkflowV2Workbench } = await import(moduleUrl("src/pages/Workflow/WorkflowV2Workbench.js"));
  const { releaseGateWorkflowV2Definition, technicalResearchWorkflowV2Definition } = await import(moduleUrl("src/test/fixtures/workflowV2ReleaseGate.js"));
  const child = technicalResearchWorkflowV2Definition();
  const workbench = createWorkflowV2Workbench({
    workflowCatalog: [{
      id: child.id,
      name: child.name,
      versions: [{ version: 1 }],
      inputSchema: child.inputSchema,
      outputSchema: child.outputSchema,
    }],
    workflowDefinition: releaseGateWorkflowV2Definition({ technicalWorkflowId: child.id, technicalWorkflowVersion: 1 }),
  });

  const view = workbench.view();

  assert.deepEqual(view.nodeLibrary.items.map((node) => node.type), ["agent", "condition", "workflow", "end"]);
  assert.equal(view.editorMode, "simple");
  assert.deepEqual(view.canvas.nodes.map((node) => node.type), ["agent", "condition", "workflow", "agent", "agent", "agent", "end"]);
  assert.equal(view.canvas.nodes.find((node) => node.id === "technical-research").card.summary.workflowId, "technical-research-flow");
  assert.equal(JSON.stringify(view).includes("$state"), false);
  assert.equal(JSON.stringify(view).includes("PromptNode"), false);
  assert.equal(JSON.stringify(view).includes("LlmNode"), false);
  assert.equal(JSON.stringify(view).includes("ToolNode"), false);
});
