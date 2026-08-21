import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\tests$/, "");

function moduleUrl(relativePath) {
  return pathToFileURL(join(studioRoot, relativePath)).href;
}

test("tool trace shows duration and status while raw is loaded explicitly", async () => {
  const { createExecutionTrace } = await import(moduleUrl("src/features/trace/ExecutionTrace.js"));
  const { createToolTracePanel } = await import(moduleUrl("src/features/trace/ToolTracePanel.js"));
  const debugIndex = {
    traces: {
      items: [
        {
          id: "trace-event-tool",
          trace_id: "trace-1",
          step_type: "tool_call",
          component: "web_search",
          input_summary: "query=ContextOS",
          output_summary: "",
          duration: 0.25,
          status: "success",
        },
      ],
    },
  };
  const trace = createExecutionTrace(debugIndex);
  const panel = createToolTracePanel(debugIndex);

  assert.deepEqual(trace.items[0], {
    id: "trace-event-tool",
    traceId: "trace-1",
    stepType: "tool_call",
    component: "web_search",
    inputSummary: "query=ContextOS",
    outputSummary: "",
    duration: 0.25,
    status: "success",
    rawLoaded: false,
  });
  assert.deepEqual(panel.runs, [{ id: "trace-event-tool", component: "web_search", duration: 0.25, status: "success" }]);

  const loaded = await trace.loadRaw("trace-event-tool", async (eventId) => ({ id: eventId, raw: { query: "ContextOS" } }));

  assert.deepEqual(loaded, { id: "trace-event-tool", raw: { query: "ContextOS" } });
});

test("context restore trace locates group and context revision", async () => {
  const { createContextTracePanel } = await import(moduleUrl("src/features/trace/ContextTracePanel.js"));
  const debugIndex = {
    traces: {
      items: [
        {
          id: "trace-event-restore",
          step_type: "context_restore",
          component: "restore",
          status: "success",
          context_group_id: "group-1",
          context_revision: "ctx-rev-2",
        },
      ],
    },
    context: { revision: "ctx-rev-2" },
  };

  const panel = createContextTracePanel(debugIndex);

  assert.deepEqual(panel.operations, [
    {
      id: "trace-event-restore",
      operation: "context_restore",
      groupId: "group-1",
      contextRevision: "ctx-rev-2",
      status: "success",
    },
  ]);
  assert.equal(panel.currentRevision, "ctx-rev-2");
});

test("prompt inputs panel shows compiler validation failures", async () => {
  const { createPromptInputsPanel } = await import(moduleUrl("src/features/trace/PromptInputsPanel.js"));
  const debugIndex = {
    prompt_inputs: [{ message_id: "message-user", content: "Use the pinned release notes" }],
    traces: {
      items: [
        {
          id: "trace-event-compiler",
          step_type: "compiler_validation_failure",
          component: "manifest.compiler",
          status: "failed",
          output_summary: "nodes.writer.prompt is required",
          field_path: "graph.nodes.writer.prompt",
        },
      ],
    },
  };

  const panel = createPromptInputsPanel(debugIndex);

  assert.deepEqual(panel.inputs, [{ messageId: "message-user", content: "Use the pinned release notes" }]);
  assert.deepEqual(panel.compilerDiagnostics, [
    {
      id: "trace-event-compiler",
      fieldPath: "graph.nodes.writer.prompt",
      message: "nodes.writer.prompt is required",
      status: "failed",
    },
  ]);
});
