import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\tests$/, "");

function moduleUrl(relativePath) {
  return pathToFileURL(join(studioRoot, relativePath)).href;
}

test("T02 V2 workbench exposes editable canvas state and basic inspector selection", async () => {
  const { createWorkflowV2Workbench } = await import(moduleUrl("src/pages/Workflow/WorkflowV2Workbench.js"));
  const workbench = createWorkflowV2Workbench();

  workbench.dropLibraryNode("agent", { x: 20, y: 30 });
  workbench.dropLibraryNode("end", { x: 200, y: 30 });
  workbench.connectCanvasEdge("START", "agent-1");
  workbench.connectCanvasEdge("agent-1", "end-2");
  workbench.moveCanvasNode("agent-1", { x: 60, y: 80 });
  workbench.selectNode("agent-1");

  const view = workbench.view();

  assert.equal(view.kind, "agent-workflow-v2-workbench");
  assert.deepEqual(view.nodeLibrary.items.map((node) => node.type), ["agent", "condition", "workflow", "end"]);
  assert.deepEqual(view.canvas.nodes.find((node) => node.id === "agent-1").position, { x: 60, y: 80 });
  assert.deepEqual(view.canvas.edges.map(({ source, target, id, label }) => ({ source, target, id, label })), [
    { source: "START", target: "agent-1", id: "0:START->agent-1", label: "success" },
    { source: "agent-1", target: "end-2", id: "1:agent-1->end-2", label: "success" },
  ]);
  assert.equal(view.nodeConfig.selectedNodeId, "agent-1");
});

test("T02 V2 workbench exposes handles and editable edge controls for condition branches", async () => {
  const { createWorkflowV2Workbench } = await import(moduleUrl("src/pages/Workflow/WorkflowV2Workbench.js"));
  const workbench = createWorkflowV2Workbench({ workflowDefinition: conditionWorkbenchWorkflowDefinition() });

  let view = workbench.view();
  assert.deepEqual(view.canvas.nodes.find((node) => node.id === "route").handles.outputs.map((handle) => handle.id), ["technical", "default"]);
  assert.deepEqual(view.canvas.edges.find((edge) => edge.source === "route" && edge.sourceHandle === "technical").label, "branch: technical");
  assert.equal(view.edgeConfig.sources.some((source) => source.id === "START"), true);
  assert.equal(view.edgeConfig.targets.some((target) => target.id === "END"), true);

  const added = workbench.connectCanvasEdge("route", "end-1", { sourceHandle: "business" });
  assert.equal(added.edge.label, "branch: business");

  const updated = workbench.updateCanvasEdge(added.edge.id, { sourceHandle: "fallback" });
  view = workbench.view();
  assert.equal(view.canvas.edges.some((edge) => edge.source === "route" && edge.sourceHandle === "business"), false);
  assert.equal(view.canvas.edges.some((edge) => edge.source === "route" && edge.sourceHandle === "fallback" && edge.target === "end-1"), true);

  workbench.removeCanvasEdge(updated.edge.id);
  view = workbench.view();
  assert.equal(view.canvas.edges.some((edge) => edge.source === "route" && edge.sourceHandle === "fallback"), false);
});

test("Workflow V2 workbench presents condition branch handles as clear branch conditions", async () => {
  const { createWorkflowV2Workbench } = await import(moduleUrl("src/pages/Workflow/WorkflowV2Workbench.js"));
  const { createStarterWorkflowV2Definition } = await import(moduleUrl("src/pages/Workflow/index.js"));
  const workbench = createWorkflowV2Workbench({ workflowDefinition: createStarterWorkflowV2Definition() });
  const view = workbench.view();

  const technical = view.canvas.edges.find((edge) => edge.source === "route-category" && edge.sourceHandle === "technical");
  const business = view.canvas.edges.find((edge) => edge.source === "route-category" && edge.sourceHandle === "business");
  const success = view.canvas.edges.find((edge) => edge.source === "analyze-request" && edge.target === "route-category");

  assert.equal(technical.label, "category == technical");
  assert.equal(business.label, "category == business");
  assert.equal(success.label, "success");
});

test("Workflow V2 workbench routes edges around nodes that sit between source and target", async () => {
  const { createWorkflowV2Workbench } = await import(moduleUrl("src/pages/Workflow/WorkflowV2Workbench.js"));
  const workbench = createWorkflowV2Workbench({
    workflowDefinition: {
      id: "route-around-node",
      name: "Route Around Node",
      schemaVersion: 2,
      revision: 1,
      nodes: [
        { id: "agent-a", type: "agent", position: { x: 20, y: 80 } },
        { id: "agent-c", type: "agent", position: { x: 210, y: 80 } },
        { id: "agent-b", type: "agent", position: { x: 400, y: 80 } },
      ],
      edges: [{ source: "agent-a", target: "agent-b" }],
    },
  });

  const routed = workbench.view().canvas.edges[0];

  assert.match(routed.path, /V/);
  assert.deepEqual(routed.blockedByNodeIds, ["agent-c"]);

  workbench.moveCanvasNode("agent-c", { x: 210, y: 230 });

  const clear = workbench.view().canvas.edges[0];
  assert.notEqual(clear.path, routed.path);
  assert.deepEqual(clear.blockedByNodeIds, []);
});

test("Workflow V2 workbench exposes directed arrow marker and keeps target endpoint outside the node", async () => {
  const { createWorkflowV2Workbench } = await import(moduleUrl("src/pages/Workflow/WorkflowV2Workbench.js"));
  const workbench = createWorkflowV2Workbench({
    workflowDefinition: {
      id: "arrow-flow",
      name: "Arrow Flow",
      schemaVersion: 2,
      revision: 1,
      nodes: [
        { id: "agent-a", type: "agent", position: { x: 20, y: 80 } },
        { id: "agent-b", type: "agent", position: { x: 300, y: 80 } },
      ],
      edges: [{ source: "agent-a", target: "agent-b" }],
    },
  });

  const edge = workbench.view().canvas.edges[0];

  assert.equal(edge.markerEnd, "url(#workflow-v2-arrowhead)");
  assert.ok(edge.endPoint.x < 300);
  assert.ok(edge.sourcePoint.x > 20 + 148);
});

test("T02 V2 workbench validates locally and with backend authority", async () => {
  const { createWorkflowV2Workbench } = await import(moduleUrl("src/pages/Workflow/WorkflowV2Workbench.js"));
  const calls = [];
  const workbench = createWorkflowV2Workbench({
    apiClient: {
      async validateWorkflow(workflowId, definition) {
        calls.push({ workflowId, definition });
        return { valid: false, errors: [{ code: "unknown_node", field: "edges[0].target", message: "Missing node" }] };
      },
    },
    workflowDefinition: {
      id: "support-flow",
      name: "Support Flow",
      schemaVersion: 2,
      revision: 1,
      nodes: [{ id: "agent-1", type: "agent" }],
      edges: [{ source: "START", target: "missing" }],
    },
  });

  const local = workbench.validate();
  const backend = await workbench.validateWithBackend();

  assert.equal(local.valid, false);
  assert.equal(local.errors[0].code, "unknown_node");
  assert.equal(backend.valid, false);
  assert.equal(workbench.view().validationPanel.issues[0].code, "unknown_node");
  assert.equal(calls[0].workflowId, "support-flow");
});

test("T03 V2 workbench edits agent inspector fields and keeps node card high-level", async () => {
  const { createWorkflowV2Workbench } = await import(moduleUrl("src/pages/Workflow/WorkflowV2Workbench.js"));
  const workbench = createWorkflowV2Workbench({
    workflowDefinition: {
      id: "support-flow",
      name: "Support Flow",
      schemaVersion: 2,
      revision: 1,
      nodes: [{ id: "agent-1", type: "agent", config: {} }],
      edges: [],
    },
  });

  workbench.selectNode("agent-1");
  const result = workbench.updateSelectedAgentConfig({
    name: "Analyze Requirement",
    description: "Classify the incoming request",
    instruction: "Analyze the user request and return a structured summary.",
    visibility: "auto",
    contextPolicy: {
      conversationHistory: true,
      userInput: true,
      uploadedFiles: false,
    },
    retryPolicy: {
      schemaRetryCount: 2,
      nodeRetryCount: 1,
      timeoutMs: 30000,
    },
  });

  const view = workbench.view();

  assert.equal(result.node.config.instruction, "Analyze the user request and return a structured summary.");
  assert.deepEqual(view.nodeConfig.groups.map((group) => group.id), ["basic", "goal", "context", "output", "tools", "retry"]);
  assert.deepEqual(view.nodeConfig.value.retryPolicy, {
    schemaRetryCount: 2,
    nodeRetryCount: 1,
    timeoutMs: 30000,
  });
  assert.equal(view.canvas.nodes[0].card.title, "Analyze Requirement");
  assert.equal(view.canvas.nodes[0].card.subtitle, "Agent");
  assert.deepEqual(view.canvas.nodes[0].card.summary, {
    goal: "Analyze Requirement",
    output: [],
    tools: 0,
  });
  assert.equal(JSON.stringify(view.canvas.nodes[0].card).includes("structured summary"), false);
  assert.equal(JSON.stringify(view.nodeConfig).includes("Prompt"), false);
  assert.equal(JSON.stringify(view.nodeConfig).includes("LLM"), false);
});

test("Workflow V2 agent inspector classifies editable fields by real data source", async () => {
  const { createWorkflowV2Workbench } = await import(moduleUrl("src/pages/Workflow/WorkflowV2Workbench.js"));
  const workbench = createWorkflowV2Workbench({
    workflowDefinition: {
      id: "support-flow",
      name: "Support Flow",
      schemaVersion: 2,
      revision: 1,
      tools: ["search.web"],
      nodes: [
        { id: "agent-1", type: "agent", config: { instruction: "Analyze", toolPolicy: { mode: "auto", allowedTools: ["search.web"] } } },
        { id: "end-1", type: "end" },
      ],
      edges: [{ source: "agent-1", target: "end-1" }],
    },
  });

  workbench.selectNode("agent-1");
  const fields = workbench.view().nodeConfig.fields;

  assert.deepEqual(fields, [
    { id: "goal", label: "Goal", visible: true, editable: true, ui: "textarea", source: "config.instruction" },
    { id: "output", label: "Output", visible: true, editable: true, ui: "schemaBuilder", source: "config.outputSchema" },
    { id: "tools", label: "Tools", visible: true, editable: true, ui: "multiSelect", source: "config.toolPolicy" },
    { id: "branchNext", label: "Branch / Next", visible: true, editable: false, ui: "edgeSummary", source: "edges[source=agent-1]" },
  ]);
  assert.deepEqual(workbench.view().nodeConfig.branchNext, [{ label: "success", target: "end-1" }]);
});

test("T03 V2 workbench saves refreshed agent configuration through draft API", async () => {
  const { createWorkflowV2Workbench } = await import(moduleUrl("src/pages/Workflow/WorkflowV2Workbench.js"));
  const saves = [];
  const workbench = createWorkflowV2Workbench({
    apiClient: {
      async saveWorkflowDraft(workflowId, definition) {
        saves.push({ workflowId, definition });
        return { ...definition, revision: 2 };
      },
    },
    workflowDefinition: {
      id: "support-flow",
      name: "Support Flow",
      schemaVersion: 2,
      revision: 1,
      nodes: [{ id: "agent-1", type: "agent", config: {} }],
      edges: [],
    },
  });

  workbench.selectNode("agent-1");
  workbench.updateSelectedAgentConfig({
    instruction: "Analyze the user request.",
    visibility: "visible",
    retryPolicy: { schemaRetryCount: 1, nodeRetryCount: 0, timeoutMs: 15000 },
  });

  const saved = await workbench.saveDraft();

  assert.equal(saved.revision, 2);
  assert.deepEqual(saves, [
    {
      workflowId: "support-flow",
      definition: {
        id: "support-flow",
        name: "Support Flow",
        schemaVersion: 2,
        revision: 1,
        nodes: [
          {
            id: "agent-1",
            type: "agent",
            config: {
              instruction: "Analyze the user request.",
              visibility: "visible",
              retryPolicy: { schemaRetryCount: 1, nodeRetryCount: 0, timeoutMs: 15000 },
              outputSchema: null,
              toolPolicy: { mode: "disabled" },
            },
          },
        ],
        edges: [],
      },
    },
  ]);
  assert.equal(workbench.view().draft.revision, 2);
});

test("T20 V2 workbench can rebase the local draft revision before saving", async () => {
  const { createWorkflowV2Workbench } = await import(moduleUrl("src/pages/Workflow/WorkflowV2Workbench.js"));
  const saves = [];
  const workbench = createWorkflowV2Workbench({
    apiClient: {
      async saveWorkflowDraft(workflowId, definition) {
        saves.push({ workflowId, definition });
        return { ...definition, revision: 8 };
      },
    },
    workflowDefinition: {
      id: "agent-workflow-v2-draft",
      name: "Agent Workflow V2 Draft",
      schemaVersion: 2,
      revision: 1,
      nodes: [],
      edges: [],
    },
  });

  workbench.dropLibraryNode("agent", { x: 20, y: 30 });
  workbench.setDraftRevision(7);
  await workbench.saveDraft();

  assert.equal(saves[0].definition.revision, 7);
  assert.equal(saves[0].definition.nodes[0].id, "agent-1");
  assert.equal(workbench.view().draft.revision, 8);
});

test("T04 V2 workbench edits output schema through builder view and saves draft", async () => {
  const { createWorkflowV2Workbench } = await import(moduleUrl("src/pages/Workflow/WorkflowV2Workbench.js"));
  const saves = [];
  const workbench = createWorkflowV2Workbench({
    apiClient: {
      async saveWorkflowDraft(workflowId, definition) {
        saves.push({ workflowId, definition });
        return { ...definition, revision: 2 };
      },
    },
    workflowDefinition: {
      id: "support-flow",
      name: "Support Flow",
      schemaVersion: 2,
      revision: 1,
      nodes: [
        {
          id: "agent-1",
          type: "agent",
          config: {
            instruction: "Analyze the user request.",
            visibility: "visible",
            outputSchema: null,
          },
        },
      ],
      edges: [],
    },
  });

  workbench.selectNode("agent-1");
  workbench.addOutputSchemaField({ name: "category", type: "enum", required: true, enumOptions: ["technical", "business", "other"] });
  workbench.addOutputSchemaField({ name: "summary", type: "string", required: true });
  workbench.addOutputSchemaField({ name: "confidence", type: "number" });
  await workbench.saveDraft();

  const outputSchema = saves[0].definition.nodes[0].config.outputSchema;
  assert.deepEqual(outputSchema, {
    type: "object",
    required: ["category", "summary"],
    properties: {
      category: { type: "string", enum: ["technical", "business", "other"] },
      summary: { type: "string" },
      confidence: { type: "number" },
    },
  });
  assert.deepEqual(workbench.view().nodeConfig.schemaBuilder.fields.map((field) => field.name), ["category", "summary", "confidence"]);
  assert.deepEqual(workbench.view().canvas.nodes[0].card.summary.output, ["category", "summary", "confidence"]);
});

test("T05 V2 workbench configures workflow registry and selected agent tool policy without tool nodes", async () => {
  const { createWorkflowV2Workbench } = await import(moduleUrl("src/pages/Workflow/WorkflowV2Workbench.js"));
  const saves = [];
  const workbench = createWorkflowV2Workbench({
    apiClient: {
      async listWorkflowTools() {
        return {
          tools: [
            { id: "search.web", name: "Web Search", inputSchema: { type: "object" }, outputSchema: { type: "object" } },
            { id: "knowledge.base", name: "Knowledge Base", inputSchema: { type: "object" }, outputSchema: { type: "object" } },
          ],
        };
      },
      async saveWorkflowDraft(workflowId, definition) {
        saves.push({ workflowId, definition });
        return { ...definition, revision: 2 };
      },
    },
    workflowDefinition: {
      id: "support-flow",
      name: "Support Flow",
      schemaVersion: 2,
      revision: 1,
      tools: [],
      nodes: [{ id: "agent-1", type: "agent", config: { instruction: "Analyze the request.", visibility: "visible" } }],
      edges: [],
    },
  });

  await workbench.loadWorkflowTools();
  workbench.setWorkflowToolRegistry(["search.web", "knowledge.base"]);
  workbench.selectNode("agent-1");
  workbench.updateSelectedToolPolicy({ mode: "required", allowedTools: ["search.web", "knowledge.base"], requiredTools: ["search.web"] });
  await workbench.saveDraft();

  assert.deepEqual(workbench.nodeLibrary().map((node) => node.type), ["agent", "condition", "workflow", "end"]);
  assert.deepEqual(workbench.view().workflowTools.selectedIds, ["search.web", "knowledge.base"]);
  assert.deepEqual(workbench.view().nodeConfig.toolSelector.policy, {
    mode: "required",
    allowedTools: ["search.web", "knowledge.base"],
    requiredTools: ["search.web"],
  });
  assert.equal(workbench.view().canvas.nodes[0].card.summary.tools, 2);
  assert.deepEqual(saves[0].definition.tools, ["search.web", "knowledge.base"]);
  assert.deepEqual(saves[0].definition.nodes[0].config.toolPolicy, {
    mode: "required",
    allowedTools: ["search.web", "knowledge.base"],
    requiredTools: ["search.web"],
  });
});

test("T06 V2 workbench publishes workflow and refreshes immutable version list", async () => {
  const { createWorkflowV2Workbench } = await import(moduleUrl("src/pages/Workflow/WorkflowV2Workbench.js"));
  const calls = [];
  const workbench = createWorkflowV2Workbench({
    apiClient: {
      async validateWorkflow(workflowId, definition) {
        calls.push(["validate", workflowId, definition.revision]);
        return { valid: true, errors: [] };
      },
      async publishWorkflow(workflowId) {
        calls.push(["publish", workflowId]);
        return { workflowId, version: 1, definition: { id: workflowId, revision: 1 } };
      },
      async listWorkflowVersions(workflowId) {
        calls.push(["versions", workflowId]);
        return { versions: [{ workflowId, version: 1, publishedAt: "2026-09-02T00:00:00Z" }] };
      },
    },
    workflowDefinition: validWorkbenchWorkflowDefinition(),
  });

  const published = await workbench.publishWorkflow();

  assert.equal(published.version, 1);
  assert.deepEqual(calls.map((call) => call[0]), ["validate", "publish", "versions"]);
  assert.deepEqual(workbench.view().toolbar, {
    saveStatus: "saved",
    draftRevision: 1,
    actions: ["validate", "publish", "run"],
    versions: [{ workflowId: "support-flow", version: 1, publishedAt: "2026-09-02T00:00:00Z" }],
  });
});

test("T06 V2 workbench routes publish validation failure into validation panel", async () => {
  const { createWorkflowV2Workbench } = await import(moduleUrl("src/pages/Workflow/WorkflowV2Workbench.js"));
  const workbench = createWorkflowV2Workbench({
    apiClient: {
      async validateWorkflow() {
        return { valid: false, errors: [{ code: "agent_instruction_required", field: "nodes[0].config.instruction", message: "Instruction required" }] };
      },
    },
    workflowDefinition: validWorkbenchWorkflowDefinition(),
  });

  await assert.rejects(() => workbench.publishWorkflow(), /Workflow validation failed/);

  assert.deepEqual(workbench.view().validationPanel.issues, [
    { code: "agent_instruction_required", field: "nodes[0].config.instruction", message: "Instruction required" },
  ]);
});

test("T07 V2 workbench starts run for explicit version and displays succeeded result", async () => {
  const { createWorkflowV2Workbench } = await import(moduleUrl("src/pages/Workflow/WorkflowV2Workbench.js"));
  const calls = [];
  const workbench = createWorkflowV2Workbench({
    apiClient: {
      async startWorkflowRun(workflowId, payload) {
        calls.push({ workflowId, payload });
        return {
          id: "workflow_run_1",
          status: "succeeded",
          workflowVersion: 1,
          output: { summary: "Need API work" },
          nodeResults: [{ nodeId: "agent-1", status: "succeeded", data: { summary: "Need API work" } }],
        };
      },
    },
    workflowDefinition: validWorkbenchWorkflowDefinition(),
  });

  const run = await workbench.startRun({ version: 1, input: { message: "Please classify this request" } });

  assert.equal(run.status, "succeeded");
  assert.deepEqual(calls, [{ workflowId: "support-flow", payload: { version: 1, input: { message: "Please classify this request" } } }]);
  assert.deepEqual(workbench.view().runPanel, {
    status: "succeeded",
    runId: "workflow_run_1",
    workflowVersion: 1,
    output: { summary: "Need API work" },
    error: null,
    messages: [],
    executionDetails: { nodes: [] },
    nodeExecutionDetails: [{ nodeId: "agent-1", order: 1, status: "succeeded", input: null, output: { summary: "Need API work" }, error: null, durationMs: null, artifacts: [], steps: [] }],
  });
  assert.equal(workbench.view().canvas.nodes.find((node) => node.id === "agent-1").runStatus, "succeeded");
  assert.deepEqual(workbench.view().toolbar.actions, ["validate", "publish", "run"]);
});

test("T07 V2 workbench displays failed run error", async () => {
  const { createWorkflowV2Workbench } = await import(moduleUrl("src/pages/Workflow/WorkflowV2Workbench.js"));
  const workbench = createWorkflowV2Workbench({
    apiClient: {
      async startWorkflowRun() {
        return {
          id: "workflow_run_2",
          status: "failed",
          workflowVersion: 1,
          output: null,
          nodeResults: [{ nodeId: "agent-1", status: "failed", data: null }],
          error: { code: "workflow.output_schema_invalid", message: "Output schema invalid" },
        };
      },
    },
    workflowDefinition: validWorkbenchWorkflowDefinition(),
  });

  await workbench.startRun({ version: 1, input: { message: "bad output please" } });

  assert.deepEqual(workbench.view().runPanel, {
    status: "failed",
    runId: "workflow_run_2",
    workflowVersion: 1,
    output: null,
    error: { code: "workflow.output_schema_invalid", message: "Output schema invalid" },
    messages: [],
    executionDetails: { nodes: [] },
    nodeExecutionDetails: [{ nodeId: "agent-1", order: 1, status: "failed", input: null, output: null, error: null, durationMs: null, artifacts: [], steps: [] }],
  });
  assert.equal(workbench.view().canvas.nodes.find((node) => node.id === "agent-1").runStatus, "failed");
});

test("T08 V2 workbench shows implicit agent tool loop details without canvas tool nodes", async () => {
  const { createWorkflowV2Workbench } = await import(moduleUrl("src/pages/Workflow/WorkflowV2Workbench.js"));
  const workbench = createWorkflowV2Workbench({
    apiClient: {
      async startWorkflowRun() {
        return {
          id: "workflow_run_tool_1",
          status: "succeeded",
          workflowVersion: 1,
          output: { summary: "Found mars" },
          messages: [
            { role: "user", content: "research mars" },
            { role: "assistant", content: "", toolCalls: [{ id: "call-1", name: "context.echo", arguments: { query: "mars" } }] },
            { role: "tool", toolCallId: "call-1", name: "context.echo", data: { echo: "mars" } },
            { role: "assistant", content: '{"summary":"Found mars"}' },
          ],
          nodeResults: [{ nodeId: "agent-1", status: "succeeded", data: { summary: "Found mars" } }],
          executionDetails: {
            nodes: [
              {
                nodeId: "agent-1",
                steps: [
                  { type: "llm_call", index: 1 },
                  { type: "tool_call", toolCallId: "call-1", name: "context.echo" },
                  { type: "tool_result", toolCallId: "call-1", name: "context.echo", data: { echo: "mars" } },
                  { type: "llm_call", index: 2 },
                  { type: "schema_validation", status: "succeeded" },
                  { type: "node_result", status: "succeeded", data: { summary: "Found mars" } },
                ],
              },
            ],
          },
        };
      },
    },
    workflowDefinition: {
      ...validWorkbenchWorkflowDefinition(),
      tools: ["context.echo"],
      nodes: validWorkbenchWorkflowDefinition().nodes.map((node) => node.id === "agent-1"
        ? { ...node, config: { ...node.config, toolPolicy: { mode: "auto", allowedTools: ["context.echo"] } } }
        : node),
    },
  });

  await workbench.startRun({ version: 1, input: { message: "research mars" } });

  const view = workbench.view();
  assert.deepEqual(view.canvas.nodes.map((node) => node.type), ["agent", "end"]);
  assert.deepEqual(view.runPanel.executionDetails.nodes[0].steps.map((step) => step.type), [
    "llm_call",
    "tool_call",
    "tool_result",
    "llm_call",
    "schema_validation",
    "node_result",
  ]);
  assert.deepEqual(view.runPanel.messages.map((message) => [message.role, message.toolCallId ?? null]), [
    ["user", null],
    ["assistant", null],
    ["tool", "call-1"],
    ["assistant", null],
  ]);
});

test("T09 V2 workbench exposes schema-driven condition inspector and saves branch config", async () => {
  const { createWorkflowV2Workbench } = await import(moduleUrl("src/pages/Workflow/WorkflowV2Workbench.js"));
  const workbench = createWorkflowV2Workbench({
    workflowDefinition: conditionWorkbenchWorkflowDefinition(),
  });

  workbench.selectNode("route");
  const initial = workbench.view().nodeConfig.conditionInspector;
  assert.deepEqual(initial.sourceNodes.map((node) => node.id), ["classify"]);
  assert.deepEqual(initial.fields.map((field) => [field.path.join("."), field.type]), [
    ["category", "string"],
    ["confidence", "number"],
    ["summary", "string"],
  ]);
  assert.ok(initial.operatorOptions.find((item) => item.value === "equals"));
  assert.ok(initial.operatorOptions.find((item) => item.value === "contains"));

  const updated = workbench.updateSelectedConditionConfig({
    branches: [
      { handle: "technical", source: { nodeId: "classify", path: ["category"] }, operator: "equals", value: "technical" },
    ],
    defaultTarget: "business-agent",
  });

  assert.deepEqual(updated.node.config.branches[0], {
    handle: "technical",
    source: { nodeId: "classify", path: ["category"] },
    operator: "equals",
    value: "technical",
  });
  assert.equal(workbench.view().nodeConfig.conditionInspector.defaultTarget, "business-agent");
});

test("Workflow V2 adds a condition branch and its graph edge atomically", async () => {
  const { createWorkflowV2Workbench } = await import(moduleUrl("src/pages/Workflow/WorkflowV2Workbench.js"));
  const workbench = createWorkflowV2Workbench({ workflowDefinition: conditionWorkbenchWorkflowDefinition() });

  workbench.selectNode("route");
  const result = workbench.addSelectedConditionBranch({
    branch: {
      handle: "other",
      source: { nodeId: "classify", path: ["category"] },
      operator: "equals",
      value: "other",
    },
    target: "end-1",
  });

  assert.deepEqual(result.edge, { source: "route", target: "end-1", sourceHandle: "other" });
  assert.equal(workbench.view().canvas.edges.some((edge) => edge.source === "route" && edge.target === "end-1" && edge.sourceHandle === "other"), true);
  assert.equal(workbench.view().nodeConfig.conditionInspector.branches.some((branch) => branch.handle === "other"), true);
});

test("Workflow V2 run exposes isolated node input output status and duration for the selected node", async () => {
  const { createWorkflowV2Workbench } = await import(moduleUrl("src/pages/Workflow/WorkflowV2Workbench.js"));
  const workbench = createWorkflowV2Workbench({
    apiClient: {
      async startWorkflowRun() {
        return {
          id: "workflow_run_trace_1",
          status: "succeeded",
          workflowVersion: 1,
          output: { summary: "Done" },
          nodeResults: [{ nodeId: "agent-1", status: "succeeded", data: { summary: "Done" } }],
          executionDetails: {
            nodes: [{
              nodeId: "agent-1",
              input: { messages: [{ role: "user", content: "Trace this request" }] },
              steps: [{ type: "node_result", status: "succeeded", data: { summary: "Done" } }],
            }],
          },
          events: [
            { eventType: "NodeStarted", nodeId: "agent-1", sequence: 1, timestamp: "2026-09-09T00:00:00.000Z", payload: { status: "running" } },
            { eventType: "NodeCompleted", nodeId: "agent-1", sequence: 2, timestamp: "2026-09-09T00:00:00.125Z", payload: { status: "succeeded", data: { summary: "Done" } } },
          ],
        };
      },
    },
    workflowDefinition: validWorkbenchWorkflowDefinition(),
  });

  workbench.selectNode("agent-1");
  await workbench.startRun({ version: 1, input: { message: "Trace this request" } });

  const panel = workbench.view().runPanel;
  assert.equal(panel.nodeExecutionDetails.length, 1);
  assert.equal(panel.nodeExecutionDetails[0].status, "succeeded");
  assert.deepEqual(panel.nodeExecutionDetails[0].input, { messages: [{ role: "user", content: "Trace this request" }] });
  assert.deepEqual(panel.nodeExecutionDetails[0].output, { summary: "Done" });
  assert.equal(panel.nodeExecutionDetails[0].durationMs, 125);
  assert.deepEqual(panel.selectedNodeExecution, panel.nodeExecutionDetails[0]);
});

test("Workflow V2 does not leave a condition branch behind when its edge is rejected", async () => {
  const { createWorkflowV2Workbench } = await import(moduleUrl("src/pages/Workflow/WorkflowV2Workbench.js"));
  const workbench = createWorkflowV2Workbench({ workflowDefinition: conditionWorkbenchWorkflowDefinition() });

  workbench.selectNode("route");
  assert.throws(() => workbench.addSelectedConditionBranch({
    branch: {
      handle: "duplicate-target",
      source: { nodeId: "classify", path: ["category"] },
      operator: "equals",
      value: "technical",
    },
    target: "technical-agent",
  }), /Duplicate workflow edge/);

  assert.equal(workbench.view().nodeConfig.conditionInspector.branches.some((branch) => branch.handle === "duplicate-target"), false);
  assert.equal(workbench.view().canvas.edges.filter((edge) => edge.source === "route" && edge.target === "technical-agent").length, 1);
});

test("Workflow V2 saves a newly added condition branch and edge in one draft payload", async () => {
  const { createWorkflowV2Workbench } = await import(moduleUrl("src/pages/Workflow/WorkflowV2Workbench.js"));
  let savedDefinition = null;
  const workbench = createWorkflowV2Workbench({
    apiClient: {
      async saveWorkflowDraft(workflowId, definition) {
        savedDefinition = { workflowId, definition };
        return { ...definition, revision: 2 };
      },
    },
    workflowDefinition: conditionWorkbenchWorkflowDefinition(),
  });

  workbench.selectNode("route");
  workbench.addSelectedConditionBranch({
    branch: {
      handle: "other",
      source: { nodeId: "classify", path: ["category"] },
      operator: "equals",
      value: "other",
    },
    target: "end-1",
  });
  await workbench.saveDraft();

  assert.equal(savedDefinition.workflowId, "condition-flow");
  assert.equal(savedDefinition.definition.edges.some((edge) => edge.source === "route" && edge.target === "end-1" && edge.sourceHandle === "other"), true);
  assert.equal(savedDefinition.definition.nodes.find((node) => node.id === "route").config.branches.some((branch) => branch.handle === "other"), true);
});

test("T10 V2 workbench exposes end final result inspector and saves data binding", async () => {
  const { createWorkflowV2Workbench } = await import(moduleUrl("src/pages/Workflow/WorkflowV2Workbench.js"));
  const workbench = createWorkflowV2Workbench({
    workflowDefinition: conditionWorkbenchWorkflowDefinition(),
  });

  workbench.selectNode("end-1");
  const initial = workbench.view().nodeConfig.endInspector;
  assert.deepEqual(initial.defaults, {
    message: "lastVisibleAssistant",
    artifacts: "allVisible",
    data: "none",
  });
  assert.deepEqual(initial.dataSources.map((field) => [field.nodeId, field.path.join("."), field.type]), [
    ["classify", "category", "string"],
    ["classify", "confidence", "number"],
    ["classify", "summary", "string"],
  ]);

  const updated = workbench.updateSelectedEndConfig({
    finalResult: {
      message: { mode: "lastVisibleAssistant" },
      artifacts: { mode: "allVisible" },
      data: { kind: "nodeOutput", nodeId: "classify", path: ["category"] },
    },
  });

  assert.deepEqual(updated.node.config.finalResult.data, { kind: "nodeOutput", nodeId: "classify", path: ["category"] });
  assert.deepEqual(workbench.view().nodeConfig.endInspector.binding.data, { kind: "nodeOutput", nodeId: "classify", path: ["category"] });
});

test("T11 V2 workbench shows artifact refs in final result and node execution details without server uri", async () => {
  const { createWorkflowV2Workbench } = await import(moduleUrl("src/pages/Workflow/WorkflowV2Workbench.js"));
  const calls = [];
  const artifactRef = {
    id: "artifact_1",
    name: "report.txt",
    mimeType: "text/plain",
    createdByNodeId: "agent-1",
    visible: true,
  };
  const workbench = createWorkflowV2Workbench({
    apiClient: {
      async startWorkflowRun() {
        return {
          id: "workflow_run_artifact_1",
          status: "succeeded",
          workflowVersion: 1,
          output: { summary: "Report ready" },
          finalResult: { message: '{"summary":"Final answer"}', data: null, artifacts: [artifactRef] },
          artifacts: [artifactRef],
          messages: [
            { role: "user", content: "make report" },
            { role: "assistant", content: '{"summary":"Report ready"}', artifacts: [artifactRef] },
          ],
          nodeResults: [{ nodeId: "agent-1", status: "succeeded", data: { summary: "Report ready" }, artifacts: [artifactRef] }],
          executionDetails: { nodes: [{ nodeId: "agent-1", steps: [{ type: "node_result", artifacts: [artifactRef] }] }] },
        };
      },
      async downloadWorkflowArtifactContent(artifactId) {
        calls.push(["download", artifactId]);
        return { body: "hello artifact", mimeType: "text/plain" };
      },
    },
    workflowDefinition: validWorkbenchWorkflowDefinition(),
  });

  await workbench.startRun({ version: 1, input: { message: "make report" } });
  const downloaded = await workbench.downloadArtifact("artifact_1");

  const panel = workbench.view().runPanel;
  assert.deepEqual(panel.finalResult.artifacts, [{ ...artifactRef, downloadAction: { type: "workflowArtifactDownload", artifactId: "artifact_1" } }]);
  assert.deepEqual(panel.nodeExecutionDetails[0].artifacts, [{ ...artifactRef, downloadAction: { type: "workflowArtifactDownload", artifactId: "artifact_1" } }]);
  assert.equal(JSON.stringify(panel).includes("uri"), false);
  assert.deepEqual(calls, [["download", "artifact_1"]]);
  assert.deepEqual(downloaded, { body: "hello artifact", mimeType: "text/plain" });
});

test("T11 V2 end inspector exposes artifact refs as a special mapping type without server uri fields", async () => {
  const { createWorkflowV2Workbench } = await import(moduleUrl("src/pages/Workflow/WorkflowV2Workbench.js"));
  const workbench = createWorkflowV2Workbench({ workflowDefinition: validWorkbenchWorkflowDefinition() });

  workbench.selectNode("end-1");

  assert.deepEqual(workbench.view().nodeConfig.endInspector.artifactMapping, {
    type: "artifactRef",
    visibleFields: ["id", "name", "mimeType", "createdByNodeId", "visible"],
    hiddenFields: ["uri", "storageKey"],
    defaultMode: "allVisible",
  });
});

test("T12 V2 workbench configures workflow ref node with contract-driven input mapping", async () => {
  const { createWorkflowV2Workbench } = await import(moduleUrl("src/pages/Workflow/WorkflowV2Workbench.js"));
  const workbench = createWorkflowV2Workbench({
    workflowCatalog: [
      {
        id: "research-flow",
        name: "Research Flow",
        versions: [{ version: 1, label: "Version 1" }],
        inputSchema: {
          type: "object",
          required: ["topic"],
          properties: {
            topic: { type: "string" },
            priority: { type: "string" },
          },
        },
      },
    ],
    workflowDefinition: {
      id: "parent-flow",
      name: "Parent Flow",
      schemaVersion: 2,
      revision: 1,
      tools: [],
      nodes: [
        {
          id: "analyze",
          type: "agent",
          config: {
            name: "Analyze",
            instruction: "Extract topic.",
            visibility: "visible",
            toolPolicy: { mode: "disabled" },
            outputSchema: { type: "object", required: ["topic"], properties: { topic: { type: "string" } } },
          },
        },
        { id: "research", type: "workflow", config: { workflowId: "research-flow", version: 1, inputBindings: {} } },
        { id: "end-1", type: "end" },
      ],
      edges: [
        { source: "START", target: "analyze" },
        { source: "analyze", target: "research" },
        { source: "research", target: "end-1" },
      ],
    },
  });

  workbench.selectNode("research");
  const initial = workbench.view().nodeConfig.workflowInspector;
  assert.deepEqual(initial.workflowOptions.map((workflow) => workflow.id), ["research-flow"]);
  assert.deepEqual(initial.versionOptions.map((version) => version.version), [1]);
  assert.deepEqual(initial.inputMappings.map((mapping) => [mapping.name, mapping.type, mapping.required]), [
    ["topic", "string", true],
    ["priority", "string", false],
  ]);
  assert.deepEqual(initial.inputMappings[0].sourceOptions.map((option) => option.kind), ["workflowInput", "nodeOutput", "constant", "artifact"]);
  assert.equal(JSON.stringify(initial).includes("$state"), false);

  const updated = workbench.updateSelectedWorkflowRefConfig({
    workflowId: "research-flow",
    version: 1,
    messageContextMode: "isolated",
    inputBindings: {
      topic: { kind: "nodeOutput", nodeId: "analyze", path: ["topic"] },
      priority: { kind: "constant", value: "high" },
    },
  });

  assert.deepEqual(updated.node.config.inputBindings.topic, { kind: "nodeOutput", nodeId: "analyze", path: ["topic"] });
  assert.equal(workbench.view().nodeConfig.workflowInspector.messageContextMode, "isolated");
});

test("T13 V2 workbench flags condition and workflow mappings when upstream schema changes", async () => {
  const { createWorkflowV2Workbench } = await import(moduleUrl("src/pages/Workflow/WorkflowV2Workbench.js"));
  const workflowDefinition = {
    id: "parent-flow",
    name: "Parent Flow",
    schemaVersion: 2,
    revision: 1,
    tools: [],
    nodes: [
      {
        id: "analyze",
        type: "agent",
        config: {
          name: "Analyze Requirement",
          instruction: "Extract fields.",
          visibility: "visible",
          toolPolicy: { mode: "disabled" },
          outputSchema: { type: "object", properties: { score: { type: "number" }, topic: { type: "string" } } },
        },
      },
      {
        id: "route",
        type: "condition",
        config: {
          branches: [{ handle: "high", source: { nodeId: "analyze", path: ["score"] }, operator: "greaterThan", value: 3 }],
        },
      },
      {
        id: "research",
        type: "workflow",
        config: {
          workflowId: "research-flow",
          version: 1,
          inputBindings: { topic: { kind: "nodeOutput", nodeId: "analyze", path: ["topic"] } },
        },
      },
      { id: "end-1", type: "end" },
    ],
    edges: [
      { source: "START", target: "analyze" },
      { source: "analyze", target: "route" },
      { source: "route", target: "research", sourceHandle: "high" },
      { source: "research", target: "end-1" },
    ],
  };
  const workbench = createWorkflowV2Workbench({
    workflowCatalog: [
      {
        id: "research-flow",
        name: "Research Flow",
        versions: [{ version: 1 }],
        inputSchema: { type: "object", required: ["topic"], properties: { topic: { type: "string" } } },
      },
    ],
    workflowDefinition,
  });

  workbench.selectNode("analyze");
  workbench.updateSelectedAgentConfig({
    outputSchema: { type: "object", properties: { score: { type: "string" } } },
  });

  const issueCodes = workbench.view().validationPanel.issues.map((issue) => issue.code);
  assert.deepEqual(issueCodes, ["condition_operator_type_mismatch", "workflow_ref_source_field_not_found"]);
  workbench.selectNode("route");
  assert.deepEqual(workbench.view().nodeConfig.conditionInspector.issues.map((issue) => issue.code), ["condition_operator_type_mismatch"]);
  workbench.selectNode("research");
  assert.deepEqual(workbench.view().nodeConfig.workflowInspector.issues.map((issue) => issue.code), ["workflow_ref_source_field_not_found"]);
  assert.equal(JSON.stringify(workbench.view().draft).includes("$state."), false);
});

test("T14 V2 workbench applies workflow run SSE events to canvas status and timeline", async () => {
  const { createWorkflowV2Workbench } = await import(moduleUrl("src/pages/Workflow/WorkflowV2Workbench.js"));
  const events = [
    { eventType: "WorkflowStarted", runId: "workflow_run_1", sequence: 1, nodeId: null, payload: { status: "running" } },
    { eventType: "NodeStarted", runId: "workflow_run_1", sequence: 2, nodeId: "agent-1", payload: { status: "running" } },
    { eventType: "LlmCallStarted", runId: "workflow_run_1", sequence: 3, nodeId: "agent-1", payload: { index: 1 } },
    { eventType: "ToolCallStarted", runId: "workflow_run_1", sequence: 4, nodeId: "agent-1", payload: { toolCallId: "call-1", name: "context.echo" } },
    { eventType: "ToolCallCompleted", runId: "workflow_run_1", sequence: 5, nodeId: "agent-1", payload: { toolCallId: "call-1", name: "context.echo", status: "succeeded" } },
    { eventType: "NodeCompleted", runId: "workflow_run_1", sequence: 6, nodeId: "agent-1", payload: { status: "succeeded", data: { summary: "Done" } } },
    { eventType: "WorkflowCompleted", runId: "workflow_run_1", sequence: 7, nodeId: null, payload: { status: "succeeded" } },
  ];
  const workbench = createWorkflowV2Workbench({
    apiClient: {
      async startWorkflowRun() {
        return { id: "workflow_run_1", status: "running", workflowVersion: 1, nodeResults: [] };
      },
      streamWorkflowRunEvents() {
        return events;
      },
    },
    workflowDefinition: validWorkbenchWorkflowDefinition(),
  });

  await workbench.startRun({ version: 1, input: { message: "hello" } });
  await workbench.subscribeRunEvents();

  const view = workbench.view();
  assert.equal(view.runPanel.status, "succeeded");
  assert.equal(view.canvas.nodes.find((node) => node.id === "agent-1").runStatus, "succeeded");
  assert.deepEqual(view.runPanel.timeline.map((event) => event.eventType), events.map((event) => event.eventType));
  assert.deepEqual(view.runPanel.executionDetails.nodes[0].steps.map((step) => step.type), ["llm_call", "tool_call", "tool_result", "node_result"]);
});

test("T14 V2 workbench keeps disconnected SSE runs non-successful", async () => {
  const { createWorkflowV2Workbench } = await import(moduleUrl("src/pages/Workflow/WorkflowV2Workbench.js"));
  const workbench = createWorkflowV2Workbench({
    apiClient: {
      async startWorkflowRun() {
        return { id: "workflow_run_1", status: "running", workflowVersion: 1, nodeResults: [] };
      },
      async *streamWorkflowRunEvents() {
        yield { eventType: "WorkflowStarted", runId: "workflow_run_1", sequence: 1, nodeId: null, payload: { status: "running" } };
        yield { eventType: "NodeStarted", runId: "workflow_run_1", sequence: 2, nodeId: "agent-1", payload: { status: "running" } };
        throw new Error("network disconnected");
      },
    },
    workflowDefinition: validWorkbenchWorkflowDefinition(),
  });

  await workbench.startRun({ version: 1, input: { message: "hello" } });
  await assert.rejects(() => workbench.subscribeRunEvents(), /network disconnected/);

  const view = workbench.view();
  assert.equal(view.runPanel.status, "running");
  assert.equal(view.runPanel.streamStatus, "disconnected");
  assert.equal(view.canvas.nodes.find((node) => node.id === "agent-1").runStatus, "running");
});

test("T15 V2 workbench exposes cancel action for running workflow runs", async () => {
  const { createWorkflowV2Workbench } = await import(moduleUrl("src/pages/Workflow/WorkflowV2Workbench.js"));
  const calls = [];
  const workbench = createWorkflowV2Workbench({
    apiClient: {
      async startWorkflowRun() {
        return { id: "workflow_run_1", status: "running", workflowVersion: 1, nodeResults: [] };
      },
      async cancelWorkflowRun(runId) {
        calls.push(["cancel", runId]);
        return { id: runId, status: "cancelled", workflowVersion: 1, error: { code: "WORKFLOW_CANCELLED", message: "Workflow run cancelled" }, nodeResults: [] };
      },
    },
    workflowDefinition: validWorkbenchWorkflowDefinition(),
  });

  await workbench.startRun({ version: 1, input: { message: "hello" }, async: true });
  assert.deepEqual(workbench.view().runPanel.actions, ["cancel"]);

  await workbench.cancelRun();

  assert.deepEqual(calls, [["cancel", "workflow_run_1"]]);
  assert.equal(workbench.view().runPanel.status, "cancelled");
  assert.equal(workbench.view().runPanel.error.code, "WORKFLOW_CANCELLED");
});

test("T15 V2 workbench shows concrete runtime limit failures", async () => {
  const { createWorkflowV2Workbench } = await import(moduleUrl("src/pages/Workflow/WorkflowV2Workbench.js"));
  const workbench = createWorkflowV2Workbench({
    apiClient: {
      async startWorkflowRun() {
        return {
          id: "workflow_run_1",
          status: "failed",
          workflowVersion: 1,
          error: {
            code: "WORKFLOW_LIMIT_EXCEEDED",
            message: "Runtime limit exceeded: maxToolCallsPerNode",
            limit: "maxToolCallsPerNode",
            nodeId: "agent-1",
          },
          nodeResults: [{ nodeId: "agent-1", status: "failed", data: null }],
          executionDetails: { nodes: [{ nodeId: "agent-1", steps: [{ type: "tool_result", status: "failed", error: { code: "WORKFLOW_LIMIT_EXCEEDED" } }] }] },
        };
      },
    },
    workflowDefinition: validWorkbenchWorkflowDefinition(),
  });

  await workbench.startRun({ version: 1, input: { message: "hello" } });

  assert.deepEqual(workbench.view().runPanel.failure, {
    code: "WORKFLOW_LIMIT_EXCEEDED",
    message: "Runtime limit exceeded: maxToolCallsPerNode",
    limit: "maxToolCallsPerNode",
    nodeId: "agent-1",
  });
  assert.equal(workbench.view().canvas.nodes.find((node) => node.id === "agent-1").runStatus, "failed");
});

test("T16 V2 workbench loads historical run detail without mixing trace into chat", async () => {
  const { createWorkflowV2Workbench } = await import(moduleUrl("src/pages/Workflow/WorkflowV2Workbench.js"));
  const calls = [];
  const workbench = createWorkflowV2Workbench({
    apiClient: {
      async fetchWorkflowRun(runId) {
        calls.push(["run", runId]);
        return {
          id: runId,
          status: "succeeded",
          workflowVersion: 1,
          output: { summary: "History ready" },
          finalResult: { message: "History ready", data: { summary: "History ready" }, artifacts: [{ id: "artifact_1", name: "history.txt", mimeType: "text/plain" }] },
          nodeResults: [{ nodeId: "agent-1", status: "succeeded", data: { summary: "History ready" } }],
          events: [{ sequence: 1, eventType: "WorkflowStarted", payload: { status: "running" } }],
        };
      },
      async fetchWorkflowRunNodes(runId) {
        calls.push(["nodes", runId]);
        return { nodes: [{ nodeId: "agent-1", status: "succeeded", nodeResult: { data: { summary: "History ready" } }, steps: [{ type: "llm_call", index: 1 }] }] };
      },
      async fetchWorkflowRunMessages(runId) {
        calls.push(["messages", runId]);
        return { messages: [{ sequence: 1, role: "user", content: "make history" }, { sequence: 2, role: "assistant", content: "History ready" }] };
      },
      async listWorkflowRunArtifacts(runId) {
        calls.push(["artifacts", runId]);
        return { artifacts: [{ id: "artifact_1", name: "history.txt", mimeType: "text/plain" }] };
      },
    },
    workflowDefinition: validWorkbenchWorkflowDefinition(),
  });

  await workbench.loadRunDetail("workflow_run_history");
  const panel = workbench.view().runPanel;

  assert.deepEqual(calls, [["run", "workflow_run_history"], ["nodes", "workflow_run_history"], ["messages", "workflow_run_history"], ["artifacts", "workflow_run_history"]]);
  assert.deepEqual(panel.historyDetail.tabs, ["result", "timeline", "nodes", "messages", "artifacts"]);
  assert.deepEqual(panel.historyDetail.nodes[0].nodeResult.data, { summary: "History ready" });
  assert.deepEqual(panel.historyDetail.messages.map((message) => message.sequence), [1, 2]);
  assert.deepEqual(panel.messages, []);
  assert.equal(panel.historyDetail.artifacts[0].name, "history.txt");
});

test("T17 V2 workbench defaults to simple mode and folds advanced agent details", async () => {
  const { createWorkflowV2Workbench } = await import(moduleUrl("src/pages/Workflow/WorkflowV2Workbench.js"));
  const workbench = createWorkflowV2Workbench({
    workflowDefinition: validWorkbenchWorkflowDefinition(),
  });

  workbench.selectNode("agent-1");
  const simple = workbench.view();
  workbench.setEditorMode("advanced");
  const advanced = workbench.view();

  assert.equal(simple.editorMode, "simple");
  assert.deepEqual(simple.nodeConfig.visibleGroups.map((group) => group.id), ["goal", "output", "tools", "branch"]);
  assert.deepEqual(advanced.nodeConfig.visibleGroups.map((group) => group.id), [
    "goal",
    "output",
    "tools",
    "branch",
    "jsonSchema",
    "retry",
    "timeout",
    "contextSources",
    "messageContextStrategy",
    "runtimeDetail",
  ]);
  assert.equal(JSON.stringify(simple).includes("$state"), false);
  assert.equal(JSON.stringify(simple).includes("PromptNode"), false);
  assert.equal(JSON.stringify(simple).includes("LlmNode"), false);
  assert.equal(JSON.stringify(simple).includes("ToolNode"), false);
});

test("T17 V2 workbench preserves advanced config while switching modes and saving draft", async () => {
  const { createWorkflowV2Workbench } = await import(moduleUrl("src/pages/Workflow/WorkflowV2Workbench.js"));
  const savedDefinitions = [];
  const workbench = createWorkflowV2Workbench({
    apiClient: {
      async saveWorkflowDraft(workflowId, definition) {
        savedDefinitions.push({ workflowId, definition });
        return { ...definition, revision: 2 };
      },
    },
    workflowDefinition: validWorkbenchWorkflowDefinition(),
  });

  workbench.selectNode("agent-1");
  workbench.setEditorMode("advanced");
  workbench.updateSelectedAgentConfig({
    retryPolicy: { schemaRetryCount: 2, nodeRetryCount: 1, timeoutMs: 30000 },
    contextPolicy: { conversationHistory: true, userInput: true, uploadedFiles: false },
  });
  workbench.setEditorMode("simple");
  await workbench.saveDraft();

  assert.equal(workbench.view().editorMode, "simple");
  assert.deepEqual(savedDefinitions[0].definition.nodes[0].config.retryPolicy, { schemaRetryCount: 2, nodeRetryCount: 1, timeoutMs: 30000 });
  assert.deepEqual(savedDefinitions[0].definition.nodes[0].config.contextPolicy, { conversationHistory: true, userInput: true, uploadedFiles: false });
});

test("T17 V2 workbench provides compact node cards and validation locators", async () => {
  const { createWorkflowV2Workbench } = await import(moduleUrl("src/pages/Workflow/WorkflowV2Workbench.js"));
  const workbench = createWorkflowV2Workbench({
    apiClient: {
      async validateWorkflow() {
        return {
          valid: false,
          errors: [
            { code: "condition_default_target_missing", field: "nodes[1].config.defaultTarget", message: "Default target is missing", nodeId: "route" },
            { code: "workflow_ref_version_required", field: "nodes[2].config.version", message: "Version is required", node_id: "child" },
          ],
        };
      },
    },
    workflowCatalog: [{ id: "child-flow", name: "Child Flow", versions: [{ version: 1 }], inputSchema: { type: "object", properties: {} }, outputSchema: { type: "object", properties: { summary: { type: "string" } } } }],
    workflowDefinition: {
      ...conditionWorkbenchWorkflowDefinition(),
      nodes: [
        ...conditionWorkbenchWorkflowDefinition().nodes,
        { id: "child", type: "workflow", config: { workflowId: "child-flow", version: 1, inputBindings: {} } },
      ],
    },
  });

  const result = await workbench.validateWithBackend();
  const view = workbench.view();

  assert.equal(result.valid, false);
  assert.deepEqual(view.canvas.nodes.find((node) => node.id === "classify").card.summary.output, ["category", "confidence", "summary"]);
  assert.equal(view.canvas.nodes.find((node) => node.id === "classify").card.summary.tools, 0);
  assert.equal(view.canvas.nodes.find((node) => node.id === "route").card.summary.branchCount, 0);
  assert.equal(view.canvas.nodes.find((node) => node.id === "child").card.summary.workflowId, "child-flow");
  assert.deepEqual(view.validationPanel.locators[0], {
    nodeId: "route",
    field: "nodes[1].config.defaultTarget",
    target: { panel: "nodeConfig", nodeId: "route" },
  });
  assert.deepEqual(view.validationPanel.locators[1], {
    nodeId: "child",
    field: "nodes[2].config.version",
    target: { panel: "nodeConfig", nodeId: "child" },
  });
});

function validWorkbenchWorkflowDefinition() {
  return {
    id: "support-flow",
    name: "Support Flow",
    schemaVersion: 2,
    revision: 1,
    tools: [],
    nodes: [
      {
        id: "agent-1",
        type: "agent",
        config: {
          instruction: "Analyze the request.",
          visibility: "visible",
          toolPolicy: { mode: "disabled" },
          outputSchema: { type: "object", required: ["summary"], properties: { summary: { type: "string" } } },
        },
      },
      { id: "end-1", type: "end" },
    ],
    edges: [{ source: "START", target: "agent-1" }, { source: "agent-1", target: "end-1" }],
  };
}

function conditionWorkbenchWorkflowDefinition() {
  return {
    id: "condition-flow",
    name: "Condition Flow",
    schemaVersion: 2,
    revision: 1,
    tools: [],
    nodes: [
      {
        id: "classify",
        type: "agent",
        config: {
          instruction: "Classify the request.",
          visibility: "visible",
          toolPolicy: { mode: "disabled" },
          outputSchema: {
            type: "object",
            required: ["category", "confidence", "summary"],
            properties: {
              category: { type: "string", enum: ["technical", "business", "other"] },
              confidence: { type: "number" },
              summary: { type: "string" },
            },
          },
        },
      },
      {
        id: "route",
        type: "condition",
        config: { branches: [], defaultTarget: "business-agent" },
      },
      { id: "technical-agent", type: "agent", config: { instruction: "Tech", visibility: "visible", toolPolicy: { mode: "disabled" } } },
      { id: "business-agent", type: "agent", config: { instruction: "Biz", visibility: "visible", toolPolicy: { mode: "disabled" } } },
      { id: "end-1", type: "end" },
    ],
    edges: [
      { source: "START", target: "classify" },
      { source: "classify", target: "route" },
      { source: "route", target: "technical-agent", sourceHandle: "technical" },
      { source: "route", target: "business-agent", sourceHandle: "default" },
      { source: "technical-agent", target: "end-1" },
      { source: "business-agent", target: "end-1" },
    ],
  };
}
