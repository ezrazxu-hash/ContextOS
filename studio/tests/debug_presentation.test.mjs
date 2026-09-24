import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\tests$/, "");

function moduleUrl(relativePath) {
  return pathToFileURL(join(studioRoot, relativePath)).href;
}

test("Debug presentation filters trace and message rows without changing source counts", async () => {
  const { createDebugPresentation } = await import(moduleUrl("src/app/debugPresentation.js"));
  const traces = [
    { trace_id: "trace-email", component: "send_report_email", status: "ok" },
    { trace_id: "trace-model", component: "model", status: "ok" },
  ];
  const messages = [
    { id: "message-user", role: "user", content: "Summarize the incident" },
    { id: "message-assistant", role: "assistant", content: "The report is ready" },
  ];

  const view = createDebugPresentation({ traces, messages, query: "report" });

  assert.equal(view.traceCount, 2);
  assert.equal(view.messageCount, 2);
  assert.deepEqual(view.traces, [{ trace_id: "trace-email", component: "send_report_email", status: "ok" }]);
  assert.deepEqual(view.messages, [{ id: "message-assistant", role: "assistant", content: "The report is ready" }]);
  assert.equal(traces.length, 2);
  assert.equal(messages.length, 2);
});

test("Debug presentation exposes concise empty copy for filtered and unfiltered lists", async () => {
  const { createDebugPresentation } = await import(moduleUrl("src/app/debugPresentation.js"));

  assert.deepEqual(createDebugPresentation({ traces: [], messages: [], query: "" }).empty, {
    traces: "No trace events yet",
    messages: "No messages yet",
  });
  assert.deepEqual(createDebugPresentation({ traces: [], messages: [], query: "missing" }).empty, {
    traces: "No matching traces",
    messages: "No matching messages",
  });
});
