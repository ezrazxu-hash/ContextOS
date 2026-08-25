import { createTemplateEditor } from "../../features/template-editor/TemplateEditor.js";

const DETAIL_SECTIONS = [
  { id: "basic", label: "Basic" },
  { id: "model", label: "Model" },
  { id: "prompt", label: "Prompt" },
  { id: "tools", label: "Tools" },
  { id: "context", label: "Context" },
  { id: "workflow", label: "Workflow" },
  { id: "ui", label: "UI" },
];
const RESTORE_MODES = ["auto", "ask", "manual"];

export function createTemplateWorkbench({ apiClient = {}, templates = [], initialTemplateId = null, capabilities = {}, estimateTokens = null } = {}) {
  const state = {
    templates: templates.map(normalizeTemplate),
    selectedTemplateId: initialTemplateId ?? templates[0]?.id ?? null,
    manifest: null,
    editor: null,
    dirty: false,
    searchQuery: "",
    switchGuard: { open: false, targetTemplateId: null },
    fieldErrors: new Map(),
    compile: null,
    testRun: null,
  };

  return {
    async loadSelectedTemplate() {
      if (!state.selectedTemplateId) {
        return this.view();
      }
      const response = apiClient.fetchTemplate
        ? await apiClient.fetchTemplate(state.selectedTemplateId)
        : { manifest: defaultManifest(state.selectedTemplateId) };
      state.manifest = cloneManifest(response.manifest);
      state.editor = createTemplateEditor(apiClient, state.manifest);
      state.dirty = false;
      state.switchGuard = { open: false, targetTemplateId: null };
      state.fieldErrors = new Map();
      state.compile = null;
      state.testRun = null;
      return this.view();
    },
    updateBasicDraft(patch) {
      if (!state.manifest) {
        throw new Error("Load a template before editing template details");
      }
      state.manifest.template = { ...state.manifest.template, ...patch };
      state.editor = createTemplateEditor(apiClient, state.manifest);
      state.dirty = true;
      return this.view();
    },
    updateModelDraft(model) {
      updateAgentConfig(state, { model });
      return this.view();
    },
    updatePromptDraft(prompt) {
      updateAgentConfig(state, { prompt });
      return this.view();
    },
    updateToolBindings(tools) {
      updateAgentConfig(state, { tools: [...tools] });
      return this.view();
    },
    updateContextBudgetDraft(patch) {
      ensureLoaded(state);
      state.manifest.context.budget = { ...state.manifest.context.budget, ...patch };
      state.dirty = true;
      return this.view();
    },
    updateRestorePolicyDraft(patch) {
      ensureLoaded(state);
      if (patch.mode && !RESTORE_MODES.includes(patch.mode)) {
        throw new Error(`Unknown restore mode: ${patch.mode}`);
      }
      state.manifest.context.restore = { ...state.manifest.context.restore, ...patch };
      state.dirty = true;
      return this.view();
    },
    async validateDraft() {
      ensureLoaded(state);
      const validation = apiClient.validateTemplate
        ? await apiClient.validateTemplate(cloneManifest(state.manifest))
        : { valid: true, issues: [] };
      state.fieldErrors = fieldErrorsFromValidation(validation);
      return validation;
    },
    async compileDraft() {
      ensureLoaded(state);
      const response = apiClient.compileTemplate
        ? await apiClient.compileTemplate(cloneManifest(state.manifest))
        : { status: 200, compiled: true };
      if (response.status === 200 || response.compiled) {
        state.compile = { status: "compiled" };
        state.fieldErrors = new Map();
        return state.compile;
      }
      const error = normalizeIssue(response.error ?? { field_path: "", code: "compile_failed" });
      state.compile = { status: "error", issue: error };
      state.fieldErrors = new Map([[error.fieldPath, error]]);
      return state.compile;
    },
    async runTestDraft(input = {}) {
      ensureLoaded(state);
      if (state.compile?.status !== "compiled") {
        state.testRun = { status: "blocked", reason: "compile_required", links: {} };
        return state.testRun;
      }
      try {
        const response = apiClient.runTemplate
          ? await apiClient.runTemplate(state.manifest.template.id, { graph_state: { input: input.input } })
          : { graph_state: {} };
        state.testRun = {
          status: "started",
          graphState: response.graph_state ?? {},
          links: runLinks(response),
        };
        return state.testRun;
      } catch (error) {
        state.testRun = { status: "failed", error: { message: error.message }, links: {} };
        return state.testRun;
      }
    },
    async saveDraft() {
      ensureLoaded(state);
      const localValidation = validateLocalTemplate(state.manifest, capabilities);
      if (!localValidation.valid) {
        state.fieldErrors = fieldErrorsFromValidation(localValidation);
        return { status: "blocked", reason: localValidation.error.code };
      }
      const response = apiClient.saveTemplate
        ? await apiClient.saveTemplate(cloneManifest(state.manifest))
        : { manifest: cloneManifest(state.manifest) };
      state.manifest = cloneManifest(response.manifest ?? state.manifest);
      state.editor = createTemplateEditor(apiClient, state.manifest);
      state.dirty = false;
      state.fieldErrors = new Map();
      return { status: "saved", manifest: cloneManifest(state.manifest) };
    },
    async requestTemplateSwitch(templateId, options = {}) {
      if (templateId === state.selectedTemplateId) {
        return { status: "selected", view: this.view() };
      }
      if (state.dirty && !options.discardChanges) {
        state.switchGuard = { open: true, targetTemplateId: templateId };
        return { status: "blocked", reason: "unsaved_changes" };
      }
      state.selectedTemplateId = templateId;
      await this.loadSelectedTemplate();
      return { status: "selected", view: this.view() };
    },
    searchTemplates(query) {
      state.searchQuery = String(query ?? "");
      return this.view().templateList;
    },
    view() {
      return {
        kind: "template-workbench",
        selectedTemplateId: state.selectedTemplateId,
        manifest: state.manifest ? cloneManifest(state.manifest) : null,
        templateList: {
          query: state.searchQuery,
          items: visibleTemplates(state.templates, state.searchQuery),
          emptyState: state.templates.length === 0 ? emptyTemplateListState() : null,
        },
        detail: {
          dirty: state.dirty,
          manifest: state.manifest ? cloneManifest(state.manifest) : null,
          sections: detailSections(state.manifest, capabilities, estimateTokens, state.fieldErrors),
        },
        compile: state.compile,
        testRun: state.testRun,
        switchGuard: { ...state.switchGuard },
        actions: {
          createTemplate: { enabled: true },
          runTest: { enabled: state.compile?.status === "compiled" },
        },
      };
    },
  };
}

function visibleTemplates(templates, query) {
  const normalizedQuery = query.trim().toLowerCase();
  const visible = normalizedQuery
    ? templates.filter((template) => {
        return `${template.id} ${template.name} ${template.status}`.toLowerCase().includes(normalizedQuery);
      })
    : templates;
  return visible.map((template) => ({ ...template }));
}

function normalizeTemplate(template) {
  return {
    id: template.id,
    name: template.name ?? template.id,
    version: template.version ?? null,
    status: template.status ?? "unknown",
  };
}

function detailSections(manifest, capabilities, estimateTokens, fieldErrors) {
  return DETAIL_SECTIONS.map((section) => ({
    ...section,
    fields: fieldsForSection(section.id, manifest, capabilities, estimateTokens, fieldErrors),
    ...(section.id === "workflow" ? { issues: workflowIssues(fieldErrors) } : {}),
  }));
}

function fieldsForSection(sectionId, manifest, capabilities, estimateTokens, fieldErrors) {
  if (!manifest) {
    return [];
  }
  if (sectionId === "basic") {
    return [
      { path: "template.id", value: manifest.template.id },
      { path: "template.name", value: manifest.template.name },
      { path: "template.version", value: manifest.template.version },
      { path: "template.status", value: manifest.template.status ?? "unknown" },
    ];
  }
  const agent = firstAgentNode(manifest);
  if (sectionId === "model" && agent) {
    return [
      {
        path: `graph.nodes[${agent.index}].config.model`,
        value: agent.node.config?.model ?? "",
        options: [...(capabilities.models ?? [])],
        error: fieldErrors.get(`graph.nodes[${agent.index}].config.model`) ?? null,
      },
    ];
  }
  if (sectionId === "prompt" && agent) {
    const value = agent.node.config?.prompt ?? "";
    return [
      {
        path: `graph.nodes[${agent.index}].config.prompt`,
        value,
        multiline: true,
        tokenEstimate: estimateTokens ? estimateTokens(value) : null,
        error: fieldErrors.get(`graph.nodes[${agent.index}].config.prompt`) ?? null,
      },
    ];
  }
  if (sectionId === "tools" && agent) {
    const selectedTools = new Set(agent.node.config?.tools ?? []);
    return [
      {
        path: `graph.nodes[${agent.index}].config.tools`,
        value: [...selectedTools],
        options: (capabilities.tools ?? []).map((tool) => ({
          id: tool.id,
          name: tool.name ?? tool.id,
          selected: selectedTools.has(tool.id),
          risk: tool.side_effect ? { kind: "side_effect", label: "Side effect" } : null,
        })),
        error: fieldErrors.get(`graph.nodes[${agent.index}].config.tools`) ?? null,
      },
    ];
  }
  if (sectionId === "context") {
    return contextFields(manifest, fieldErrors);
  }
  return [];
}

function workflowIssues(fieldErrors) {
  return [...fieldErrors.values()].filter((issue) => issue.fieldPath.startsWith("graph."));
}

function contextFields(manifest, fieldErrors) {
  const budget = manifest.context.budget;
  const restore = manifest.context.restore;
  const fields = [
    {
      path: "context.policy",
      value: manifest.context.policy,
      error: fieldErrors.get("context.policy") ?? null,
    },
    {
      path: "context.budget.high_watermark",
      value: budget.high_watermark,
      min: 0,
      max: 1,
      hint: watermarkHint(budget),
      error: fieldErrors.get("context.budget.high_watermark") ?? null,
    },
    {
      path: "context.budget.target_watermark",
      value: budget.target_watermark,
      min: 0,
      max: 1,
      hint: watermarkHint(budget),
      error: fieldErrors.get("context.budget.target_watermark") ?? null,
    },
    {
      path: "context.restore.mode",
      value: restore.mode,
      options: RESTORE_MODES,
      descriptions: {
        auto: "Restore automatically within limits",
        ask: "Ask before restoring context",
        manual: "Restore only when selected manually",
      },
      error: fieldErrors.get("context.restore.mode") ?? null,
    },
  ];
  if (restore.mode !== "manual") {
    fields.push(
      {
        path: "context.restore.max_tokens_per_restore",
        value: restore.max_tokens_per_restore,
        min: 0,
        error: fieldErrors.get("context.restore.max_tokens_per_restore") ?? null,
      },
      {
        path: "context.restore.max_restore_per_turn",
        value: restore.max_restore_per_turn,
        min: 0,
        error: fieldErrors.get("context.restore.max_restore_per_turn") ?? null,
      },
    );
  }
  return fields;
}

function watermarkHint(budget) {
  if (budget.target_watermark >= budget.high_watermark) {
    return {
      severity: "error",
      code: "target_below_high",
      message: "Target watermark must be lower than high watermark",
    };
  }
  return {
    severity: "info",
    code: "watermark_range",
    message: "Use values between 0 and 1",
  };
}

function emptyTemplateListState() {
  return {
    kind: "empty",
    title: "No templates yet",
    action: { id: "create-template", label: "New Template" },
  };
}

function defaultManifest(templateId) {
  return {
    template: { id: templateId, name: templateId, version: "1.0.0" },
    graph: { state_schema: "default_chat_state", nodes: [], edges: [] },
    context: {
      policy: "balanced",
      budget: { high_watermark: 0.8, target_watermark: 0.65 },
      restore: { mode: "auto", max_tokens_per_restore: 12000, max_restore_per_turn: 3 },
    },
    checkpoint: { enabled: true },
    ui: { editable_messages: true, expose_context_panel: true },
  };
}

function cloneManifest(manifest) {
  return JSON.parse(JSON.stringify(manifest));
}

function ensureLoaded(state) {
  if (!state.manifest) {
    throw new Error("Load a template before editing template details");
  }
}

function updateAgentConfig(state, patch) {
  ensureLoaded(state);
  const agent = firstAgentNode(state.manifest);
  if (!agent) {
    throw new Error("Template has no editable agent node");
  }
  agent.node.config = { ...(agent.node.config ?? {}), ...patch };
  state.editor = createTemplateEditor({}, state.manifest);
  state.dirty = true;
}

function firstAgentNode(manifest) {
  const index = manifest.graph.nodes.findIndex((node) => node.type === "agent");
  if (index < 0) {
    return null;
  }
  return { index, node: manifest.graph.nodes[index] };
}

function validateLocalTemplate(manifest, capabilities) {
  const agent = firstAgentNode(manifest);
  if (!agent || !capabilities.models?.length) {
    return { valid: true, issues: [] };
  }
  const model = agent.node.config?.model ?? "";
  if (!capabilities.models.includes(model)) {
    return {
      valid: false,
      error: {
        field_path: `graph.nodes[${agent.index}].config.model`,
        code: "model_not_allowed",
        message: "Model is not allowed by this template capability",
      },
    };
  }
  return { valid: true, issues: [] };
}

function fieldErrorsFromValidation(validation) {
  const issues = validation.issues ?? (validation.error ? [validation.error] : []);
  return new Map(issues.map((issue) => {
    const normalized = normalizeIssue(issue);
    return [normalized.fieldPath, normalized];
  }));
}

function normalizeIssue(issue) {
  const fieldPath = issue.fieldPath ?? issue.field_path ?? "";
  return {
    fieldPath,
    code: issue.code,
    ...(issue.message ? { message: issue.message } : {}),
  };
}

function runLinks(response) {
  const links = {};
  if (response.session_id && response.timeline_id) {
    links.chat = `/chat?sessionId=${encodeURIComponent(response.session_id)}&timelineId=${encodeURIComponent(response.timeline_id)}`;
  }
  if (response.session_id && response.trace_id) {
    links.debug = `/debug?sessionId=${encodeURIComponent(response.session_id)}&traceId=${encodeURIComponent(response.trace_id)}`;
  }
  return links;
}
