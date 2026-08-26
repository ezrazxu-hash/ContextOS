export function normalizeChatStreamEvent(rawEvent) {
  const eventName = rawEvent.event ?? rawEvent.type;
  const data = rawEvent.data ?? {};
  const id = rawEvent.id ?? null;
  if (eventName === "token") {
    return { id, type: "token_delta", data };
  }
  if (eventName === "done" || eventName === "message_completed") {
    return { id, type: "message_completed", data };
  }
  if (eventName === "tool_call" || eventName === "tool_started") {
    return { id, type: "tool_started", data };
  }
  if (eventName === "tool_result" || eventName === "tool_completed") {
    return { id, type: "tool_completed", data };
  }
  if (eventName === "heartbeat" || eventName === "error") {
    return { id, type: eventName, data };
  }
  return { id, type: "unknown", data };
}
