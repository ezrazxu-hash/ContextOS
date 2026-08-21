import { createEditActions } from "./EditActions.js";

export function createMessageEditor(apiClient, message) {
  const state = {
    messageId: message.id,
    originalContent: message.content,
    draft: message.content,
    revisionId: null,
    impact: null,
    badge: null,
    currentTimelineId: null,
    editing: false,
    availableActions: [],
    view() {
      return {
        messageId: state.messageId,
        draft: state.draft,
        revisionId: state.revisionId,
        impact: state.impact,
        badge: state.badge,
        currentTimelineId: state.currentTimelineId,
        editing: state.editing,
        availableActions: [...state.availableActions],
      };
    },
  };

  return {
    get actions() {
      return createEditActions(apiClient, state);
    },
    startEdit() {
      state.editing = true;
      return state.view();
    },
    setDraft(content) {
      state.draft = content;
      return state.view();
    },
    async save(options = {}) {
      const payload = {
        new_content: state.draft,
        reason: options.reason,
      };
      const saveEdit = apiClient.patchMessage ?? apiClient.saveMessageEdit;
      const response = await saveEdit(state.messageId, payload);
      state.revisionId = response.revision_id;
      state.impact = response.impact;
      state.badge = "User Modified";
      state.editing = false;
      state.availableActions = ["CONTEXT_ONLY", "CONTINUE_FROM_HERE", "REPLAY_FOLLOWING"];
      return state.view();
    },
    cancel() {
      state.draft = state.originalContent;
      return state.view();
    },
    async viewOriginal() {
      const response = await apiClient.fetchOriginal(state.messageId);
      return response.original_content;
    },
  };
}
