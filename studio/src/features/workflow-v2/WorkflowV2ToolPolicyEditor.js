const TOOL_POLICY_MODES = ["auto", "required", "disabled"];

export function createWorkflowV2ToolPolicyEditor(options = {}) {
  const state = {
    apiClient: options.apiClient ?? null,
    catalog: Array.isArray(options.catalog) ? options.catalog.map(cloneTool) : [],
    workflowTools: Array.isArray(options.workflowTools) ? [...options.workflowTools] : [],
    policy: normalizePolicy(options.policy ?? { mode: "disabled", allowedTools: [], requiredTools: [] }),
  };

  return {
    async loadCatalog() {
      const response = state.apiClient?.listWorkflowTools
        ? await state.apiClient.listWorkflowTools()
        : { tools: [] };
      state.catalog = Array.isArray(response?.tools) ? response.tools.map(cloneTool) : [];
      return this.view();
    },
    setWorkflowTools(toolIds) {
      state.workflowTools = Array.isArray(toolIds) ? toolIds.map(String) : [];
      return this.view();
    },
    setMode(mode) {
      const normalizedMode = String(mode).toLowerCase();
      if (!TOOL_POLICY_MODES.includes(normalizedMode)) {
        throw new Error(`Unsupported tool policy mode: ${mode}`);
      }
      state.policy.mode = normalizedMode;
      if (normalizedMode === "disabled") {
        state.policy.allowedTools = [];
        state.policy.requiredTools = [];
      }
      return this.view();
    },
    toggleAllowedTool(toolId, enabled) {
      assertSelectionEnabled(state);
      state.policy.allowedTools = toggleList(state.policy.allowedTools, toolId, enabled);
      if (!state.policy.allowedTools.includes(toolId)) {
        state.policy.requiredTools = state.policy.requiredTools.filter((candidate) => candidate !== toolId);
      }
      return this.view();
    },
    toggleRequiredTool(toolId, enabled) {
      assertSelectionEnabled(state);
      state.policy.requiredTools = toggleList(state.policy.requiredTools, toolId, enabled);
      return this.view();
    },
    setPolicy(policy) {
      state.policy = normalizePolicy(policy);
      if (state.policy.mode === "disabled") {
        state.policy.allowedTools = [];
        state.policy.requiredTools = [];
      }
      return this.view();
    },
    validate() {
      const errors = [];
      const workflowTools = new Set(state.workflowTools);
      const catalog = new Set(state.catalog.map((tool) => tool.id));
      state.policy.allowedTools.forEach((toolId, index) => {
        if (!workflowTools.has(toolId)) {
          errors.push({ code: "node_tool_not_in_workflow_registry", field: `toolPolicy.allowedTools[${index}]`, message: `Tool is not enabled for this workflow: ${toolId}` });
        }
        if (catalog.size && !catalog.has(toolId)) {
          errors.push({ code: "unknown_agent_tool", field: `toolPolicy.allowedTools[${index}]`, message: `Unknown tool: ${toolId}` });
        }
      });
      state.policy.requiredTools.forEach((toolId, index) => {
        if (!state.policy.allowedTools.includes(toolId)) {
          errors.push({ code: "required_tool_not_allowed", field: `toolPolicy.requiredTools[${index}]`, message: `Required tool must also be allowed: ${toolId}` });
        }
        if (!workflowTools.has(toolId)) {
          errors.push({ code: "node_tool_not_in_workflow_registry", field: `toolPolicy.requiredTools[${index}]`, message: `Tool is not enabled for this workflow: ${toolId}` });
        }
        if (catalog.size && !catalog.has(toolId)) {
          errors.push({ code: "unknown_agent_tool", field: `toolPolicy.requiredTools[${index}]`, message: `Unknown tool: ${toolId}` });
        }
      });
      return { valid: errors.length === 0, errors };
    },
    view() {
      return {
        catalog: { items: state.catalog.map(cloneTool) },
        workflowTools: { selectedIds: [...state.workflowTools] },
        policy: clonePolicy(state.policy),
        validation: this.validate(),
      };
    },
  };
}

function normalizePolicy(policy) {
  const mode = TOOL_POLICY_MODES.includes(String(policy?.mode ?? "disabled").toLowerCase())
    ? String(policy?.mode ?? "disabled").toLowerCase()
    : "disabled";
  return {
    mode,
    allowedTools: mode === "disabled" ? [] : uniqueStrings(policy?.allowedTools),
    requiredTools: mode === "disabled" ? [] : uniqueStrings(policy?.requiredTools),
  };
}

function assertSelectionEnabled(state) {
  if (state.policy.mode === "disabled") {
    throw new Error("Tool selection is disabled for this Agent node");
  }
}

function toggleList(items, item, enabled) {
  const value = String(item);
  const without = items.filter((candidate) => candidate !== value);
  return enabled ? [...without, value] : without;
}

function uniqueStrings(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.map(String).filter(Boolean))];
}

function cloneTool(tool) {
  return JSON.parse(JSON.stringify(tool));
}

function clonePolicy(policy) {
  return {
    mode: policy.mode,
    allowedTools: [...policy.allowedTools],
    requiredTools: [...policy.requiredTools],
  };
}
