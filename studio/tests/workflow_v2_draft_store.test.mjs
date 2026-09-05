import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\tests$/, "");

function moduleUrl(relativePath) {
  return pathToFileURL(join(studioRoot, relativePath)).href;
}

test("T01 V2 draft store opens, edits, autosaves, and refreshes revision", async () => {
  const { createWorkflowV2DraftStore } = await import(moduleUrl("src/features/workflow-v2/WorkflowV2DraftStore.js"));
  const savedBodies = [];
  const apiClient = {
    async fetchWorkflow(workflowId) {
      assert.equal(workflowId, "support-flow");
      return {
        id: "support-flow",
        name: "Support Flow",
        schemaVersion: 2,
        revision: 1,
        nodes: [],
        edges: [],
      };
    },
    async saveWorkflowDraft(workflowId, definition) {
      savedBodies.push({ workflowId, definition });
      return { ...definition, revision: 2 };
    },
  };

  const store = createWorkflowV2DraftStore(apiClient, { debounceMs: 5 });
  await store.open("support-flow");
  store.updateDraft({ nodes: [{ id: "agent-1", type: "agent" }] });

  assert.equal(store.view().dirty, true);
  assert.equal(savedBodies.length, 0);

  await store.flushAutosave();

  assert.equal(store.view().dirty, false);
  assert.equal(store.view().revision, 2);
  assert.deepEqual(savedBodies[0], {
    workflowId: "support-flow",
    definition: {
      id: "support-flow",
      name: "Support Flow",
      schemaVersion: 2,
      revision: 1,
      nodes: [{ id: "agent-1", type: "agent" }],
      edges: [],
    },
  });
});
