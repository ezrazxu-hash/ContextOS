import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\tests$/, "");

function moduleUrl(relativePath) {
  return pathToFileURL(join(studioRoot, relativePath)).href;
}

test("saving edit marks message as user modified and shows impact", async () => {
  const { createMessageEditor } = await import(moduleUrl("src/features/message-editor/MessageEditor.js"));

  const apiClient = {
    async patchMessage(messageId, payload) {
      assert.equal(messageId, "message-1");
      assert.equal(payload.new_content, "edited");
      return {
        revision_id: "revision-1",
        impact: { triggered: true, checks: ["state_dependency"], requires_replay: false },
      };
    },
  };
  const editor = createMessageEditor(apiClient, { id: "message-1", content: "original" });

  editor.setDraft("edited");
  const view = await editor.save();

  assert.equal(view.badge, "User Modified");
  assert.equal(view.revisionId, "revision-1");
  assert.deepEqual(view.impact.checks, ["state_dependency"]);
});

test("continue action switches to returned timeline", async () => {
  const { createMessageEditor } = await import(moduleUrl("src/features/message-editor/MessageEditor.js"));

  const calls = [];
  const apiClient = {
    async patchMessage() {
      return { revision_id: "revision-1", impact: { triggered: true, checks: [], requires_replay: false } };
    },
    async continueFromMessage(messageId, revisionId) {
      calls.push(["continue", messageId, revisionId]);
      return { timeline: { id: "timeline-new" } };
    },
  };
  const editor = createMessageEditor(apiClient, { id: "message-1", content: "original" });

  await editor.save();
  const view = await editor.actions.continueFromHere();

  assert.deepEqual(calls, [["continue", "message-1", "revision-1"]]);
  assert.equal(view.currentTimelineId, "timeline-new");
});

test("cancel edit does not create a revision and original can be viewed", async () => {
  const { createMessageEditor } = await import(moduleUrl("src/features/message-editor/MessageEditor.js"));

  const calls = [];
  const apiClient = {
    async patchMessage() {
      calls.push("patch");
      return {};
    },
    async fetchOriginal(messageId) {
      assert.equal(messageId, "message-1");
      return { original_content: "original" };
    },
  };
  const editor = createMessageEditor(apiClient, { id: "message-1", content: "original" });

  editor.setDraft("edited");
  const cancelled = editor.cancel();
  const original = await editor.viewOriginal();

  assert.equal(cancelled.draft, "original");
  assert.equal(original, "original");
  assert.deepEqual(calls, []);
});
