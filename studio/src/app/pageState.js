export const pageStates = {
  loading: { kind: "loading", userMessage: "Loading server projection." },
  empty: { kind: "empty", userMessage: "No server projection is available yet." },
  error: { kind: "error", userMessage: "The request failed. Navigation remains available." },
  permission: { kind: "permission", userMessage: "You do not have access to this resource." },
  offline: { kind: "offline", userMessage: "You appear to be offline. Existing data may be stale." },
  stale: { kind: "stale", userMessage: "Showing stale data while refreshing from Runtime." },
  mutationPending: { kind: "mutationPending", userMessage: "Saving change to Runtime." },
};

export function toClientError(payload) {
  const error = payload.error ?? payload;
  return {
    code: error.code,
    message: error.message,
    requestId: error.request_id ?? error.requestId ?? null,
    status: error.status,
  };
}

export function createAsyncBoundary({ navigation = [] } = {}) {
  return {
    fail(error) {
      return {
        ...pageStates.error,
        error,
        recoverable: true,
        shellVisible: true,
        navigation: navigation.map((item) => ({ ...item })),
      };
    },
  };
}

export function createMutationState({ currentProjection }) {
  let projection = cloneProjection(currentProjection);

  return {
    start({ optimisticProjection } = {}) {
      projection = cloneProjection(optimisticProjection ?? currentProjection);
      return {
        ...pageStates.mutationPending,
        projection: cloneProjection(projection),
      };
    },
    succeed(nextProjection) {
      projection = cloneProjection(nextProjection);
      return {
        kind: "succeeded",
        userMessage: "Saved.",
        projection: cloneProjection(projection),
        fakeSuccess: false,
      };
    },
    fail(error) {
      projection = cloneProjection(currentProjection);
      return {
        kind: "failed",
        userMessage: error.message,
        error,
        projection: cloneProjection(projection),
        fakeSuccess: false,
        requiresRevalidate: error.status === 409,
      };
    },
  };
}

export function createRealtimeState() {
  let lastEventId = null;

  return {
    disconnect({ lastEventId: disconnectedEventId = lastEventId, retryInMs = 1000 } = {}) {
      lastEventId = disconnectedEventId;
      return {
        kind: "reconnecting",
        message: "Reconnecting to Runtime stream.",
        stale: true,
        retryInMs,
        lastEventId,
      };
    },
    reconnect({ lastEventId: connectedEventId = lastEventId } = {}) {
      lastEventId = connectedEventId;
      return {
        kind: "ready",
        message: "Runtime stream connected.",
        stale: false,
        lastEventId,
      };
    },
  };
}

function cloneProjection(projection) {
  return projection == null ? projection : { ...projection };
}
