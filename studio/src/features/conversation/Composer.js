export function createComposer({ apiClient, sessionId, timelineId, allowedModels = [], template = null }) {
  const state = {
    draft: "",
    status: "idle",
    error: null,
    inFlight: null,
    selectedModel: firstAllowedModel(allowedModels, template),
  };

  return {
    view() {
      return view(state, allowedModels, template);
    },
    setDraft(value) {
      state.draft = String(value);
      state.error = null;
      return view(state, allowedModels, template);
    },
    handleKeyDown(event) {
      if (event.key !== "Enter") {
        return { status: "ignored", reason: "unsupported_key" };
      }
      if (event.isComposing) {
        return { status: "ignored", reason: "composing" };
      }
      if (event.shiftKey) {
        state.draft = `${state.draft}\n`;
        return { status: "newline" };
      }
      return this.submit();
    },
    submit() {
      if (state.inFlight) {
        return state.inFlight;
      }
      const content = state.draft;
      if (!content.trim()) {
        return Promise.resolve(view(state, allowedModels, template));
      }
      state.inFlight = submitDraft({ apiClient, sessionId, timelineId, state, content, allowedModels, template }).finally(() => {
        state.inFlight = null;
      });
      return state.inFlight;
    },
  };
}

async function submitDraft({ apiClient, sessionId, timelineId, state, content, allowedModels, template }) {
  state.status = "sending";
  state.error = null;
  state.draft = "";
  try {
    await sendUserMessage(apiClient, sessionId, {
      role: "user",
      content,
      timeline_id: timelineId,
      model: state.selectedModel,
    });
    state.status = "streaming";
    if (apiClient.streamChatEvents) {
      for await (const _event of apiClient.streamChatEvents({ session_id: sessionId, timeline_id: timelineId, content, model: state.selectedModel })) {
        // Message rendering is driven by the stream reducer; Composer only owns input state.
      }
    }
    state.status = "idle";
  } catch (error) {
    state.status = "failed";
    state.error = { message: error?.message ?? "Send failed" };
    state.draft = content;
  }
  return view(state, allowedModels, template);
}

function sendUserMessage(apiClient, sessionId, payload) {
  if (apiClient.postSessionMessage) {
    return apiClient.postSessionMessage(sessionId, payload);
  }
  return apiClient.sendMessage(sessionId, payload);
}

function view(state, allowedModels, template) {
  return {
    draft: state.draft,
    status: state.status,
    error: state.error,
    models: allowedModelList(allowedModels, template),
    selectedModel: state.selectedModel,
    localMessages: [],
  };
}

function firstAllowedModel(allowedModels, template) {
  return allowedModelList(allowedModels, template)[0] ?? null;
}

function allowedModelList(allowedModels, template) {
  return allowedModels.length > 0 ? [...allowedModels] : [...(template?.allowed_models ?? template?.allowedModels ?? [])];
}
