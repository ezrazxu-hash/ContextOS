import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\tests$/, "");

function moduleUrl(relativePath) {
  return pathToFileURL(join(studioRoot, relativePath)).href;
}

test("UI08-T03-TC01: 1280+ desktop golden baselines exist for Chat Workflow and Debug", async () => {
  const { visualBaselines } = await import(moduleUrl("src/visual/visualBaselines.js"));
  const pages = visualBaselines.pages.filter((page) => page.viewport.width >= 1280);

  assert.deepEqual(pages.map((page) => page.id), ["chat-default", "workflow-default", "debug-default"]);
  assert.ok(pages.every((page) => page.kind === "golden-screenshot"));
});

test("UI08-T03-TC02: Replay danger modal has an independent screenshot baseline", async () => {
  const { visualBaselines } = await import(moduleUrl("src/visual/visualBaselines.js"));

  assert.deepEqual(visualBaselines.riskModal, {
    id: "replay-danger-modal",
    kind: "golden-screenshot",
    state: "risk-modal",
    reviewRequired: true,
  });
});

test("UI08-T03-TC03: Workflow selected node and config panel state has a baseline", async () => {
  const { visualBaselines } = await import(moduleUrl("src/visual/visualBaselines.js"));
  const packageJson = JSON.parse(readFileSync(join(studioRoot, "package.json"), "utf8"));

  assert.deepEqual(visualBaselines.workflowSelectedNode, {
    id: "workflow-selected-node-config",
    kind: "golden-screenshot",
    state: "selected-node-config-panel",
    reviewRequired: true,
  });
  assert.equal(visualBaselines.reviewPolicy.autoAccept, false);
  assert.match(packageJson.scripts["test:visual"], /(@playwright\/test|playwright) test/);
});
