import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\tests$/, "");

function moduleUrl(relativePath) {
  return pathToFileURL(join(studioRoot, relativePath)).href;
}

test("UI02-T02 message and context caches are isolated per session", async () => {
  const { createProjectionCache, queryKeys } = await import(moduleUrl("src/client/projectionCache.js"));
  const cache = createProjectionCache();

  cache.set(queryKeys.messages("session-a", "timeline-a"), [{ id: "message-a" }]);
  cache.set(queryKeys.context("session-a"), [{ id: "context-a" }]);
  cache.set(queryKeys.messages("session-b", "timeline-b"), [{ id: "message-b" }]);
  cache.set(queryKeys.context("session-b"), [{ id: "context-b" }]);

  assert.deepEqual(cache.get(queryKeys.messages("session-a", "timeline-a")), [{ id: "message-a" }]);
  assert.deepEqual(cache.get(queryKeys.context("session-a")), [{ id: "context-a" }]);
  assert.deepEqual(cache.get(queryKeys.messages("session-b", "timeline-b")), [{ id: "message-b" }]);
  assert.deepEqual(cache.get(queryKeys.context("session-b")), [{ id: "context-b" }]);
});

test("UI02-T02 refresh rehydrates from backend snapshot instead of localStorage", async () => {
  const { createProjectionCache, queryKeys } = await import(moduleUrl("src/client/projectionCache.js"));
  globalThis.localStorage = {
    getItem(key) {
      return key === "runtime:snapshot:session-a" ? JSON.stringify({ timelineId: "stale-local" }) : null;
    },
  };
  const calls = [];
  const cache = createProjectionCache({
    async fetchRuntimeSnapshot(sessionId) {
      calls.push(sessionId);
      return { sessionId, timelineId: "timeline-from-backend", contextRevision: "rev-backend" };
    },
  });

  const snapshot = await cache.rehydrateSession("session-a");

  assert.deepEqual(calls, ["session-a"]);
  assert.equal(snapshot.timelineId, "timeline-from-backend");
  assert.deepEqual(cache.get(queryKeys.snapshot("session-a")), snapshot);
});

test("UI02-T02 mutation invalidates only affected query keys", async () => {
  const { createProjectionCache, queryKeys } = await import(moduleUrl("src/client/projectionCache.js"));
  const cache = createProjectionCache();
  const affected = queryKeys.context("session-a");
  const unaffected = queryKeys.context("session-b");

  cache.set(affected, [{ id: "context-a" }]);
  cache.set(unaffected, [{ id: "context-b" }]);
  const invalidated = cache.invalidateAffected([affected]);

  assert.deepEqual(invalidated, [affected]);
  assert.equal(cache.get(affected), undefined);
  assert.deepEqual(cache.get(unaffected), [{ id: "context-b" }]);
});
