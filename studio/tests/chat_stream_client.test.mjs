import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\tests$/, "");

function moduleUrl(relativePath) {
  return pathToFileURL(join(studioRoot, relativePath)).href;
}

test("UI02-T03 duplicate event id does not render token twice", async () => {
  const { createChatStreamReducer } = await import(moduleUrl("src/client/chatStream.js"));
  const stream = createChatStreamReducer();

  stream.apply({ id: "evt-1", event: "token", data: { message_id: "message-a", content: "Hi" } });
  stream.apply({ id: "evt-1", event: "token", data: { message_id: "message-a", content: "Hi" } });

  assert.equal(stream.messages[0].content, "Hi");
  assert.equal(stream.lastEventId, "evt-1");
});

test("UI02-T03 reconnect continues the same in-flight message", async () => {
  const { createChatStreamReducer } = await import(moduleUrl("src/client/chatStream.js"));
  const stream = createChatStreamReducer();

  stream.apply({ id: "evt-1", event: "token", data: { message_id: "message-a", content: "Hel" } });
  stream.disconnect();
  stream.reconnect({ lastEventId: "evt-1" });
  stream.apply({ id: "evt-2", event: "token", data: { message_id: "message-a", content: "lo" } });

  assert.equal(stream.connection.kind, "ready");
  assert.equal(stream.messages.length, 1);
  assert.equal(stream.messages[0].content, "Hello");
});

test("UI02-T03 completed message ignores later delta", async () => {
  const { createChatStreamReducer } = await import(moduleUrl("src/client/chatStream.js"));
  const stream = createChatStreamReducer();

  stream.apply({ id: "evt-1", event: "token", data: { message_id: "message-a", content: "Done" } });
  stream.apply({ id: "evt-2", event: "done", data: { message_id: "message-a", checkpoint_id: "checkpoint-a" } });
  stream.apply({ id: "evt-3", event: "token", data: { message_id: "message-a", content: " extra" } });

  assert.equal(stream.messages[0].content, "Done");
  assert.equal(stream.messages[0].status, "completed");
  assert.equal(stream.messages[0].checkpointId, "checkpoint-a");
});
