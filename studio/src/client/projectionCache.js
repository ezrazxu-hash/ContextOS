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

export function createProjectionCache(apiClient = {}) {
  const values = new Map();

  return {
    get(key) {
      return values.get(serializeKey(key));
    },
    set(key, value) {
      values.set(serializeKey(key), value);
      return value;
    },
    async rehydrateSession(sessionId) {
      const snapshot = await apiClient.fetchRuntimeSnapshot(sessionId);
      values.set(serializeKey(queryKeys.snapshot(sessionId)), snapshot);
      return snapshot;
    },
    invalidateAffected(keys) {
      for (const key of keys) {
        values.delete(serializeKey(key));
      }
      return keys;
    },
  };
}

function serializeKey(key) {
  return JSON.stringify(key);
}
