export function createRuntimeProjectionStore(apiClient) {
  let snapshot = null;

  return {
    getSnapshot() {
      return snapshot;
    },
    async rehydrate(sessionId) {
      snapshot = await apiClient.fetchRehydrateSnapshot(sessionId);
      return snapshot;
    },
  };
}
