import assert from "node:assert/strict";
import test from "node:test";

import { createConversationViewport } from "../src/features/conversation/ConversationViewport.js";

function messages(start, count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `message-${start + index}`,
    content: `Message ${start + index}`,
  }));
}

test("UI03-T02-TC01 prepending previous messages keeps the current visual anchor stable", () => {
  const viewport = createConversationViewport({
    messages: messages(100, 20),
    itemHeight: 32,
    viewportHeight: 320,
  });

  viewport.scrollTo(0);
  const before = viewport.view().anchor;
  const after = viewport.prependPrevious(messages(80, 20));

  assert.equal(before.messageId, "message-100");
  assert.equal(after.anchor.messageId, "message-100");
  assert.equal(after.scrollTop, 20 * 32);
});

test("UI03-T02-TC02 500+ messages render a bounded virtual window and remain scrollable", () => {
  const viewport = createConversationViewport({
    messages: messages(1, 520),
    itemHeight: 28,
    viewportHeight: 280,
    overscan: 2,
  });

  const view = viewport.scrollToIndex(450);

  assert.equal(view.totalCount, 520);
  assert.ok(view.rendered.length <= 15);
  assert.equal(view.rendered.some((item) => item.message.id === "message-451"), true);
});

test("UI03-T02-TC03 streaming while reading history does not force-scroll to the bottom", () => {
  const viewport = createConversationViewport({
    messages: messages(1, 80),
    itemHeight: 30,
    viewportHeight: 300,
  });

  viewport.scrollTo(300);
  const reading = viewport.appendStreaming({ id: "message-stream", content: "Hello" });

  assert.equal(reading.scrollTop, 300);
  assert.equal(reading.returnToBottomVisible, true);

  viewport.scrollToBottom();
  const following = viewport.appendStreaming({ id: "message-stream", content: " world" });

  assert.equal(following.returnToBottomVisible, false);
  assert.equal(following.isAtBottom, true);
});
