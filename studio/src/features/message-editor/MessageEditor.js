import { createEditActions } from "./EditActions.js";

export function createMessageEditor(apiClient, message) {
  const state = {
    messageId: message.id,
    sessionId: message.session_id ?? message.sessionId ?? null,
    parentTimelineId: message.timeline_id ?? message.timelineId ?? null,
    originalContent: message.content,
    draft: message.content,
    revisionId: null,
    impact: null,
    impactSummary: null,
    badge: null,
    error: null,
    mode: "View",
    selectedMessageId: null,
    currentTimelineId: null,
    navigation: null,
    editing: false,
    availableActions: [],
    view() {
      return {
        messageId: state.messageId,
        draft: state.draft,
        revisionId: state.revisionId,
        impact: state.impact,
        impactSummary: state.impactSummary,
        badge: state.badge,
        error: state.error,
        mode: state.mode,
        selectedMessageId: state.selectedMessageId,
        currentTimelineId: state.currentTimelineId,
        navigation: state.navigation,
        editing: state.editing,
        availableActions: [...state.availableActions],
        actionBar: actionBarView(state),
      };
    },
  };

  return {
    get actions() {
      return createEditActions(apiClient, state);
    },
    startEdit() {
      state.editing = true;
      state.mode = "Editing";
      state.error = null;
      state.navigation = null;
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
      state.mode = "Saving";
      state.error = null;
      let response;
      try {
        response = await saveEdit(state.messageId, payload);
      } catch (error) {
        state.mode = "Editing";
        state.editing = true;
        state.error = {
          message: error?.message ?? "Save failed",
        };
        return state.view();
      }
      state.revisionId = response.revision_id;
      state.impact = response.impact;
      state.impactSummary = summarizeImpact(response.impact);
      state.badge = "User Modified";
      state.editing = false;
      state.mode = "ImpactReady";
      state.selectedMessageId = state.messageId;
      state.availableActions = ["CONTEXT_ONLY", "CONTINUE_FROM_HERE", "REPLAY_FOLLOWING"];
      return state.view();
    },
    cancel() {
      state.draft = state.originalContent;
      state.editing = false;
      state.mode = "View";
      state.error = null;
      return state.view();
    },
    handleKey(event) {
      if (event.key === "Escape" && state.editing) {
        return this.cancel();
      }
      return state.view();
    },
    async viewOriginal() {
      const response = await apiClient.fetchOriginal(state.messageId);
      return response.original_content;
    },
    actionBar() {
      return actionBarView(state);
    },
  };
}

function summarizeImpact(impact) {
  if (!impact) {
    return null;
  }
  return {
    triggered: Boolean(impact.triggered),
    requiresReplay: Boolean(impact.requires_replay ?? impact.requiresReplay),
    checkCount: (impact.checks ?? []).length,
    issueCount: (impact.issues ?? []).length,
  };
}

function actionBarView(state) {
  if (!state.revisionId) {
    return { visible: false, anchorMessageId: state.messageId, actions: [] };
  }
  return {
    visible: true,
    anchorMessageId: state.messageId,
    actions: [
      {
        id: "context-only",
        command: "context_only",
        label: "Only update context",
        description: "Apply the edited message to working context without continuing execution.",
      },
      {
        id: "continue-from-here",
        command: "continue_from_here",
        label: "Continue from here",
        description: "Fork a new timeline from this edited message and continue forward.",
      },
      {
        id: "replay-following",
        command: "open_replay_plan",
        label: "Replay following flow",
        description: "Open a replay plan before any historical tool is reinvoked.",
      },
    ],
  };
}
