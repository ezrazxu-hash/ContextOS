export { queryKeys } from "../client-core/queryKeys.js";
import { queryKeys, serializeQueryKey } from "../client-core/queryKeys.js";

export function createProjectionCache(apiClient = {}) {
  const values = new Map();

  return {
    get(key) {
      return values.get(serializeQueryKey(key));
    },
    set(key, value) {
      values.set(serializeQueryKey(key), value);
      return value;
    },
    async rehydrateSession(sessionId) {
      const snapshot = await apiClient.fetchRuntimeSnapshot(sessionId);
      values.set(serializeQueryKey(queryKeys.snapshot(sessionId)), snapshot);
      return snapshot;
    },
    invalidateAffected(keys) {
      for (const key of keys) {
        values.delete(serializeQueryKey(key));
      }
      return keys;
    },
  };
}
