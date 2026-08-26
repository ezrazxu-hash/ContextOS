export { normalizeChatStreamEvent } from "../client-core/streamEvents.js";
import { normalizeChatStreamEvent } from "../client-core/streamEvents.js";

export function createChatStreamReducer(initialMessages = []) {
  const state = {
    messages: initialMessages.map(normalizeMessage),
    seenEventIds: new Set(),
    lastEventId: null,
    connection: { kind: "ready" },
    tools: [],
    error: null,
  };

  return {
    get messages() {
      return state.messages;
    },
    get lastEventId() {
      return state.lastEventId;
    },
    get connection() {
      return state.connection;
    },
    apply(rawEvent) {
      const event = normalizeChatStreamEvent(rawEvent);
      if (event.id && state.seenEventIds.has(event.id)) {
        return state.messages;
      }
      if (event.id) {
        state.seenEventIds.add(event.id);
        state.lastEventId = event.id;
      }
      applyNormalizedEvent(state, event);
      return state.messages;
    },
    disconnect() {
      state.connection = { kind: "reconnecting", lastEventId: state.lastEventId };
      return state.connection;
    },
    reconnect({ lastEventId = state.lastEventId } = {}) {
      state.lastEventId = lastEventId;
      state.connection = { kind: "ready", lastEventId };
      return state.connection;
    },
  };
}

function applyNormalizedEvent(state, event) {
  if (event.type === "token_delta") {
    applyToken(state.messages, event.data);
  } else if (event.type === "message_completed") {
    completeMessage(state.messages, event.data);
  } else if (event.type === "tool_started") {
    state.tools.push({ type: event.type, ...event.data });
    attachToolId(state.messages, event.data, "toolCallIds");
  } else if (event.type === "tool_completed") {
    state.tools.push({ type: event.type, ...event.data });
    attachToolId(state.messages, event.data, "toolResultIds");
  } else if (event.type === "error") {
    state.error = event.data;
  }
}

function attachToolId(messages, data, fieldName) {
  const messageId = data.message_id;
  const toolCallId = data.call_id ?? data.tool_call_id;
  const existing = messages.find((message) => message.id === messageId);
  if (!existing || !toolCallId || existing[fieldName].includes(toolCallId)) {
    return;
  }
  existing[fieldName].push(toolCallId);
}

function applyToken(messages, data) {
  const messageId = data.message_id;
  const existing = messages.find((message) => message.id === messageId);
  if (existing) {
    if (existing.status !== "completed") {
      existing.content += data.content ?? "";
    }
    return;
  }
  messages.push(
    normalizeMessage({
      id: messageId,
      role: data.role ?? "assistant",
      content: data.content ?? "",
      status: "streaming",
      token_count: 0,
      context_group_ids: [],
      checkpoint_id: null,
      trace_id: data.trace_id ?? null,
      tool_call_ids: [],
      tool_result_ids: [],
      created_at: null,
    }),
  );
}

function completeMessage(messages, data) {
  const messageId = data.message_id;
  const existing = messages.find((message) => message.id === messageId);
  if (!existing) {
    messages.push(
      normalizeMessage({
        id: messageId,
        role: data.role ?? "assistant",
        content: data.content ?? "",
        status: "completed",
        token_count: data.token_count ?? 0,
        context_group_ids: data.context_group_ids ?? [],
        checkpoint_id: data.checkpoint_id ?? null,
        trace_id: data.trace_id ?? null,
        tool_call_ids: data.tool_call_ids ?? [],
        tool_result_ids: data.tool_result_ids ?? [],
        created_at: data.created_at ?? null,
      }),
    );
    return;
  }
  existing.status = "completed";
  existing.checkpointId = data.checkpoint_id ?? existing.checkpointId;
  existing.traceId = data.trace_id ?? existing.traceId;
}

function normalizeMessage(message) {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    status: message.status,
    tokenCount: message.token_count ?? message.tokenCount ?? 0,
    contextGroupIds: message.context_group_ids ?? message.contextGroupIds ?? [],
    checkpointId: message.checkpoint_id ?? message.checkpointId ?? null,
    traceId: message.trace_id ?? message.traceId ?? null,
    toolCallIds: message.tool_call_ids ?? message.toolCallIds ?? [],
    toolResultIds: message.tool_result_ids ?? message.toolResultIds ?? [],
    createdAt: message.created_at ?? message.createdAt ?? null,
  };
}
