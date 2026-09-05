import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\tests$/, "");

function moduleUrl(relativePath) {
  return pathToFileURL(join(studioRoot, relativePath)).href;
}

test("T02 V2 builder edits nodes, positions, edges, and removes connected edges", async () => {
  const { createWorkflowV2Builder } = await import(moduleUrl("src/features/workflow-v2/WorkflowV2Builder.js"));
  const builder = createWorkflowV2Builder();

  builder.addNode({ id: "agent-1", type: "agent", position: { x: 10, y: 20 } });
  builder.addNode({ id: "end-1", type: "end", position: { x: 200, y: 20 } });
  builder.updateNodePosition("agent-1", { x: 40, y: 60 });
  builder.connect("START", "agent-1");
  builder.connect("agent-1", "end-1");

  assert.deepEqual(builder.view().nodes[0].position, { x: 40, y: 60 });
  assert.deepEqual(builder.view().edges, [
    { source: "START", target: "agent-1" },
    { source: "agent-1", target: "end-1" },
  ]);

  builder.removeNode("agent-1");

  assert.deepEqual(builder.view().nodes.map((node) => node.id), ["end-1"]);
  assert.deepEqual(builder.view().edges, []);
});

test("T02 V2 builder blocks obvious invalid canvas connections", async () => {
  const { createWorkflowV2Builder } = await import(moduleUrl("src/features/workflow-v2/WorkflowV2Builder.js"));
  const builder = createWorkflowV2Builder();
  builder.addNode({ id: "agent-1", type: "agent" });
  builder.addNode({ id: "end-1", type: "end" });

  assert.throws(() => builder.connect("end-1", "agent-1"), /End nodes cannot have outgoing edges/);
  assert.throws(() => builder.connect("agent-1", "START"), /START cannot have incoming edges/);
  assert.throws(() => builder.connect("agent-1", "agent-1"), /cannot connect to itself/);
  assert.throws(() => builder.connect("agent-1", "missing"), /existing workflow nodes/);
});

test("T03 V2 builder edits agent execution policy and protects nested config state", async () => {
  const { createWorkflowV2Builder } = await import(moduleUrl("src/features/workflow-v2/WorkflowV2Builder.js"));
  const builder = createWorkflowV2Builder();
  builder.addNode({ id: "agent-1", type: "agent" });

  builder.updateAgentNodeConfig("agent-1", {
    name: "Analyze Requirement",
    description: "Classify the incoming request",
    instruction: "Analyze the user request and return a structured summary.",
    visibility: "auto",
    contextPolicy: {
      conversationHistory: true,
      userInput: true,
      uploadedFiles: false,
    },
    outputSchema: null,
    toolPolicy: { mode: "disabled" },
    retryPolicy: {
      schemaRetryCount: 2,
      nodeRetryCount: 1,
      timeoutMs: 30000,
    },
  });

  const firstView = builder.view();
  assert.deepEqual(firstView.nodes[0].config, {
    name: "Analyze Requirement",
    description: "Classify the incoming request",
    instruction: "Analyze the user request and return a structured summary.",
    visibility: "auto",
    contextPolicy: {
      conversationHistory: true,
      userInput: true,
      uploadedFiles: false,
    },
    outputSchema: null,
    toolPolicy: { mode: "disabled" },
    retryPolicy: {
      schemaRetryCount: 2,
      nodeRetryCount: 1,
      timeoutMs: 30000,
    },
  });

  firstView.nodes[0].config.contextPolicy.userInput = false;
  firstView.nodes[0].config.retryPolicy.timeoutMs = 1;

  assert.equal(builder.view().nodes[0].config.contextPolicy.userInput, true);
  assert.equal(builder.view().nodes[0].config.retryPolicy.timeoutMs, 30000);
});
