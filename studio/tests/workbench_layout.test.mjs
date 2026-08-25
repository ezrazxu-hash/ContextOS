import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\tests$/, "");

function moduleUrl(relativePath) {
  return pathToFileURL(join(studioRoot, relativePath)).href;
}

function createPlatform() {
  const uiState = new Map();
  const runtimeWrites = [];
  return {
    platform: {
      readUiState(key) {
        return uiState.get(key) ?? null;
      },
      writeUiState(key, value) {
        uiState.set(key, value);
      },
      writeRuntimeFact(key, value) {
        runtimeWrites.push([key, value]);
      },
    },
    uiState,
    runtimeWrites,
  };
}

test("UI00-T03 dragging side panels keeps main content within viewport", async () => {
  const { createWorkbenchLayout } = await import(moduleUrl("src/design-system/layout/workbenchLayout.js"));
  const { platform, runtimeWrites } = createPlatform();

  const layout = createWorkbenchLayout(platform, { viewportWidth: 1280 });
  layout.resizePanel("left", 360);
  layout.resizePanel("right", 380);
  layout.resizePanel("bottom", 260);
  const view = layout.view();

  assert.equal(view.panels.left.width, 360);
  assert.equal(view.panels.right.width, 380);
  assert.equal(view.panels.main.width, 540);
  assert.equal(view.panels.main.overflowX, "hidden");
  assert.equal(view.panels.bottom.height, 260);
  assert.deepEqual(runtimeWrites, []);
});

test("UI00-T03 layout preferences restore after refresh through UI storage only", async () => {
  const { createWorkbenchLayout } = await import(moduleUrl("src/design-system/layout/workbenchLayout.js"));
  const { platform, runtimeWrites } = createPlatform();

  createWorkbenchLayout(platform, { layoutId: "chat", viewportWidth: 1440 }).resizePanel("right", 420);
  const restored = createWorkbenchLayout(platform, { layoutId: "chat", viewportWidth: 1440 }).view();

  assert.equal(restored.panels.right.width, 420);
  assert.equal(restored.storageScope, "ui-only");
  assert.deepEqual(runtimeWrites, []);
});

test("UI00-T03 right panel downgrades to drawer on narrow viewport without covering main action", async () => {
  const { createWorkbenchLayout } = await import(moduleUrl("src/design-system/layout/workbenchLayout.js"));
  const { platform } = createPlatform();

  const layout = createWorkbenchLayout(platform, { viewportWidth: 720 });
  const view = layout.view();

  assert.equal(view.panels.right.mode, "drawer");
  assert.equal(view.panels.main.primaryActionVisible, true);
  assert.ok(view.panels.main.width >= view.panels.main.minWidth);
});

test("UI00-T03 collapse and reset default preserve layout invariants", async () => {
  const { createWorkbenchLayout } = await import(moduleUrl("src/design-system/layout/workbenchLayout.js"));
  const { platform } = createPlatform();

  const layout = createWorkbenchLayout(platform, { viewportWidth: 1280 });
  layout.collapsePanel("left");
  assert.equal(layout.view().panels.left.collapsed, true);
  assert.ok(layout.view().panels.main.width > 800);

  layout.resetDefault();
  assert.deepEqual(layout.view().preferences, {
    left: 280,
    right: 320,
    bottom: 240,
    collapsed: {},
  });
});
