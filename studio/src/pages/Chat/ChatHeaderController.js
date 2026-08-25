export function createChatHeaderController({ appShell, confirmSwitch = null, sessionFact = null } = {}) {
  const state = {
    draft: "",
    unsavedMessageEdit: false,
    streamStatus: "idle",
  };

  return {
    view() {
      return view(state, sessionFact);
    },
    setComposerDraft(draft) {
      state.draft = String(draft);
      return view(state, sessionFact);
    },
    setUnsavedMessageEdit(value) {
      state.unsavedMessageEdit = Boolean(value);
      return view(state, sessionFact);
    },
    setStreamStatus(status) {
      state.streamStatus = status;
      return view(state, sessionFact);
    },
    async switchSession(sessionId) {
      const guard = await guardSwitch(state, confirmSwitch);
      if (guard.status !== "ready") {
        return guard;
      }
      const shell = appShell.selectSession(sessionId);
      return { status: "switched", selection: shell.selection };
    },
    async switchTemplate(templateId) {
      const guard = await guardSwitch(state, confirmSwitch);
      if (guard.status !== "ready") {
        return guard;
      }
      const shell = appShell.selectTemplate(templateId);
      return {
        status: "switched",
        selection: shell.selection,
        sessionTemplateFact: sessionFact?.agent_template_id ?? null,
      };
    },
  };
}

async function guardSwitch(state, confirmSwitch) {
  const reason = dirtyReason(state);
  if (!reason) {
    return { status: "ready" };
  }
  const prompt = {
    reason,
    draft: state.draft,
    streamStatus: state.streamStatus,
    choices: state.streamStatus === "streaming" ? ["continue_in_background", "cancel_stream", "stay"] : ["discard_ui_state", "stay"],
  };
  if (!confirmSwitch) {
    return { status: "blocked", prompt };
  }
  const confirmed = await confirmSwitch(prompt);
  return confirmed ? { status: "ready" } : { status: "cancelled", prompt };
}

function dirtyReason(state) {
  if (state.unsavedMessageEdit) {
    return "unsaved_message_edit";
  }
  if (state.streamStatus === "streaming") {
    return "stream_in_progress";
  }
  if (state.draft.length > 0) {
    return "composer_draft";
  }
  return null;
}

function view(state, sessionFact) {
  return {
    draft: state.draft,
    dirtyReason: dirtyReason(state),
    streamStatus: state.streamStatus,
    sessionTemplateFact: sessionFact?.agent_template_id ?? null,
  };
}
