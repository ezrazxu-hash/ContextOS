export function createDebugPresentation({ traces = [], messages = [], query = "" } = {}) {
  const normalizedQuery = String(query).trim().toLocaleLowerCase();
  const matches = (values) => !normalizedQuery || values.some((value) => String(value ?? "").toLocaleLowerCase().includes(normalizedQuery));

  return {
    traceCount: traces.length,
    messageCount: messages.length,
    traces: traces.filter((trace) => matches([trace.trace_id, trace.component, trace.status])),
    messages: messages.filter((message) => matches([message.id, message.role, message.content])),
    empty: {
      traces: normalizedQuery ? "No matching traces" : "No trace events yet",
      messages: normalizedQuery ? "No matching messages" : "No messages yet",
    },
  };
}
