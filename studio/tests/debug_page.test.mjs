import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\tests$/, "");

function moduleUrl(relativePath) {
  return pathToFileURL(join(studioRoot, relativePath)).href;
}

function createDebugIndex() {
  return {
    session: { id: "session-1", current_timeline_id: "timeline-a" },
    graph: { current_timeline_id: "timeline-a" },
    timelines: [
      { id: "timeline-a", parent_timeline_id: null },
      { id: "timeline-b", parent_timeline_id: "timeline-a" },
    ],
    checkpoints: [
      {
        id: "checkpoint-a",
        timeline_id: "timeline-a",
        graph_state: { node: "writer", draft: "A" },
        message_cursor: 2,
        context_revision: "ctx-a",
      },
      {
        id: "checkpoint-b",
        timeline_id: "timeline-b",
        graph_state: { node: "reviewer", draft: "B" },
        message_cursor: 4,
        context_revision: "ctx-b",
      },
    ],
    messages: [
      { id: "message-a", checkpoint_id: "checkpoint-a", content: "timeline A", role: "assistant" },
      { id: "message-b", checkpoint_id: "checkpoint-b", content: "timeline B", role: "assistant" },
    ],
    traces: { items: [{ trace_id: "trace-b", checkpoint_id: "checkpoint-b" }], total: 1, offset: 0, limit: 50 },
    state: { graph_state: { node: "writer", draft: "A" } },
    tools: [],
    context: { revision: "ctx-a" },
    prompt_inputs: [],
  };
}

test("switching timelines keeps graph conversation and state scoped by stable ids", async () => {
  const { createDebugPage } = await import(moduleUrl("src/pages/Debug/index.js"));
  const apiClient = {
    async fetchDebugIndex() {
      return createDebugIndex();
    },
  };
  const page = createDebugPage(apiClient, "session-1");

  await page.rehydrate();
  const timelineB = page.selectTimeline("timeline-b");
  const timelineA = page.selectTimeline("timeline-a");

  assert.deepEqual(timelineB.graph.selectedTimelineId, "timeline-b");
  assert.deepEqual(timelineB.conversation.map((message) => message.id), ["message-b"]);
  assert.deepEqual(timelineB.stateInspector.graphState, { node: "reviewer", draft: "B" });
  assert.deepEqual(timelineA.graph.selectedTimelineId, "timeline-a");
  assert.deepEqual(timelineA.conversation.map((message) => message.id), ["message-a"]);
  assert.deepEqual(timelineA.stateInspector.graphState, { node: "writer", draft: "A" });
});

test("selected checkpoint state matches the backend debug index graph_state", async () => {
  const { createDebugPage } = await import(moduleUrl("src/pages/Debug/index.js"));
  const apiClient = {
    async fetchDebugIndex() {
      return createDebugIndex();
    },
  };
  const page = createDebugPage(apiClient, "session-1");

  await page.rehydrate();
  const view = page.selectCheckpoint("checkpoint-b");

  assert.equal(view.stateInspector.checkpointId, "checkpoint-b");
  assert.deepEqual(view.stateInspector.graphState, { node: "reviewer", draft: "B" });
});

test("trace id route params are sent to the debug API for chat trace jumps", async () => {
  const { createDebugPage } = await import(moduleUrl("src/pages/Debug/index.js"));
  const calls = [];
  const apiClient = {
    async fetchDebugIndex(sessionId, filters) {
      calls.push({ sessionId, filters });
      return createDebugIndex();
    },
  };
  const page = createDebugPage(apiClient, "session-1", { trace_id: "trace-b" });

  const view = await page.rehydrate();

  assert.deepEqual(calls, [{ sessionId: "session-1", filters: { trace_id: "trace-b" } }]);
  assert.equal(view.selectedTraceId, "trace-b");
  assert.equal(view.selectedCheckpointId, "checkpoint-b");
  assert.equal(view.graph.selectedTimelineId, "timeline-b");
});
