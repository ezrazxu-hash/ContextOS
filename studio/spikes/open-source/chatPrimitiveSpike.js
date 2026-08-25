export function renderAssistantUiSpike({ messages = [], actionSlot = null } = {}) {
  const items = [];

  for (const message of messages) {
    items.push({
      kind: "message",
      id: message.id,
      role: message.role,
      content: message.content,
    });

    for (const toolCall of message.toolCalls ?? []) {
      items.push({
        kind: "tool-call-placeholder",
        id: toolCall.id,
        name: toolCall.name,
        messageId: message.id,
      });
    }
  }

  if (actionSlot) {
    items.push({
      kind: "action-slot",
      label: actionSlot.label,
      messageId: actionSlot.messageId,
    });
  }

  return {
    provider: "assistant-ui-wrapper-spike",
    runtimeStateOwnedBy: "ContextOS",
    items,
  };
}
