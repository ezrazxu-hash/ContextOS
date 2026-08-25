export function createContextApiClient(transport) {
  return {
    fetchSessionContext(sessionId) {
      return transport.getSessionContext(sessionId);
    },
    pinGroup(groupId) {
      return transport.postContextGroupPin(groupId);
    },
    unpinGroup(groupId) {
      return transport.postContextGroupUnpin(groupId);
    },
    abstractGroup(groupId, payload) {
      return transport.postContextGroupAbstract(groupId, payload);
    },
    evictGroup(groupId) {
      return transport.postContextGroupEvict(groupId);
    },
    restoreGroup(groupId) {
      return transport.postContextGroupRestore(groupId);
    },
    fetchRaw(itemId) {
      return transport.getContextItemRaw(itemId);
    },
    fetchRevisions(itemId) {
      return transport.getContextItemRevisions(itemId);
    },
    restoreSystemVersion(itemId) {
      return transport.postContextItemRestoreSystem(itemId);
    },
  };
}
