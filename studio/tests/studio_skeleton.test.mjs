import { existsSync, readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\tests$/, "");
const srcRoot = join(studioRoot, "src");

function moduleUrl(relativePath) {
  return pathToFileURL(join(studioRoot, relativePath)).href;
}

function createMemoryStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    key(index) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    get length() {
      return values.size;
    },
  };
}

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(fullPath) : [fullPath];
  });
}

test("routes load the four Studio V1 pages", async () => {
  assert.ok(existsSync(join(studioRoot, "src/features/navigation/router.js")), "missing Studio router module");
  const { createStudioRouter } = await import(moduleUrl("src/features/navigation/router.js"));
  const router = createStudioRouter();

  const expectedRoutes = [
    ["/chat", "Chat"],
    ["/workflow", "Workflow"],
    ["/template", "Template"],
    ["/debug", "Debug"],
  ];

  assert.deepEqual(router.paths(), expectedRoutes.map(([path]) => path));
  for (const [path, pageName] of expectedRoutes) {
    const page = router.resolve(path);
    assert.equal(page.name, pageName);
    assert.equal(page.kind, "studio-page");
  }
});

test("runtime facts rehydrate from backend projection after browser cache is cleared", async () => {
  globalThis.localStorage = createMemoryStorage({
    timeline: "stale-browser-timeline",
    checkpoint: "stale-browser-checkpoint",
    context: "stale-browser-context",
  });
  globalThis.localStorage.clear();

  assert.ok(existsSync(join(studioRoot, "src/features/uiState/store.js")), "missing UI state store module");
  assert.ok(existsSync(join(studioRoot, "src/features/runtimeProjection/store.js")), "missing Runtime projection store module");
  const { createUiStateStore } = await import(moduleUrl("src/features/uiState/store.js"));
  const { createRuntimeProjectionStore } = await import(moduleUrl("src/features/runtimeProjection/store.js"));

  const uiState = createUiStateStore();
  uiState.selectMessage("message-1");
  uiState.setCurrentPanel("context");
  uiState.setGraphViewport({ x: 12, y: 24, zoom: 1.5 });

  const calls = [];
  const apiClient = {
    async fetchRehydrateSnapshot(sessionId) {
      calls.push(sessionId);
      return {
        sessionId,
        timelineId: "timeline-from-backend",
        checkpointId: "checkpoint-from-backend",
        contextRevision: "context-revision-from-backend",
      };
    },
  };
  const runtimeProjection = createRuntimeProjectionStore(apiClient);

  const snapshot = await runtimeProjection.rehydrate("session-1");

  assert.deepEqual(calls, ["session-1"]);
  assert.equal(snapshot.timelineId, "timeline-from-backend");
  assert.equal(snapshot.checkpointId, "checkpoint-from-backend");
  assert.equal(snapshot.contextRevision, "context-revision-from-backend");
  assert.deepEqual(uiState.getState(), {
    selectedMessageId: "message-1",
    currentPanel: "context",
    graphViewport: { x: 12, y: 24, zoom: 1.5 },
  });
  assert.equal(globalThis.localStorage.getItem("timeline"), null);
  assert.equal(globalThis.localStorage.getItem("checkpoint"), null);
  assert.equal(globalThis.localStorage.getItem("context"), null);
});

test("studio source does not import backend implementation files", () => {
  assert.ok(existsSync(srcRoot), "missing Studio source directory");
  const sourceFiles = listFiles(srcRoot).filter((file) => file.endsWith(".js"));
  assert.ok(sourceFiles.length > 0, "expected Studio source files");

  for (const file of sourceFiles) {
    const source = readFileSync(file, "utf-8");
    assert.doesNotMatch(source, /from\s+["'][^"']*backend\/src/);
    assert.doesNotMatch(source, /from\s+["'][^"']*contextos\/(runtime|context|provider|tool|template|api)/);
  }
});
