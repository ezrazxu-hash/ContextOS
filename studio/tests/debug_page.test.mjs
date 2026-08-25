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

function createMemoryPlatform() {
  const storage = new Map();
  return {
    readUiState(key) {
      return storage.get(key) ?? null;
    },
    writeUiState(key, value) {
      storage.set(key, value);
    },
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

test("UI07-T01-TC01: trace deep link selects the correct message and timeline on first paint", async () => {
  const { createDebugPage } = await import(moduleUrl("src/pages/Debug/index.js"));
  const apiClient = {
    async fetchDebugIndex() {
      return createDebugIndex();
    },
  };
  const page = createDebugPage(apiClient, "session-1", { trace_id: "trace-b" }, { platform: createMemoryPlatform() });

  const view = await page.rehydrate();

  assert.equal(view.kind, "debug-workbench");
  assert.deepEqual(view.columns.map((column) => column.id), ["timeline", "conversation-trace", "inspector"]);
  assert.equal(view.selectedTraceId, "trace-b");
  assert.equal(view.selectedTimelineId, "timeline-b");
  assert.equal(view.selectedMessageId, "message-b");
  assert.equal(view.timeline.items.find((item) => item.id === "timeline-b").selected, true);
});

test("UI07-T01-TC02: resizing panels keeps trace table within the center column", async () => {
  const { createDebugPage } = await import(moduleUrl("src/pages/Debug/index.js"));
  const platform = createMemoryPlatform();
  const page = createDebugPage(
    {
      async fetchDebugIndex() {
        return createDebugIndex();
      },
    },
    "session-1",
    {},
    { platform, viewportWidth: 1280 },
  );

  await page.rehydrate();
  const resized = page.resizePanel("right", 460);
  const traceResized = page.resizeTracePanel(340);

  assert.equal(resized.columns[2].width, 460);
  assert.ok(resized.columns[1].width >= resized.columns[1].minWidth);
  assert.equal(traceResized.tracePanel.height, 340);
  assert.ok(traceResized.tracePanel.tableWidth <= traceResized.columns[1].width);
  assert.deepEqual(platform.readUiState("contextos.workbench.debug.layout").right, 460);
});

test("UI07-T01-TC03: refresh reloads server selection instead of relying on browser-only state", async () => {
  const { createDebugPage } = await import(moduleUrl("src/pages/Debug/index.js"));
  const calls = [];
  const apiClient = {
    async fetchDebugIndex(sessionId, filters) {
      calls.push({ sessionId, filters });
      return createDebugIndex();
    },
  };
  const platform = createMemoryPlatform();
  const firstPage = createDebugPage(apiClient, "session-1", { trace_id: "trace-b" }, { platform });
  await firstPage.rehydrate();

  const refreshedPage = createDebugPage(apiClient, "session-1", { trace_id: "trace-b" }, { platform });
  const refreshed = await refreshedPage.rehydrate();

  assert.equal(calls.length, 2);
  assert.equal(refreshed.selectedTimelineId, "timeline-b");
  assert.equal(refreshed.selectedCheckpointId, "checkpoint-b");
  assert.equal(refreshed.selectedMessageId, "message-b");
});

test("UI07-T02-TC01: switching timeline updates middle and inspector together", async () => {
  const { createDebugPage } = await import(moduleUrl("src/pages/Debug/index.js"));
  const page = createDebugPage(
    {
      async fetchDebugIndex() {
        return createDebugIndex();
      },
    },
    "session-1",
  );

  await page.rehydrate();
  const view = page.selectTimeline("timeline-b");

  assert.equal(view.timeline.tree.find((item) => item.id === "timeline-b").selected, true);
  assert.deepEqual(view.conversation.map((message) => message.id), ["message-b"]);
  assert.equal(view.stateInspector.checkpointId, "checkpoint-b");
});

test("UI07-T02-TC02: current checkpoint highlight is unique", async () => {
  const { createDebugPage } = await import(moduleUrl("src/pages/Debug/index.js"));
  const page = createDebugPage(
    {
      async fetchDebugIndex() {
        return createDebugIndex();
      },
    },
    "session-1",
  );

  await page.rehydrate();
  const view = page.selectCheckpoint("checkpoint-b");
  const highlighted = view.timeline.checkpoints.filter((checkpoint) => checkpoint.current);

  assert.deepEqual(highlighted.map((checkpoint) => checkpoint.id), ["checkpoint-b"]);
  assert.equal(view.timeline.tree.find((item) => item.id === "timeline-b").forkCheckpointId, "checkpoint-a");
});

test("UI07-T02-TC03: 100+ checkpoints remain navigable with filter and mini map", async () => {
  const { createDebugPage } = await import(moduleUrl("src/pages/Debug/index.js"));
  const debugIndex = createDebugIndex();
  debugIndex.checkpoints = Array.from({ length: 120 }, (_, index) => ({
    id: `checkpoint-${index + 1}`,
    timeline_id: "timeline-a",
    graph_state: { index },
    message_cursor: index,
    context_revision: `ctx-${index + 1}`,
  }));
  debugIndex.messages = debugIndex.checkpoints.map((checkpoint, index) => ({
    id: `message-${index + 1}`,
    checkpoint_id: checkpoint.id,
    content: `message ${index + 1}`,
    role: "assistant",
  }));
  const page = createDebugPage(
    {
      async fetchDebugIndex() {
        return debugIndex;
      },
    },
    "session-1",
  );

  await page.rehydrate();
  const filtered = page.filterTimeline({ message: "message 118" });
  const fit = page.fitTimeline();

  assert.equal(filtered.timeline.checkpoints.length, 1);
  assert.equal(filtered.timeline.checkpoints[0].id, "checkpoint-118");
  assert.equal(fit.timeline.miniMap.enabled, true);
  assert.equal(fit.timeline.miniMap.totalCheckpoints, 120);
});

test("UI07-T03-TC01: selecting message #6 filters and locates the matching trace", async () => {
  const { createDebugPage } = await import(moduleUrl("src/pages/Debug/index.js"));
  const debugIndex = createDebugIndex();
  debugIndex.messages.push({
    id: "message-6",
    checkpoint_id: "checkpoint-a",
    content: "tool answer",
    role: "assistant",
    trace_id: "trace-message-6",
  });
  debugIndex.traces.items.push({
    id: "event-message-6",
    trace_id: "trace-message-6",
    checkpoint_id: "checkpoint-a",
    message_id: "message-6",
    step_type: "model_call",
  });
  const page = createDebugPage(
    {
      async fetchDebugIndex() {
        return debugIndex;
      },
    },
    "session-1",
  );

  await page.rehydrate();
  const view = page.selectMessage("message-6");

  assert.deepEqual(view.debugSelection, {
    kind: "debug-selection",
    messageId: "message-6",
    traceId: "trace-message-6",
    toolId: null,
    contextId: null,
    checkpointId: "checkpoint-a",
    timelineId: "timeline-a",
    relation: "direct",
  });
  assert.deepEqual(view.tracePanel.filteredTraceIds, ["trace-message-6"]);
  assert.equal(view.urlSelection.messageId, "message-6");
  assert.equal(view.urlSelection.traceId, "trace-message-6");
});

test("UI07-T03-TC02: selecting ToolResult trace highlights the related conversation card", async () => {
  const { createDebugPage } = await import(moduleUrl("src/pages/Debug/index.js"));
  const debugIndex = createDebugIndex();
  debugIndex.messages.find((message) => message.id === "message-b").tool_result_ids = ["tool-result-b"];
  debugIndex.traces.items.push({
    id: "event-tool-result-b",
    trace_id: "trace-tool-result-b",
    checkpoint_id: "checkpoint-b",
    message_id: "message-b",
    tool_result_id: "tool-result-b",
    context_group_id: "ctx-b",
    step_type: "tool_result",
  });
  const page = createDebugPage(
    {
      async fetchDebugIndex() {
        return debugIndex;
      },
    },
    "session-1",
  );

  await page.rehydrate();
  const view = page.selectTrace("trace-tool-result-b");
  const selectedCard = view.conversation.find((message) => message.id === "message-b");

  assert.equal(view.selectedTraceId, "trace-tool-result-b");
  assert.equal(view.selectedMessageId, "message-b");
  assert.equal(view.debugSelection.toolId, "tool-result-b");
  assert.equal(view.debugSelection.contextId, "ctx-b");
  assert.equal(selectedCard.selected, true);
  assert.deepEqual(view.tracePanel.filteredTraceIds, ["trace-tool-result-b"]);

  const toolView = page.selectTool("tool-result-b");
  assert.equal(toolView.selectedTraceId, "trace-tool-result-b");
  assert.equal(toolView.urlSelection.toolId, "tool-result-b");

  const contextView = page.selectContext("ctx-b");
  assert.equal(contextView.selectedTraceId, "trace-tool-result-b");
  assert.equal(contextView.urlSelection.contextGroupId, "ctx-b");
});

test("UI07-T03-TC03: browser back restores the previous debug selection", async () => {
  const { createDebugPage } = await import(moduleUrl("src/pages/Debug/index.js"));
  const debugIndex = createDebugIndex();
  debugIndex.messages.push({
    id: "message-6",
    checkpoint_id: "checkpoint-a",
    content: "tool answer",
    role: "assistant",
    trace_id: "trace-message-6",
  });
  debugIndex.traces.items.push({
    id: "event-message-6",
    trace_id: "trace-message-6",
    checkpoint_id: "checkpoint-a",
    message_id: "message-6",
    step_type: "model_call",
  });
  const page = createDebugPage(
    {
      async fetchDebugIndex() {
        return debugIndex;
      },
    },
    "session-1",
  );

  await page.rehydrate();
  page.selectMessage("message-6");
  page.selectTrace("trace-b");
  const restored = page.backSelection();

  assert.equal(restored.selectedMessageId, "message-6");
  assert.equal(restored.selectedTraceId, "trace-message-6");
  assert.equal(restored.urlSelection.messageId, "message-6");
  assert.equal(restored.urlSelection.traceId, "trace-message-6");
});
