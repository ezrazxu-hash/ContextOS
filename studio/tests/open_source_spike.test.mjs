import { existsSync, readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\tests$/, "");
const repoRoot = dirname(studioRoot);

function moduleUrl(relativePath) {
  return pathToFileURL(join(studioRoot, relativePath)).href;
}

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(fullPath) : [fullPath];
  });
}

test("UI00-T00 third-party register locks versions, licenses, wrappers, risks, and alternatives", () => {
  const registerPath = join(repoRoot, "docs/oss/third-party-register.md");
  assert.ok(existsSync(registerPath), "missing third-party register");
  const register = readFileSync(registerPath, "utf-8");

  for (const packageName of [
    "shadcn/ui",
    "@assistant-ui/react",
    "@xyflow/react",
    "react-resizable-panels",
    "@tanstack/react-query",
    "msw",
    "monaco-editor",
  ]) {
    assert.match(register, new RegExp(`\\|\\s*${packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\|`));
  }

  assert.doesNotMatch(register, /\|\s*[^|\n]*\|\s*(latest|unknown|tbd|todo)\s*\|/i);
  assert.match(register, /\|\s*@assistant-ui\/react\s*\|\s*Optional\s*\|\s*0\.15\.16\s*\|\s*MIT\s*\|/);
  assert.match(register, /\|\s*@xyflow\/react\s*\|\s*Adopt\s*\|\s*12\.11\.3\s*\|\s*MIT\s*\|/);
  assert.match(register, /\|\s*react-resizable-panels\s*\|\s*Adopt\s*\|\s*4\.12\.3\s*\|\s*MIT\s*\|/);
});

test("UI00-T00 disabling third-party spikes does not change Runtime API contract boundaries", async () => {
  const { runtimeApiContract, thirdPartyCandidates } = await import(moduleUrl("spikes/open-source/domainContractSpike.js"));

  assert.deepEqual(runtimeApiContract.factsSource, "backend-runtime-api");
  assert.deepEqual(runtimeApiContract.serverOwnedFacts, [
    "session",
    "timeline",
    "checkpoint",
    "context",
    "revision",
    "replay",
  ]);
  assert.ok(runtimeApiContract.endpoints.includes("GET /api/sessions/{id}/context"));
  assert.ok(runtimeApiContract.endpoints.includes("POST /api/templates/{id}/run"));

  for (const candidate of thirdPartyCandidates) {
    assert.equal(candidate.runtimeFactOwner, false, `${candidate.packageName} must not own Runtime facts`);
    assert.equal(candidate.contractChangesWhenDisabled, false, `${candidate.packageName} must be removable without API changes`);
  }
});

test("UI00-T00 chat spike renders message, tool placeholder, and action slot through wrapper output", async () => {
  const { renderAssistantUiSpike } = await import(moduleUrl("spikes/open-source/chatPrimitiveSpike.js"));

  const view = renderAssistantUiSpike({
    messages: [
      { id: "m-1", role: "user", content: "Find refund status" },
      { id: "m-2", role: "assistant", content: "I will inspect the order.", toolCalls: [{ id: "tool-1", name: "lookup_order" }] },
    ],
    actionSlot: { label: "Continue from here", messageId: "m-2" },
  });

  assert.equal(view.provider, "assistant-ui-wrapper-spike");
  assert.deepEqual(view.runtimeStateOwnedBy, "ContextOS");
  assert.deepEqual(view.items.map((item) => item.kind), ["message", "message", "tool-call-placeholder", "action-slot"]);
  assert.equal(view.items.at(-1).messageId, "m-2");
});

test("UI00-T00 workflow spike creates custom Agent Tool Condition nodes and connects them", async () => {
  const { createXyflowSpike } = await import(moduleUrl("spikes/open-source/workflowCanvasSpike.js"));

  const canvas = createXyflowSpike();
  canvas.addNode({ id: "agent-1", type: "agent", label: "Agent" });
  canvas.addNode({ id: "tool-1", type: "tool", label: "Search Tool" });
  canvas.addNode({ id: "condition-1", type: "condition", label: "Has Evidence?" });
  canvas.connect("agent-1", "tool-1");
  canvas.connect("tool-1", "condition-1");

  const view = canvas.toViewModel();

  assert.equal(view.provider, "xyflow-wrapper-spike");
  assert.deepEqual(view.nodes.map((node) => node.type), ["agent", "tool", "condition"]);
  assert.deepEqual(view.edges.map((edge) => `${edge.source}->${edge.target}`), ["agent-1->tool-1", "tool-1->condition-1"]);
  assert.equal(view.capabilities.minimap, true);
  assert.equal(view.capabilities.subgraphContainer, true);
});

test("UI00-T00 resizable layout persists only through PlatformAdapter UI storage", async () => {
  const { createResizablePanelSpike } = await import(moduleUrl("spikes/open-source/resizablePanelSpike.js"));

  const runtimeCalls = [];
  const uiStorage = new Map();
  const platform = {
    readUiState(key) {
      return uiStorage.get(key) ?? null;
    },
    writeUiState(key, value) {
      uiStorage.set(key, value);
    },
    writeRuntimeFact(key, value) {
      runtimeCalls.push([key, value]);
    },
  };

  const layout = createResizablePanelSpike(platform);
  layout.resize([22, 53, 25]);
  const restored = createResizablePanelSpike(platform);

  assert.deepEqual(restored.widths(), [22, 53, 25]);
  assert.deepEqual(runtimeCalls, []);
});

test("UI00-T00 spike code stays out of production Studio source", () => {
  const sourceFiles = listFiles(join(studioRoot, "src")).filter((file) => file.endsWith(".js"));
  for (const file of sourceFiles) {
    const source = readFileSync(file, "utf-8");
    assert.doesNotMatch(source, /spikes\/open-source/);
    assert.doesNotMatch(source, /@assistant-ui\/react|@xyflow\/react|react-resizable-panels/);
  }
});
