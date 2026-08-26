import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\tests$/, "");

function moduleUrl(relativePath) {
  return pathToFileURL(join(studioRoot, relativePath)).href;
}

test("UI08-T02-TC01: 500 messages 1000 context and 5000 traces stay interactable", async () => {
  const { createConversationViewport } = await import(moduleUrl("src/features/conversation/ConversationViewport.js"));
  const { createContextPanel } = await import(moduleUrl("src/features/context-panel/ContextPanel.js"));
  const { createExecutionTrace } = await import(moduleUrl("src/features/trace/ExecutionTrace.js"));

  const viewport = createConversationViewport({
    messages: Array.from({ length: 500 }, (_, index) => ({ id: `message-${index}`, content: `message ${index}` })),
  }).view();
  const panel = createContextPanel(
    {
      async fetchSessionContext() {
        return Array.from({ length: 1000 }, (_, index) => ({
          id: `ctx-${index}`,
          group_id: `group-${index % 10}`,
          state: "RAW",
          token_count_effective: 1,
          raw_content: "large raw payload",
        }));
      },
    },
    { sessionId: "session-1", maxTokens: 2000 },
  );
  const contextView = await panel.refresh();
  const trace = createExecutionTrace({
    traces: {
      items: Array.from({ length: 5000 }, (_, index) => ({
        id: `event-${index}`,
        trace_id: `trace-${index}`,
        step_type: index % 2 === 0 ? "tool_call" : "model_call",
        component: index % 2 === 0 ? "search" : "llm",
        status: index % 5 === 0 ? "failed" : "success",
      })),
    },
  });
  const failed = trace.filter({ status: "failed" });

  assert.ok(viewport.rendered.length < 40);
  assert.equal(contextView.productSections.RAW.renderedItems.length, 50);
  assert.equal(failed.items.length, 1000);
  assert.equal(failed.performance.strategy, "indexed");
});

test("UI08-T02-TC02: first paint does not fetch every raw payload", async () => {
  const { createContextPanel } = await import(moduleUrl("src/features/context-panel/ContextPanel.js"));
  const { createExecutionTrace } = await import(moduleUrl("src/features/trace/ExecutionTrace.js"));
  const calls = [];
  const panel = createContextPanel(
    {
      async fetchSessionContext() {
        return [{ id: "ctx-1", group_id: "group-1", state: "RAW", token_count_effective: 1, raw_content: "raw" }];
      },
      async fetchRaw(itemId) {
        calls.push(["raw", itemId]);
        return { id: itemId, raw_content: "raw" };
      },
    },
    { sessionId: "session-1", maxTokens: 100 },
  );
  const trace = createExecutionTrace({ traces: { items: [{ id: "event-1", trace_id: "trace-1", step_type: "tool_call" }] } });

  await panel.refresh();

  assert.deepEqual(calls, []);
  assert.equal(trace.items[0].rawLoaded, false);
});

test("UI08-T02-TC03: trace filter avoids full-list recompute on selection changes", async () => {
  const { createExecutionTrace } = await import(moduleUrl("src/features/trace/ExecutionTrace.js"));
  const trace = createExecutionTrace({
    traces: {
      items: Array.from({ length: 5000 }, (_, index) => ({
        id: `event-${index}`,
        trace_id: `trace-${index}`,
        step_type: "tool_call",
        component: index % 10 === 0 ? "search" : "cache",
        status: index % 10 === 0 ? "failed" : "success",
      })),
    },
  });

  const filtered = trace.filter({ status: "failed", component: "search" });

  assert.equal(filtered.items.length, 500);
  assert.ok(filtered.performance.scanned <= 500);
});
