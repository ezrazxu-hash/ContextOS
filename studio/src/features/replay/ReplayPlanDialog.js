const AVAILABLE_ACTIONS = ["USE_HISTORY", "REINVOKE", "SKIP", "CANCEL"];
const HIGH_RISK_SIDE_EFFECTS = new Set(["WRITE", "EXTERNAL_WRITE", "DESTRUCTIVE", "FINANCIAL"]);

export function createReplayPlanDialog(apiClient, options) {
  const state = {
    selectedAction: defaultActionFor(options.toolCall),
    confirmationToken: null,
  };

  return {
    view() {
      return {
        availableActions: [...AVAILABLE_ACTIONS],
        selectedAction: state.selectedAction,
        requiresConfirmation: requiresConfirmation(options.toolCall, state.selectedAction),
      };
    },
    selectAction(action) {
      if (!AVAILABLE_ACTIONS.includes(action)) {
        throw new Error(`Unknown replay action: ${action}`);
      }
      state.selectedAction = action;
      return this.view();
    },
    setConfirmationToken(token) {
      state.confirmationToken = token;
      return this.view();
    },
    async submit() {
      if (requiresConfirmation(options.toolCall, state.selectedAction) && !state.confirmationToken) {
        return { status: "blocked", reason: "confirmation_required" };
      }
      return apiClient.replayPlan({
        parent_timeline_id: options.parentTimelineId,
        fork_checkpoint_id: options.forkCheckpointId,
        fork_message_id: options.forkMessageId,
        idempotency_key: options.idempotencyKey,
        decisions: [
          {
            tool_call_id: options.toolCall.tool_call_id,
            tool_id: options.toolCall.tool_id,
            action: state.selectedAction,
            confirmation_token: state.confirmationToken,
          },
        ],
      });
    },
  };
}

function defaultActionFor(toolCall) {
  if (HIGH_RISK_SIDE_EFFECTS.has(toolCall.side_effect)) {
    return "USE_HISTORY";
  }
  return "REINVOKE";
}

function requiresConfirmation(toolCall, action) {
  return action === "REINVOKE" && HIGH_RISK_SIDE_EFFECTS.has(toolCall.side_effect);
}
