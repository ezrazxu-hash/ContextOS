import { ClientError } from "../../client/http.js";
import { runtimeApiContract } from "../../client-core/contracts.js";
import { demoFixtures } from "../fixtures/demoRuntime.js";

export { demoFixtures };
export { runtimeApiContract };

export function createMockRuntimeClient(fixtures = demoFixtures) {
  let contextItems = clone(fixtures.context);
  let templateManifest = clone(fixtures.templateManifest);

  return {
    async fetchRuntimeSnapshot(sessionId) {
      assertSession(fixtures, sessionId);
      return {
        session: clone(fixtures.session),
        current_timeline: clone(fixtures.timeline),
        latest_checkpoint: clone(fixtures.checkpoint),
      };
    },
    async fetchSessionMessages(sessionId) {
      assertSession(fixtures, sessionId);
      return { messages: clone(fixtures.messages), next_cursor: null };
    },
    async fetchSessionContext(sessionId) {
      assertSession(fixtures, sessionId);
      return clone(contextItems);
    },
    async fetchDebugIndex(sessionId) {
      assertSession(fixtures, sessionId);
      return createDebugIndex(fixtures, contextItems);
    },
    async fetchTemplate(templateId) {
      assertTemplate(templateManifest, templateId);
      return { id: templateId, manifest: clone(templateManifest) };
    },
    async saveTemplate(manifest) {
      templateManifest = clone(manifest);
      return { id: manifest.template.id, manifest: clone(templateManifest) };
    },
    async validateTemplate() {
      return { valid: true, issues: [] };
    },
    async compileTemplate() {
      return { status: 200, compiled: true };
    },
    async runTemplate(templateId, payload) {
      assertTemplate(templateManifest, templateId);
      return { graph_state: { ...payload.graph_state, demo: true } };
    },
    async postContextGroupEvict(groupId) {
      const group = contextItems.filter((item) => item.group_id === groupId);
      if (group.length === 0) {
        throw clientError("context.operation_failed", "Context group not found", 400);
      }
      contextItems = contextItems.map((item) => (item.group_id === groupId ? { ...item, state: "EVICTED" } : item));
      return { ok: true, placeholder: { group_id: groupId, reason: "demo evict" } };
    },
    async postContextGroupRestore(groupId) {
      contextItems = contextItems.map((item) => (item.group_id === groupId ? { ...item, state: "RAW" } : item));
      return { ok: true };
    },
    async replayPlan(payload) {
      const decision = payload.decisions[0];
      if (decision?.tool_call_id !== fixtures.replay.sideEffectToolCall.tool_call_id) {
        throw clientError("replay.tool_call_not_found", "Tool call not found", 400);
      }
      if (decision.action === "REINVOKE" && decision.confirmation_token !== "confirm-demo-send-report-email") {
        throw clientError("replay.confirmation_required", "Replay confirmation required", 409);
      }
      return {
        status: "planned",
        body: {
          parent_timeline_id: payload.parent_timeline_id,
          fork_checkpoint_id: payload.fork_checkpoint_id,
          fork_message_id: payload.fork_message_id,
          decisions: clone(payload.decisions),
        },
      };
    },
    async *streamChatEvents() {
      yield { id: "demo-sse-1", type: "token", data: { message_id: "demo-assistant-stream", role: "assistant", content: "Q3 sales " } };
      yield {
        id: "demo-sse-2",
        type: "tool_call",
        data: { message_id: "demo-assistant-stream", call_id: "tool-call-sales", tool_id: "sales.search", name: "sales.search" },
      };
      yield {
        id: "demo-sse-3",
        type: "tool_result",
        data: { message_id: "demo-assistant-stream", call_id: "tool-call-sales", output: { growth: "18%" } },
      };
      yield { id: "demo-sse-4", type: "token", data: { message_id: "demo-assistant-stream", role: "assistant", content: "are up 18%." } };
      yield { id: "demo-sse-5", type: "done", data: { message_id: "demo-assistant-stream", checkpoint_id: fixtures.checkpoint.id } };
    },
  };
}

function createDebugIndex(fixtures, contextItems) {
  return {
    session: clone(fixtures.session),
    graph: { current_timeline_id: fixtures.timeline.id },
    timelines: [clone(fixtures.timeline)],
    checkpoints: [clone(fixtures.checkpoint)],
    messages: clone(fixtures.messages),
    traces: {
      items: [
        {
          id: "event-sales-search",
          trace_id: "demo-trace",
          checkpoint_id: fixtures.checkpoint.id,
          message_id: "demo-assistant-message",
          step_type: "tool_call",
          component: "sales.search",
          status: "success",
          duration: 120,
          tool_call_id: "tool-call-sales",
          replay_policy: "SAFE",
        },
        {
          id: "event-send-report-email",
          trace_id: "trace-send-report-email",
          checkpoint_id: fixtures.checkpoint.id,
          message_id: "demo-assistant-message",
          step_type: "tool_call",
          component: "send_report_email",
          status: "blocked",
          duration: 48,
          tool_call_id: fixtures.replay.sideEffectToolCall.tool_call_id,
          side_effect: fixtures.replay.sideEffectToolCall.side_effect,
          replay_policy: fixtures.replay.sideEffectToolCall.replay_policy,
          replayable: true,
        },
      ],
      total: 2,
      offset: 0,
      limit: 50,
    },
    state: { graph_state: clone(fixtures.checkpoint.graph_state) },
    tools: [
      {
        trace_id: "trace-send-report-email",
        checkpoint_id: fixtures.checkpoint.id,
        tool_call_id: fixtures.replay.sideEffectToolCall.tool_call_id,
        tool_result_id: null,
      },
    ],
    context: { revision: fixtures.checkpoint.context_revision, items: clone(contextItems) },
    prompt_inputs: [{ key: "input", value: fixtures.messages[0].content }],
  };
}

function assertSession(fixtures, sessionId) {
  if (sessionId !== fixtures.session.id) {
    throw clientError("session.not_found", "Session not found", 404);
  }
}

function assertTemplate(manifest, templateId) {
  if (templateId !== manifest.template.id) {
    throw clientError("template.not_found", "Template not found", 404);
  }
}

function clientError(code, message, status) {
  return new ClientError({ code, message, requestId: "req-demo-runtime", status });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
