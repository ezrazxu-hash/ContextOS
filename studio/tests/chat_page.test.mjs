import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\tests$/, "");

function moduleUrl(relativePath) {
  return pathToFileURL(join(studioRoot, relativePath)).href;
}

test("streaming tokens update the same server message", async () => {
  const { createChatStreamState } = await import(moduleUrl("src/features/conversation/useChatStream.js"));

  const stream = createChatStreamState();
  stream.applyEvent({ type: "token", data: { message_id: "message-1", role: "assistant", content: "Hel" } });
  stream.applyEvent({ type: "token", data: { message_id: "message-1", role: "assistant", content: "lo" } });

  assert.equal(stream.messages.length, 1);
  assert.equal(stream.messages[0].id, "message-1");
  assert.equal(stream.messages[0].content, "Hello");
});

test("chat page rehydrates messages from the API after refresh", async () => {
  const { createChatPage } = await import(moduleUrl("src/pages/Chat/ChatPage.js"));

  const apiClient = {
    async fetchSessionMessages(sessionId) {
      assert.equal(sessionId, "session-1");
      return {
        messages: [
          {
            id: "server-user-1",
            role: "user",
            content: "Hello",
            status: "completed",
            token_count: 1,
            context_group_ids: ["group-1"],
            checkpoint_id: null,
            trace_id: "trace-1",
            tool_call_ids: [],
            tool_result_ids: [],
            created_at: "2026-08-20T00:00:00+00:00",
          },
          {
            id: "server-assistant-1",
            role: "assistant",
            content: "Hi",
            status: "completed",
            token_count: 1,
            context_group_ids: [],
            checkpoint_id: "checkpoint-1",
            trace_id: "trace-1",
            tool_call_ids: ["call-1"],
            tool_result_ids: ["call-1"],
            created_at: "2026-08-20T00:00:01+00:00",
          },
        ],
      };
    },
  };
  const chatPage = createChatPage(apiClient, "session-1");

  const view = await chatPage.rehydrate();

  assert.deepEqual(view.cards.map((card) => card.key), ["server-user-1", "server-assistant-1"]);
  assert.deepEqual(view.cards.map((card) => card.roleLabel), ["User", "Assistant"]);
  assert.equal(view.cards[1].checkpointId, "checkpoint-1");
  assert.deepEqual(view.cards[1].toolRelation.toolCallIds, ["call-1"]);
});

test("chat page edits a message through the Runtime API and refreshes from server content", async () => {
  const { createChatPage } = await import(moduleUrl("src/pages/Chat/ChatPage.js"));
  const messages = [
    { id: "message-1", role: "assistant", content: "original", status: "completed", token_count: 1 },
    { id: "message-2", role: "user", content: "other", status: "completed", token_count: 1 },
  ];
  const apiClient = {
    async fetchSessionMessages() {
      return { messages };
    },
    async patchMessage(messageId, payload) {
      assert.equal(messageId, "message-1");
      assert.equal(payload.new_content, "edited");
      const message = messages.find((item) => item.id === messageId);
      message.content = payload.new_content;
      message.revision_id = "revision-1";
      return { revision_id: "revision-1", message };
    },
  };
  const chatPage = createChatPage(apiClient, "session-1");
  await chatPage.rehydrate();

  const edited = await chatPage.editMessage("message-1", "edited");
  const refreshed = await createChatPage(apiClient, "session-1").rehydrate();

  assert.equal(edited.cards[0].content, "edited");
  assert.equal(edited.cards[0].revisionId, "revision-1");
  assert.equal(refreshed.cards[0].content, "edited");
  assert.equal(refreshed.cards[1].content, "other");
});

test("chat page soft delete hides only the selected session message from current state", async () => {
  const { createChatPage } = await import(moduleUrl("src/pages/Chat/ChatPage.js"));
  const messages = [
    { id: "message-1", role: "user", content: "hide", status: "completed", token_count: 1 },
    { id: "message-2", role: "assistant", content: "keep", status: "completed", token_count: 1 },
  ];
  const apiClient = {
    async fetchSessionMessages() {
      return { messages: messages.filter((message) => !message.is_deleted) };
    },
    async deleteMessage(messageId) {
      const message = messages.find((item) => item.id === messageId);
      message.is_deleted = true;
      message.deleted_at = "2026-08-28T00:00:00+00:00";
      return { message_ids: [messageId], message };
    },
  };
  const chatPage = createChatPage(apiClient, "session-1");
  await chatPage.rehydrate();

  const deleted = await chatPage.deleteMessage("message-1");
  const refreshed = await createChatPage(apiClient, "session-1").rehydrate();

  assert.deepEqual(deleted.cards.map((card) => card.id), ["message-2"]);
  assert.deepEqual(refreshed.cards.map((card) => card.id), ["message-2"]);
  assert.equal(messages[0].content, "hide");
  assert.equal(messages[0].is_deleted, true);
});
