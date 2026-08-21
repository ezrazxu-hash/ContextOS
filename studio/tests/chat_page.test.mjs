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
