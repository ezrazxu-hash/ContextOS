import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\tests$/, "");

function moduleUrl(relativePath) {
  return pathToFileURL(join(studioRoot, relativePath)).href;
}

test("T05 V2 tool policy editor loads workflow tool catalog", async () => {
  const { createWorkflowV2ToolPolicyEditor } = await import(moduleUrl("src/features/workflow-v2/WorkflowV2ToolPolicyEditor.js"));
  const editor = createWorkflowV2ToolPolicyEditor({
    apiClient: {
      async listWorkflowTools() {
        return {
          tools: [
            { id: "knowledge.base", name: "Knowledge Base", inputSchema: { type: "object" }, outputSchema: { type: "object" } },
            { id: "search.web", name: "Web Search", inputSchema: { type: "object" }, outputSchema: { type: "object" } },
          ],
        };
      },
    },
  });

  await editor.loadCatalog();

  assert.deepEqual(editor.view().catalog.items.map((tool) => [tool.id, tool.name]), [
    ["knowledge.base", "Knowledge Base"],
    ["search.web", "Web Search"],
  ]);
});

test("T05 V2 tool policy editor supports auto and required tool policy validation", async () => {
  const { createWorkflowV2ToolPolicyEditor } = await import(moduleUrl("src/features/workflow-v2/WorkflowV2ToolPolicyEditor.js"));
  const editor = createWorkflowV2ToolPolicyEditor({
    catalog: [{ id: "search.web", name: "Web Search" }, { id: "knowledge.base", name: "Knowledge Base" }],
    workflowTools: ["search.web", "knowledge.base"],
  });

  editor.setMode("auto");
  editor.toggleAllowedTool("search.web", true);
  editor.toggleAllowedTool("knowledge.base", true);

  assert.deepEqual(editor.view().policy, {
    mode: "auto",
    allowedTools: ["search.web", "knowledge.base"],
    requiredTools: [],
  });
  assert.equal(editor.validate().valid, true);

  editor.setMode("required");
  editor.toggleRequiredTool("missing.search", true);

  const validation = editor.validate();
  assert.equal(validation.valid, false);
  assert.deepEqual(validation.errors.map((error) => [error.field, error.code]), [
    ["toolPolicy.requiredTools[0]", "required_tool_not_allowed"],
    ["toolPolicy.requiredTools[0]", "node_tool_not_in_workflow_registry"],
    ["toolPolicy.requiredTools[0]", "unknown_agent_tool"],
  ]);
});

test("T05 V2 tool policy editor clears and blocks selections when disabled", async () => {
  const { createWorkflowV2ToolPolicyEditor } = await import(moduleUrl("src/features/workflow-v2/WorkflowV2ToolPolicyEditor.js"));
  const editor = createWorkflowV2ToolPolicyEditor({
    catalog: [{ id: "search.web", name: "Web Search" }],
    workflowTools: ["search.web"],
    policy: { mode: "auto", allowedTools: ["search.web"], requiredTools: ["search.web"] },
  });

  editor.setMode("disabled");

  assert.deepEqual(editor.view().policy, { mode: "disabled", allowedTools: [], requiredTools: [] });
  assert.throws(() => editor.toggleAllowedTool("search.web", true), /disabled/);
  assert.throws(() => editor.toggleRequiredTool("search.web", true), /disabled/);
});

test("T05 V2 tool policy editor flags node policy after workflow tool removal", async () => {
  const { createWorkflowV2ToolPolicyEditor } = await import(moduleUrl("src/features/workflow-v2/WorkflowV2ToolPolicyEditor.js"));
  const editor = createWorkflowV2ToolPolicyEditor({
    catalog: [{ id: "search.web", name: "Web Search" }, { id: "knowledge.base", name: "Knowledge Base" }],
    workflowTools: ["search.web", "knowledge.base"],
    policy: { mode: "required", allowedTools: ["search.web"], requiredTools: ["search.web"] },
  });

  editor.setWorkflowTools(["knowledge.base"]);

  const validation = editor.validate();
  assert.equal(validation.valid, false);
  assert.deepEqual(validation.errors.map((error) => [error.field, error.code]), [
    ["toolPolicy.allowedTools[0]", "node_tool_not_in_workflow_registry"],
    ["toolPolicy.requiredTools[0]", "node_tool_not_in_workflow_registry"],
  ]);
});
