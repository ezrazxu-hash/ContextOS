export function createMessageCard(message) {
  return {
    key: message.id,
    id: message.id,
    role: message.role,
    roleLabel: roleLabel(message.role),
    content: message.content,
    status: message.status,
    tokenCount: message.token_count ?? message.tokenCount ?? 0,
    contextGroupIds: message.context_group_ids ?? message.contextGroupIds ?? [],
    checkpointId: message.checkpoint_id ?? message.checkpointId ?? null,
    traceId: message.trace_id ?? message.traceId ?? null,
    toolRelation: {
      toolCallIds: message.tool_call_ids ?? message.toolCallIds ?? [],
      toolResultIds: message.tool_result_ids ?? message.toolResultIds ?? [],
    },
    createdAt: message.created_at ?? message.createdAt ?? null,
  };
}

function roleLabel(role) {
  if (role === "assistant") {
    return "Assistant";
  }
  if (role === "user") {
    return "User";
  }
  return role;
}
