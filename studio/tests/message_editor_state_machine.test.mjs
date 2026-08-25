import assert from "node:assert/strict";
import test from "node:test";

import { createMessageEditor } from "../src/features/message-editor/MessageEditor.js";

test("UI04-T04-TC01 Esc cancels editing without creating a revision", async () => {
  const calls = [];
  const editor = createMessageEditor({
    async patchMessage() {
      calls.push("patch");
      return {};
    },
  }, { id: "message-1", content: "original" });

  editor.startEdit();
  editor.setDraft("edited");
  const view = editor.handleKey({ key: "Escape" });

  assert.equal(view.mode, "View");
  assert.equal(view.draft, "original");
  assert.equal(view.revisionId, null);
  assert.deepEqual(calls, []);
});

test("UI04-T04-TC02 failed save keeps the user draft in editing state", async () => {
  const editor = createMessageEditor({
    async patchMessage() {
      throw new Error("network down");
    },
  }, { id: "message-1", content: "original" });

  editor.startEdit();
  editor.setDraft("edited draft");
  const view = await editor.save();

  assert.equal(view.mode, "Editing");
  assert.equal(view.draft, "edited draft");
  assert.equal(view.error.message, "network down");
  assert.equal(view.revisionId, null);
});

test("UI04-T04-TC03 successful save selects message and shows impact action summary", async () => {
  const editor = createMessageEditor({
    async patchMessage(messageId, payload) {
      assert.equal(messageId, "message-1");
      assert.equal(payload.new_content, "edited");
      return {
        revision_id: "revision-1",
        impact: {
          message_id: "message-1",
          revision_id: "revision-1",
          triggered: true,
          requires_replay: false,
          checks: ["state_dependency", "side_effect"],
          issues: [{ issue_type: "message_tool_result_conflict", severity: "warning", related_ids: ["message-1"] }],
        },
      };
    },
  }, { id: "message-1", content: "original" });

  editor.startEdit();
  editor.setDraft("edited");
  const view = await editor.save();

  assert.equal(view.mode, "ImpactReady");
  assert.equal(view.selectedMessageId, "message-1");
  assert.equal(view.badge, "User Modified");
  assert.deepEqual(view.availableActions, ["CONTEXT_ONLY", "CONTINUE_FROM_HERE", "REPLAY_FOLLOWING"]);
  assert.deepEqual(view.impactSummary, {
    triggered: true,
    requiresReplay: false,
    checkCount: 2,
    issueCount: 1,
  });
});
