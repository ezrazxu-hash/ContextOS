import assert from "node:assert/strict";
import test from "node:test";

import { createChatTimelineView } from "../src/features/timeline/ChatTimelineView.js";

function debugIndex() {
  return {
    session: { id: "session-1", current_timeline_id: "timeline-a" },
    timelines: [
      { id: "timeline-a", parent_timeline_id: null, created_at: "2026-08-24T00:00:00+00:00", status: "active" },
      {
        id: "timeline-b",
        parent_timeline_id: "timeline-a",
        fork_checkpoint_id: "checkpoint-a",
        fork_message_id: "message-a",
        created_at: "2026-08-24T00:05:00+00:00",
        status: "active",
      },
    ],
    checkpoints: [
      { id: "checkpoint-a", timeline_id: "timeline-a", context_revision: "ctx-a" },
      { id: "checkpoint-b", timeline_id: "timeline-b", context_revision: "ctx-b" },
    ],
    messages: [
      { id: "message-a", checkpoint_id: "checkpoint-a", role: "assistant", content: "A" },
      { id: "message-b", checkpoint_id: "checkpoint-b", role: "assistant", content: "B" },
    ],
  };
}

test("UI03-T06-TC01 timeline switch rebinds messages context and impact together", () => {
  const timeline = createChatTimelineView(debugIndex());

  const b = timeline.selectTimeline("timeline-b");
  const a = timeline.selectTimeline("timeline-a");

  assert.deepEqual(b.binding.messages.map((message) => message.id), ["message-b"]);
  assert.equal(b.binding.contextRevision, "ctx-b");
  assert.equal(b.binding.impactAnchorMessageId, null);
  assert.deepEqual(a.binding.messages.map((message) => message.id), ["message-a"]);
  assert.equal(a.binding.contextRevision, "ctx-a");
});

test("UI03-T06-TC02 fork source can navigate back to the origin", () => {
  const timeline = createChatTimelineView(debugIndex());

  const view = timeline.selectTimeline("timeline-b");
  const source = view.items.find((item) => item.id === "timeline-b").forkSource;
  const target = timeline.navigateToForkSource("timeline-b");

  assert.deepEqual(source, {
    label: "Back to origin",
    timelineId: "timeline-a",
    checkpointId: "checkpoint-a",
    messageId: "message-a",
  });
  assert.equal(target.selectedTimelineId, "timeline-a");
});

test("UI03-T06-TC03 normal mode does not expose Branch ID terminology", () => {
  const view = createChatTimelineView(debugIndex(), { developerMode: false }).view();
  const text = JSON.stringify(view);

  assert.equal(text.includes("Branch"), false);
  assert.equal(text.includes("branch"), false);
  assert.equal(view.copy.title, "Conversation Versions");
});
