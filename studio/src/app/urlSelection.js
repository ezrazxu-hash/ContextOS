const routePages = new Map([
  ["/chat", "chat"],
  ["/workflow", "workflow"],
  ["/template", "template"],
  ["/debug", "debug"],
]);

const selectionKeys = ["templateId", "sessionId", "timelineId", "messageId", "traceId", "nodeId"];

export function resolveUrlSelection(url, backendProjection = {}) {
  const parsed = parseUrl(url);
  const fallback = applySelectionFallback(parsed.selection, backendProjection);
  const selection = fallback.selection;
  return {
    page: routePages.get(parsed.path) ?? "chat",
    path: parsed.path,
    selection,
    dataQuery: toDataQuery(selection),
    hint: fallback.hint,
  };
}

export function createSelectionHistory(initialUrl = "/chat") {
  const entries = [initialUrl];
  let cursor = 0;

  return {
    current() {
      return resolveUrlSelection(entries[cursor]);
    },
    push(url) {
      entries.splice(cursor + 1);
      entries.push(url);
      cursor = entries.length - 1;
      return resolveUrlSelection(entries[cursor]);
    },
    back() {
      cursor = Math.max(0, cursor - 1);
      return resolveUrlSelection(entries[cursor]);
    },
    forward() {
      cursor = Math.min(entries.length - 1, cursor + 1);
      return resolveUrlSelection(entries[cursor]);
    },
  };
}

function parseUrl(url) {
  const parsed = new URL(url, "http://contextos.local");
  const selection = {};
  for (const key of selectionKeys) {
    selection[key] = parsed.searchParams.get(key);
  }
  return {
    path: routePages.has(parsed.pathname) ? parsed.pathname : "/chat",
    selection,
  };
}

function toDataQuery(selection) {
  return {
    sessionId: selection.sessionId,
    routeParams: compact({
      template_id: selection.templateId,
      timeline_id: selection.timelineId,
      message_id: selection.messageId,
      trace_id: selection.traceId,
      node_id: selection.nodeId,
    }),
  };
}

function applySelectionFallback(selection, backendProjection) {
  if (!selection.messageId || !Array.isArray(backendProjection.messages) || messageExists(selection.messageId, backendProjection.messages)) {
    return { selection: { ...selection }, hint: null };
  }

  const fallbackMessage = firstMessageForTimeline(selection.timelineId, backendProjection.messages);
  if (!fallbackMessage) {
    return { selection: { ...selection, messageId: null }, hint: fallbackHint() };
  }

  return {
    selection: { ...selection, messageId: fallbackMessage.id },
    hint: fallbackHint(),
  };
}

function messageExists(messageId, messages = []) {
  return messages.some((message) => message.id === messageId);
}

function firstMessageForTimeline(timelineId, messages = []) {
  return messages.find((message) => !timelineId || message.timeline_id === timelineId) ?? null;
}

function fallbackHint() {
  return {
    kind: "selection-fallback",
    message: "Selected message is unavailable; showing the first message in this timeline.",
  };
}

function compact(values) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value));
}
