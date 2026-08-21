export function createEditActions(apiClient, state) {
  return {
    async contextOnly() {
      return apiClient.contextOnly(state.messageId, state.revisionId);
    },
    async continueFromHere() {
      const response = await apiClient.continueFromMessage(state.messageId, state.revisionId);
      state.currentTimelineId = response.timeline.id;
      return state.view();
    },
    async replayLater() {
      return apiClient.replayMessage(state.messageId, state.revisionId);
    },
  };
}
