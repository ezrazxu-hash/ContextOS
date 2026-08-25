import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\tests$/, "");

function moduleUrl(relativePath) {
  return pathToFileURL(join(studioRoot, relativePath)).href;
}

test("UI01-T03 copied Debug deep link restores the same trace data query", async () => {
  const { resolveUrlSelection } = await import(moduleUrl("src/app/urlSelection.js"));

  const resolved = resolveUrlSelection("/debug?sessionId=session-a&timelineId=timeline-a&messageId=message-a&traceId=trace-a");

  assert.equal(resolved.page, "debug");
  assert.equal(resolved.selection.traceId, "trace-a");
  assert.deepEqual(resolved.dataQuery, {
    sessionId: "session-a",
    routeParams: {
      timeline_id: "timeline-a",
      message_id: "message-a",
      trace_id: "trace-a",
    },
  });
});

test("UI01-T03 invalid messageId degrades to the first valid message in timeline and explains it", async () => {
  const { resolveUrlSelection } = await import(moduleUrl("src/app/urlSelection.js"));

  const resolved = resolveUrlSelection("/chat?sessionId=session-a&timelineId=timeline-a&messageId=missing-message", {
    messages: [
      { id: "message-a", timeline_id: "timeline-a" },
      { id: "message-b", timeline_id: "timeline-b" },
    ],
  });

  assert.equal(resolved.selection.messageId, "message-a");
  assert.deepEqual(resolved.hint, {
    kind: "selection-fallback",
    message: "Selected message is unavailable; showing the first message in this timeline.",
  });
});

test("UI01-T03 browser back and forward restore URL selection", async () => {
  const { createSelectionHistory } = await import(moduleUrl("src/app/urlSelection.js"));

  const history = createSelectionHistory("/chat?sessionId=session-a&timelineId=timeline-a");
  history.push("/chat?sessionId=session-a&timelineId=timeline-a&messageId=message-a");
  history.push("/debug?sessionId=session-a&timelineId=timeline-a&traceId=trace-a");

  const back = history.back();
  const forward = history.forward();

  assert.equal(back.selection.messageId, "message-a");
  assert.equal(back.page, "chat");
  assert.equal(forward.selection.traceId, "trace-a");
  assert.equal(forward.page, "debug");
});
