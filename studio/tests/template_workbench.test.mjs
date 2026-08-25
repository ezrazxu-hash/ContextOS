import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\tests$/, "");

function moduleUrl(relativePath) {
  return pathToFileURL(join(studioRoot, relativePath)).href;
}

function manifest(id, overrides = {}) {
  const node = overrides.node ?? { id: "writer", type: "output", config: { output_key: "answer", output: id } };
  return {
    template: {
      id,
      name: overrides.name ?? id,
      version: overrides.version ?? "1.0.0",
      status: overrides.status ?? "draft",
    },
    graph: {
      state_schema: "default_chat_state",
      nodes: [node],
      edges: [{ from: "START", to: node.id }, { from: node.id, to: "END" }],
    },
    context: {
      policy: "balanced",
      budget: { high_watermark: 0.8, target_watermark: 0.65 },
      restore: { mode: "auto", max_tokens_per_restore: 12000, max_restore_per_turn: 3 },
    },
    checkpoint: { enabled: true },
    ui: { editable_messages: true, expose_context_panel: true },
  };
}

test("UI06-T01-TC01: switching template does not mix detail form state", async () => {
  const { createTemplateWorkbench } = await import(moduleUrl("src/pages/Template/TemplateWorkbench.js"));
  const workbench = createTemplateWorkbench({
    apiClient: {
      async fetchTemplate(templateId) {
        return { manifest: manifest(templateId, { name: templateId === "agent-a" ? "Agent A" : "Agent B" }) };
      },
    },
    templates: [
      { id: "agent-a", name: "Agent A", version: "1.0.0", status: "draft" },
      { id: "agent-b", name: "Agent B", version: "2.0.0", status: "published" },
    ],
    initialTemplateId: "agent-a",
  });

  await workbench.loadSelectedTemplate();
  workbench.updateBasicDraft({ name: "Unsaved Agent A" });
  await workbench.requestTemplateSwitch("agent-b", { discardChanges: true });

  const view = workbench.view();
  assert.equal(view.selectedTemplateId, "agent-b");
  assert.equal(view.detail.sections[0].id, "basic");
  assert.equal(view.detail.sections[0].fields.find((field) => field.path === "template.name").value, "Agent B");
  assert.equal(view.detail.dirty, false);
});

test("UI06-T01-TC02: unsaved changes guard template switching", async () => {
  const { createTemplateWorkbench } = await import(moduleUrl("src/pages/Template/TemplateWorkbench.js"));
  const workbench = createTemplateWorkbench({
    apiClient: {
      async fetchTemplate(templateId) {
        return { manifest: manifest(templateId) };
      },
    },
    templates: [
      { id: "agent-a", name: "Agent A", version: "1.0.0", status: "draft" },
      { id: "agent-b", name: "Agent B", version: "1.0.0", status: "draft" },
    ],
    initialTemplateId: "agent-a",
  });

  await workbench.loadSelectedTemplate();
  workbench.updateBasicDraft({ name: "Unsaved Agent A" });
  const blocked = await workbench.requestTemplateSwitch("agent-b");

  const view = workbench.view();
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.reason, "unsaved_changes");
  assert.equal(view.selectedTemplateId, "agent-a");
  assert.equal(view.switchGuard.open, true);
  assert.equal(view.detail.dirty, true);
});

test("UI06-T01-TC03: empty template list exposes create entry", async () => {
  const { createTemplateWorkbench } = await import(moduleUrl("src/pages/Template/TemplateWorkbench.js"));

  const workbench = createTemplateWorkbench({ apiClient: {}, templates: [] });
  const view = workbench.view();

  assert.deepEqual(view.templateList.items, []);
  assert.equal(view.templateList.emptyState.kind, "empty");
  assert.equal(view.templateList.emptyState.action.id, "create-template");
  assert.equal(view.actions.createTemplate.enabled, true);
});

test("UI06-T02-TC01: unavailable model cannot be submitted", async () => {
  const { createTemplateWorkbench } = await import(moduleUrl("src/pages/Template/TemplateWorkbench.js"));
  const saved = [];
  const workbench = createTemplateWorkbench({
    apiClient: {
      async fetchTemplate(templateId) {
        return {
          manifest: manifest(templateId, {
            node: { id: "planner", type: "agent", config: { model: "default", prompt: "Plan", tools: [] } },
          }),
        };
      },
      async saveTemplate(payload) {
        saved.push(payload.graph.nodes[0].config.model);
        return { manifest: payload };
      },
    },
    capabilities: { models: ["default"], tools: [] },
    templates: [{ id: "agent-a", name: "Agent A", version: "1.0.0", status: "draft" }],
    initialTemplateId: "agent-a",
  });

  await workbench.loadSelectedTemplate();
  workbench.updateModelDraft("unsupported-model");
  const result = await workbench.saveDraft();

  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "model_not_allowed");
  assert.deepEqual(saved, []);
  assert.equal(workbench.view().detail.sections.find((section) => section.id === "model").fields[0].error.code, "model_not_allowed");
});

test("UI06-T02-TC02: Tool side effect label is visible", async () => {
  const { createTemplateWorkbench } = await import(moduleUrl("src/pages/Template/TemplateWorkbench.js"));
  const workbench = createTemplateWorkbench({
    apiClient: {
      async fetchTemplate(templateId) {
        return {
          manifest: manifest(templateId, {
            node: { id: "planner", type: "agent", config: { model: "default", prompt: "Plan", tools: ["send_email"] } },
          }),
        };
      },
    },
    capabilities: {
      models: ["default"],
      tools: [
        { id: "web_search", name: "Web Search", side_effect: false },
        { id: "send_email", name: "Send Email", side_effect: true },
      ],
    },
    templates: [{ id: "agent-a", name: "Agent A", version: "1.0.0", status: "draft" }],
    initialTemplateId: "agent-a",
  });

  await workbench.loadSelectedTemplate();
  const tools = workbench.view().detail.sections.find((section) => section.id === "tools").fields[0].options;

  assert.deepEqual(
    tools.map((tool) => ({ id: tool.id, selected: tool.selected, risk: tool.risk })),
    [
      { id: "web_search", selected: false, risk: null },
      { id: "send_email", selected: true, risk: { kind: "side_effect", label: "Side effect" } },
    ],
  );
});

test("UI06-T02-TC03: server validation error maps back to the matching field", async () => {
  const { createTemplateWorkbench } = await import(moduleUrl("src/pages/Template/TemplateWorkbench.js"));
  const workbench = createTemplateWorkbench({
    apiClient: {
      async fetchTemplate(templateId) {
        return {
          manifest: manifest(templateId, {
            node: { id: "planner", type: "agent", config: { model: "default", prompt: "Plan", tools: [] } },
          }),
        };
      },
      async validateTemplate() {
        return {
          valid: false,
          error: { field_path: "graph.nodes[0].config.model", code: "model_unavailable", message: "Model is disabled" },
        };
      },
    },
    capabilities: { models: ["default"], tools: [] },
    templates: [{ id: "agent-a", name: "Agent A", version: "1.0.0", status: "draft" }],
    initialTemplateId: "agent-a",
  });

  await workbench.loadSelectedTemplate();
  const validation = await workbench.validateDraft();
  const modelField = workbench.view().detail.sections.find((section) => section.id === "model").fields[0];

  assert.equal(validation.valid, false);
  assert.deepEqual(modelField.error, {
    fieldPath: "graph.nodes[0].config.model",
    code: "model_unavailable",
    message: "Model is disabled",
  });
});

test("UI06-T02-TC04: prompt supports multiline draft and token estimate", async () => {
  const { createTemplateWorkbench } = await import(moduleUrl("src/pages/Template/TemplateWorkbench.js"));
  const workbench = createTemplateWorkbench({
    apiClient: {
      async fetchTemplate(templateId) {
        return {
          manifest: manifest(templateId, {
            node: { id: "planner", type: "agent", config: { model: "default", prompt: "Plan", tools: [] } },
          }),
        };
      },
    },
    capabilities: { models: ["default"], tools: [] },
    estimateTokens(prompt) {
      return prompt.split(/\s+/).filter(Boolean).length;
    },
    templates: [{ id: "agent-a", name: "Agent A", version: "1.0.0", status: "draft" }],
    initialTemplateId: "agent-a",
  });

  await workbench.loadSelectedTemplate();
  workbench.updatePromptDraft("First line\nSecond line");
  const promptField = workbench.view().detail.sections.find((section) => section.id === "prompt").fields[0];

  assert.equal(promptField.multiline, true);
  assert.equal(promptField.value, "First line\nSecond line");
  assert.equal(promptField.tokenEstimate, 4);
});

test("UI06-T03-TC01: target >= high shows frontend hint and backend still validates", async () => {
  const { createTemplateWorkbench } = await import(moduleUrl("src/pages/Template/TemplateWorkbench.js"));
  let validateCalls = 0;
  const workbench = createTemplateWorkbench({
    apiClient: {
      async fetchTemplate(templateId) {
        return { manifest: manifest(templateId) };
      },
      async validateTemplate() {
        validateCalls += 1;
        return {
          valid: false,
          error: { field_path: "context.budget.target_watermark", code: "watermark_order", message: "Target must be below high" },
        };
      },
    },
    templates: [{ id: "agent-a", name: "Agent A", version: "1.0.0", status: "draft" }],
    initialTemplateId: "agent-a",
  });

  await workbench.loadSelectedTemplate();
  workbench.updateContextBudgetDraft({ high_watermark: 0.7, target_watermark: 0.75 });
  const localField = workbench.view().detail.sections.find((section) => section.id === "context").fields
    .find((field) => field.path === "context.budget.target_watermark");
  const validation = await workbench.validateDraft();

  assert.equal(localField.hint.code, "target_below_high");
  assert.equal(validation.valid, false);
  assert.equal(validateCalls, 1);
});

test("UI06-T03-TC02: restore.mode toggles restore limit fields", async () => {
  const { createTemplateWorkbench } = await import(moduleUrl("src/pages/Template/TemplateWorkbench.js"));
  const workbench = createTemplateWorkbench({
    apiClient: {
      async fetchTemplate(templateId) {
        return { manifest: manifest(templateId) };
      },
    },
    templates: [{ id: "agent-a", name: "Agent A", version: "1.0.0", status: "draft" }],
    initialTemplateId: "agent-a",
  });

  await workbench.loadSelectedTemplate();
  workbench.updateRestorePolicyDraft({ mode: "manual" });
  const manualFields = workbench.view().detail.sections.find((section) => section.id === "context").fields;
  workbench.updateRestorePolicyDraft({ mode: "auto" });
  const autoFields = workbench.view().detail.sections.find((section) => section.id === "context").fields;

  assert.deepEqual(manualFields.find((field) => field.path === "context.restore.mode").options, ["auto", "ask", "manual"]);
  assert.ok(!manualFields.some((field) => field.path === "context.restore.max_tokens_per_restore"));
  assert.ok(autoFields.some((field) => field.path === "context.restore.max_tokens_per_restore"));
  assert.ok(autoFields.some((field) => field.path === "context.restore.max_restore_per_turn"));
});

test("UI06-T03-TC03: saved context policy reloads without losing values", async () => {
  const { createTemplateWorkbench } = await import(moduleUrl("src/pages/Template/TemplateWorkbench.js"));
  let storedManifest = manifest("agent-a");
  const workbench = createTemplateWorkbench({
    apiClient: {
      async fetchTemplate() {
        return { manifest: storedManifest };
      },
      async saveTemplate(payload) {
        storedManifest = payload;
        return { manifest: storedManifest };
      },
    },
    templates: [{ id: "agent-a", name: "Agent A", version: "1.0.0", status: "draft" }],
    initialTemplateId: "agent-a",
  });

  await workbench.loadSelectedTemplate();
  workbench.updateContextBudgetDraft({ high_watermark: 0.9, target_watermark: 0.6 });
  workbench.updateRestorePolicyDraft({ mode: "ask", max_tokens_per_restore: 8000, max_restore_per_turn: 2 });
  await workbench.saveDraft();
  await workbench.loadSelectedTemplate();
  const contextFields = workbench.view().detail.sections.find((section) => section.id === "context").fields;

  assert.equal(contextFields.find((field) => field.path === "context.budget.high_watermark").value, 0.9);
  assert.equal(contextFields.find((field) => field.path === "context.budget.target_watermark").value, 0.6);
  assert.equal(contextFields.find((field) => field.path === "context.restore.mode").value, "ask");
  assert.equal(contextFields.find((field) => field.path === "context.restore.max_tokens_per_restore").value, 8000);
  assert.equal(contextFields.find((field) => field.path === "context.restore.max_restore_per_turn").value, 2);
});

test("UI06-T04-TC01: compile error can locate workflow node field", async () => {
  const { createTemplateWorkbench } = await import(moduleUrl("src/pages/Template/TemplateWorkbench.js"));
  const workbench = createTemplateWorkbench({
    apiClient: {
      async fetchTemplate(templateId) {
        return {
          manifest: manifest(templateId, {
            node: { id: "review", type: "custom", extension: "extensions.missing", config: {} },
          }),
        };
      },
      async compileTemplate() {
        return {
          status: 400,
          error: { field_path: "graph.nodes[0].extension", code: "unknown_extension", message: "Extension not found" },
        };
      },
    },
    templates: [{ id: "agent-a", name: "Agent A", version: "1.0.0", status: "draft" }],
    initialTemplateId: "agent-a",
  });

  await workbench.loadSelectedTemplate();
  const result = await workbench.compileDraft();
  const workflowSection = workbench.view().detail.sections.find((section) => section.id === "workflow");

  assert.equal(result.status, "error");
  assert.deepEqual(workflowSection.issues, [
    { fieldPath: "graph.nodes[0].extension", code: "unknown_extension", message: "Extension not found" },
  ]);
});

test("UI06-T04-TC02: successful test run exposes session and Debug links", async () => {
  const { createTemplateWorkbench } = await import(moduleUrl("src/pages/Template/TemplateWorkbench.js"));
  const workbench = createTemplateWorkbench({
    apiClient: {
      async fetchTemplate(templateId) {
        return { manifest: manifest(templateId) };
      },
      async compileTemplate() {
        return { status: 200, compiled: true };
      },
      async runTemplate(templateId, payload) {
        return {
          session_id: "test-session",
          timeline_id: "test-timeline",
          trace_id: "test-trace",
          graph_state: { answer: payload.graph_state.input },
        };
      },
    },
    templates: [{ id: "agent-a", name: "Agent A", version: "1.0.0", status: "draft" }],
    initialTemplateId: "agent-a",
  });

  await workbench.loadSelectedTemplate();
  await workbench.compileDraft();
  const run = await workbench.runTestDraft({ input: "hello" });
  const view = workbench.view();

  assert.equal(run.status, "started");
  assert.equal(view.testRun.status, "started");
  assert.deepEqual(view.testRun.links, {
    chat: "/chat?sessionId=test-session&timelineId=test-timeline",
    debug: "/debug?sessionId=test-session&traceId=test-trace",
  });
});

test("UI06-T04-TC03: failed run does not mark template as published", async () => {
  const { createTemplateWorkbench } = await import(moduleUrl("src/pages/Template/TemplateWorkbench.js"));
  const workbench = createTemplateWorkbench({
    apiClient: {
      async fetchTemplate(templateId) {
        return { manifest: manifest(templateId, { status: "draft" }) };
      },
      async compileTemplate() {
        return { status: 200, compiled: true };
      },
      async runTemplate() {
        throw new Error("runtime unavailable");
      },
    },
    templates: [{ id: "agent-a", name: "Agent A", version: "1.0.0", status: "draft" }],
    initialTemplateId: "agent-a",
  });

  await workbench.loadSelectedTemplate();
  await workbench.compileDraft();
  const run = await workbench.runTestDraft({ input: "hello" });
  const view = workbench.view();

  assert.equal(run.status, "failed");
  assert.equal(view.testRun.status, "failed");
  assert.equal(view.manifest.template.status, "draft");
});
