export function createEditActions(apiClient, state) {
  return {
    async contextOnly() {
      return apiClient.contextOnly(state.messageId, state.revisionId);
    },
    async continueFromHere() {
      const response = await apiClient.continueFromMessage(state.messageId, state.revisionId);
      state.currentTimelineId = response.timeline.id;
      state.navigation = {
        url: chatTimelineUrl(state.sessionId, response.timeline.id),
      };
      return state.view();
    },
    async replayLater() {
      return {
        status: "plan_required",
        command: "open_replay_plan",
        messageId: state.messageId,
        revisionId: state.revisionId,
      };
    },
  };
}

function chatTimelineUrl(sessionId, timelineId) {
  const params = new URLSearchParams();
  if (sessionId) {
    params.set("sessionId", sessionId);
  }
  params.set("timelineId", timelineId);
  return `/chat?${params.toString()}`;
}
