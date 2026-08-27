import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\tests$/, "");

function moduleUrl(relativePath) {
  return pathToFileURL(join(studioRoot, relativePath)).href;
}

test("SSE client parses ReadableStream frames incrementally with split UTF-8 text", async () => {
  const { streamSseEvents } = await import(moduleUrl("src/client/sseStream.js"));
  const encoder = new TextEncoder();
  const frame = 'event: token\ndata: {"content":"你好"}\n\n';
  const bytes = encoder.encode(frame);
  const response = fakeSseResponse([
    bytes.slice(0, 30),
    bytes.slice(30),
    encoder.encode('event: done\ndata: {"message_id":"message-1"}\n\n'),
  ]);

  const events = [];
  for await (const event of streamSseEvents(response)) {
    events.push(event);
  }

  assert.deepEqual(events, [
    { type: "token", data: { content: "你好" } },
    { type: "done", data: { message_id: "message-1" } },
  ]);
});

test("SSE client exposes server error events instead of swallowing them", async () => {
  const { streamSseEvents } = await import(moduleUrl("src/client/sseStream.js"));
  const encoder = new TextEncoder();
  const response = fakeSseResponse([
    encoder.encode('event: token\ndata: {"content":"partial"}\n\n'),
    encoder.encode('event: error\ndata: {"message":"DeepSeek stream error overloaded_error: busy"}\n\n'),
  ]);

  const events = [];
  for await (const event of streamSseEvents(response)) {
    events.push(event);
  }

  assert.deepEqual(events, [
    { type: "token", data: { content: "partial" } },
    { type: "error", data: { message: "DeepSeek stream error overloaded_error: busy" } },
  ]);
});

function fakeSseResponse(chunks) {
  return {
    ok: true,
    status: 200,
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
  };
}
