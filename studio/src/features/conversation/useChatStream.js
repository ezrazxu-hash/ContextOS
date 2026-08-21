export function createChatStreamState(initialMessages = []) {
  const messages = initialMessages.map(normalizeMessage);

  return {
    get messages() {
      return messages;
    },
    applyEvent(event) {
      if (event.type !== "token") {
        return messages;
      }
      const messageId = event.data.message_id;
      const existing = messages.find((message) => message.id === messageId);
      if (existing) {
        existing.content += event.data.content;
        return messages;
      }
      messages.push(
        normalizeMessage({
          id: messageId,
          role: event.data.role ?? "assistant",
          content: event.data.content,
          status: "streaming",
          token_count: 0,
          context_group_ids: [],
          checkpoint_id: null,
          trace_id: null,
          tool_call_ids: [],
          tool_result_ids: [],
          created_at: null,
        }),
      );
      return messages;
    },
  };
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
