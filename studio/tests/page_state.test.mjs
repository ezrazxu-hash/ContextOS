import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\tests$/, "");

function moduleUrl(relativePath) {
  return pathToFileURL(join(studioRoot, relativePath)).href;
}

test("UI00-T04 API 500 keeps recoverable navigation instead of blanking the page", async () => {
  const { createAsyncBoundary, toClientError } = await import(moduleUrl("src/app/pageState.js"));

  const boundary = createAsyncBoundary({
    navigation: [{ label: "Chat", path: "/chat" }, { label: "Debug", path: "/debug" }],
  });
  const state = boundary.fail(
    toClientError({
      error: {
        code: "runtime_error",
        message: "Runtime failed",
        request_id: "req-500",
        status: 500,
      },
    }),
  );

  assert.equal(state.kind, "error");
  assert.equal(state.recoverable, true);
  assert.deepEqual(state.navigation.map((item) => item.path), ["/chat", "/debug"]);
  assert.equal(state.error.requestId, "req-500");
  assert.notEqual(state.shellVisible, false);
});

test("UI00-T04 failed mutation rolls back pending state and never leaves fake success", async () => {
  const { createMutationState } = await import(moduleUrl("src/app/pageState.js"));

  const mutation = createMutationState({ currentProjection: { groupId: "g-1", state: "RAW" } });
  mutation.start({ optimisticProjection: { groupId: "g-1", state: "EVICTED" } });
  const failed = mutation.fail({
    code: "conflict",
    message: "Context revision conflict",
    requestId: "req-409",
    status: 409,
  });

  assert.equal(failed.kind, "failed");
  assert.deepEqual(failed.projection, { groupId: "g-1", state: "RAW" });
  assert.equal(failed.fakeSuccess, false);
  assert.equal(failed.requiresRevalidate, true);
});

test("UI00-T04 SSE disconnect exposes reconnecting stale state with clear copy", async () => {
  const { createRealtimeState } = await import(moduleUrl("src/app/pageState.js"));

  const realtime = createRealtimeState();
  const disconnected = realtime.disconnect({ lastEventId: "evt-9", retryInMs: 1500 });
  const reconnected = realtime.reconnect({ lastEventId: "evt-10" });

  assert.equal(disconnected.kind, "reconnecting");
  assert.equal(disconnected.stale, true);
  assert.equal(disconnected.retryInMs, 1500);
  assert.match(disconnected.message, /Reconnecting/);
  assert.equal(reconnected.kind, "ready");
  assert.equal(reconnected.stale, false);
  assert.equal(reconnected.lastEventId, "evt-10");
});

test("UI00-T04 page state covers loading empty permission offline stale and mutation pending", async () => {
  const { pageStates } = await import(moduleUrl("src/app/pageState.js"));

  assert.deepEqual(Object.keys(pageStates), [
    "loading",
    "empty",
    "error",
    "permission",
    "offline",
    "stale",
    "mutationPending",
  ]);
  for (const state of Object.values(pageStates)) {
    assert.ok(state.kind);
    assert.ok(state.userMessage);
  }
});
