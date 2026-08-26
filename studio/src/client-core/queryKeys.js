export const queryKeys = {
  snapshot(sessionId) {
    return ["runtime", "snapshot", sessionId];
  },
  messages(sessionId, timelineId) {
    return ["runtime", "messages", sessionId, timelineId ?? null];
  },
  context(sessionId) {
    return ["runtime", "context", sessionId];
  },
  trace(sessionId, traceId = null) {
    return ["runtime", "trace", sessionId, traceId];
  },
  timeline(sessionId, timelineId = null) {
    return ["runtime", "timeline", sessionId, timelineId];
  },
};

export function serializeQueryKey(key) {
  return JSON.stringify(key);
}
