export function createWorkflowV2DraftStore(apiClient, options = {}) {
  if (!apiClient?.fetchWorkflow || !apiClient?.saveWorkflowDraft) {
    throw new Error("fetchWorkflow and saveWorkflowDraft are required");
  }

  const debounceMs = Number(options.debounceMs ?? 750);
  const state = {
    definition: null,
    dirty: false,
    status: "idle",
    autosaveTimer: null,
    autosavePromise: null,
    conflict: null,
  };

  async function saveNow() {
    if (!state.definition || !state.dirty) {
      return state.definition;
    }
    clearAutosaveTimer(state);
    state.status = "saving";
    try {
      const saved = await apiClient.saveWorkflowDraft(state.definition.id, clone(state.definition));
      state.definition = clone(saved);
      state.dirty = false;
      state.status = "saved";
      state.conflict = null;
      return state.definition;
    } catch (error) {
      state.status = "error";
      if (error?.status === 409 || error?.code === "workflow.revision_conflict") {
        state.conflict = { code: "workflow.revision_conflict", message: error.message };
      }
      throw error;
    } finally {
      state.autosavePromise = null;
    }
  }

  function scheduleAutosave() {
    clearAutosaveTimer(state);
    state.autosavePromise = new Promise((resolve, reject) => {
      state.autosaveTimer = setTimeout(() => {
        saveNow().then(resolve, reject);
      }, debounceMs);
    });
  }

  return {
    async open(workflowId) {
      clearAutosaveTimer(state);
      state.status = "loading";
      state.definition = clone(await apiClient.fetchWorkflow(workflowId));
      state.dirty = false;
      state.status = "saved";
      state.conflict = null;
      return this.view();
    },
    updateDraft(patch) {
      if (!state.definition) {
        throw new Error("Open a workflow before editing its draft");
      }
      state.definition = { ...state.definition, ...clone(patch) };
      state.dirty = true;
      state.status = "dirty";
      scheduleAutosave();
      return this.view();
    },
    async flushAutosave() {
      if (!state.dirty) {
        return this.view();
      }
      await saveNow();
      return this.view();
    },
    view() {
      return {
        definition: state.definition ? clone(state.definition) : null,
        workflowId: state.definition?.id ?? null,
        schemaVersion: state.definition?.schemaVersion ?? null,
        revision: state.definition?.revision ?? null,
        dirty: state.dirty,
        status: state.status,
        conflict: state.conflict ? { ...state.conflict } : null,
      };
    },
  };
}

function clearAutosaveTimer(state) {
  if (state.autosaveTimer) {
    clearTimeout(state.autosaveTimer);
    state.autosaveTimer = null;
  }
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}
