import assert from "node:assert/strict";
import test from "node:test";

import { createMessageEditor } from "../src/features/message-editor/MessageEditor.js";

async function savedEditor(apiClient = {}) {
  const editor = createMessageEditor({
    async patchMessage() {
      return {
        revision_id: "revision-1",
        impact: { triggered: true, requires_replay: false, checks: [] },
      };
    },
    ...apiClient,
  }, { id: "message-1", session_id: "session-1", timeline_id: "timeline-parent", content: "original" });
  editor.setDraft("edited");
  await editor.save();
  return editor;
}

test("UI04-T05-TC01 action bar exposes three distinct commands and calls distinct endpoints", async () => {
  const calls = [];
  const editor = await savedEditor({
    async contextOnly(messageId, revisionId) {
      calls.push(["contextOnly", messageId, revisionId]);
      return { timeline: { id: "timeline-context" } };
    },
    async continueFromMessage(messageId, revisionId) {
      calls.push(["continueFromMessage", messageId, revisionId]);
      return { timeline: { id: "timeline-continue" } };
    },
  });

  const view = editor.actionBar();
  await editor.actions.contextOnly();
  await editor.actions.continueFromHere();

  assert.deepEqual(view.actions.map((action) => action.command), ["context_only", "continue_from_here", "open_replay_plan"]);
  assert.deepEqual(calls, [
    ["contextOnly", "message-1", "revision-1"],
    ["continueFromMessage", "message-1", "revision-1"],
  ]);
});

test("UI04-T05-TC02 continue success points navigation URL at the new timeline", async () => {
  const editor = await savedEditor({
    async continueFromMessage() {
      return { timeline: { id: "timeline-new" } };
    },
  });

  const view = await editor.actions.continueFromHere();

  assert.equal(view.currentTimelineId, "timeline-new");
  assert.equal(view.navigation.url, "/chat?sessionId=session-1&timelineId=timeline-new");
});

test("UI04-T05-TC03 replay first click opens plan intent without reinvoking tool", async () => {
  const calls = [];
  const editor = await savedEditor({
    async replayMessage() {
      calls.push("replayMessage");
      return { status: "executed" };
    },
    async replayPlan() {
      calls.push("replayPlan");
      return { status: "executed" };
    },
  });

  const result = await editor.actions.replayLater();

  assert.deepEqual(calls, []);
  assert.deepEqual(result, {
    status: "plan_required",
    command: "open_replay_plan",
    messageId: "message-1",
    revisionId: "revision-1",
  });
});
