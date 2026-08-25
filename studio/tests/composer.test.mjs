import assert from "node:assert/strict";
import test from "node:test";

import { createComposer } from "../src/features/conversation/Composer.js";

test("UI03-T04-TC01 composing Enter does not send and Shift+Enter inserts newline", async () => {
  const calls = [];
  const composer = createComposer({
    apiClient: { async postSessionMessage() { calls.push("send"); } },
    sessionId: "session-1",
    timelineId: "timeline-1",
  });

  composer.setDraft("你");
  assert.deepEqual(await composer.handleKeyDown({ key: "Enter", isComposing: true }), { status: "ignored", reason: "composing" });
  assert.deepEqual(composer.handleKeyDown({ key: "Enter", shiftKey: true }), { status: "newline" });

  assert.equal(composer.view().draft, "你\n");
  assert.deepEqual(calls, []);
});

test("UI03-T04-TC02 duplicate send produces one request and no local fake message", async () => {
  let release;
  const calls = [];
  const composer = createComposer({
    apiClient: {
      async postSessionMessage(sessionId, payload) {
        calls.push({ sessionId, payload });
        await new Promise((resolve) => {
          release = resolve;
        });
        return { id: "server-message" };
      },
      async *streamChatEvents() {},
    },
    sessionId: "session-1",
    timelineId: "timeline-1",
    allowedModels: ["gpt-demo"],
  });

  composer.setDraft("Hello");
  const first = composer.submit();
  const second = composer.submit();
  release();
  const view = await second;
  await first;

  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.content, "Hello");
  assert.equal(view.draft, "");
  assert.deepEqual(view.localMessages, []);
  assert.deepEqual(view.models, ["gpt-demo"]);
});

test("UI03-T04-TC03 SSE failure restores the submitted draft", async () => {
  const composer = createComposer({
    apiClient: {
      async postSessionMessage() {
        return { id: "server-user-message" };
      },
      async *streamChatEvents() {
        throw new Error("SSE disconnected");
      },
    },
    sessionId: "session-1",
    timelineId: "timeline-1",
  });

  composer.setDraft("Recover me");
  const view = await composer.submit();

  assert.equal(view.status, "failed");
  assert.equal(view.draft, "Recover me");
  assert.equal(view.error.message, "SSE disconnected");
});
