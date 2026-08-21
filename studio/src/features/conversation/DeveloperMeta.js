export function createDeveloperMeta(message, { developerMode, navigate } = {}) {
  if (!developerMode) {
    return { visible: false, fields: [] };
  }

  const traceId = value(message, "trace_id", "traceId");
  return {
    visible: true,
    fields: [
      ["message_id", value(message, "id", "messageId")],
      ["checkpoint_id", value(message, "checkpoint_id", "checkpointId")],
      ["context_group_id", first(value(message, "context_group_ids", "contextGroupIds"))],
      ["trace_id", traceId],
    ].filter(([, fieldValue]) => fieldValue !== null && fieldValue !== undefined),
    goToTrace() {
      if (traceId && navigate) {
        navigate("/debug", { trace_id: traceId });
      }
    },
  };
}

function value(source, snakeKey, camelKey) {
  return source[snakeKey] ?? source[camelKey] ?? null;
}

function first(candidate) {
  if (Array.isArray(candidate)) {
    return candidate[0] ?? null;
  }
  return candidate;
}
