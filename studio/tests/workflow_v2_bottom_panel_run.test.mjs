import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\tests$/, "");
const mainSource = () => readFile(join(studioRoot, "src/main.js"), "utf8");

test("Workflow V2 bottom panel exposes Run as the unified run tab", async () => {
  const source = await mainSource();

  assert.match(source, /data-bottom-tab="run"/);
  assert.match(source, /data-testid="workflow-v2-bottom-tab-run"/);
  assert.match(source, /activeTab === "run"/);
  assert.match(source, /tab !== "run" && tab !== "execution-trace" && tab !== "edge-relations"/);
});

test("Workflow V2 Run tab reuses the existing input and run action while retaining output state", async () => {
  const source = await mainSource();
  const bottomPanel = source.slice(source.indexOf("function renderWorkflowV2BottomPanel"), source.indexOf("function renderWorkflowV2ExecutionTrace"));

  assert.match(bottomPanel, /data-testid="workflow-v2-run-input"/);
  assert.match(bottomPanel, /state\.workflowTestInput/);
  assert.match(bottomPanel, /data-action="run-workflow-v2"/);
  assert.match(bottomPanel, /run\?\.output/);
  assert.match(bottomPanel, /run\?\.error/);
});

test("Workflow V2 does not render a duplicate Run section in the node inspector", async () => {
  const source = await mainSource();
  const workflowPage = source.slice(source.indexOf("function renderWorkflowV2()"), source.indexOf("function renderWorkflowV2CanvasBody"));

  assert.doesNotMatch(workflowPage, /agent-test-section/);
  assert.doesNotMatch(workflowPage, /workflow-v2-run-panel/);
});
