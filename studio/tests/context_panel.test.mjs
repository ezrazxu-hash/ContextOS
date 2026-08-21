import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\tests$/, "");

function moduleUrl(relativePath) {
  return pathToFileURL(join(studioRoot, relativePath)).href;
}

test("evict refreshes server projection and updates state and tokens", async () => {
  const { createContextPanel } = await import(moduleUrl("src/features/context-panel/ContextPanel.js"));

  let evicted = false;
  const apiClient = {
    async fetchSessionContext() {
      return [
        { id: "item-1", group_id: "group-1", state: evicted ? "EVICTED" : "RAW", token_count_effective: evicted ? 0 : 3 },
      ];
    },
    async evictGroup(groupId) {
      assert.equal(groupId, "group-1");
      evicted = true;
      return { ok: true };
    },
  };
  const panel = createContextPanel(apiClient, { sessionId: "session-1", maxTokens: 10 });

  await panel.refresh();
  const afterEvict = await panel.evict("group-1");

  assert.equal(afterEvict.sections.EVICTED[0].id, "item-1");
  assert.deepEqual(afterEvict.tokenUsage, { current: 0, max: 10, remaining: 10 });
});

test("failed operation does not pretend local success", async () => {
  const { createContextPanel } = await import(moduleUrl("src/features/context-panel/ContextPanel.js"));

  const calls = [];
  const apiClient = {
    async fetchSessionContext() {
      calls.push("fetch");
      return [{ id: "item-1", group_id: "group-1", state: "RAW", token_count_effective: 3 }];
    },
    async evictGroup() {
      calls.push("evict");
      return { ok: false, error: "denied" };
    },
  };
  const panel = createContextPanel(apiClient, { sessionId: "session-1", maxTokens: 10 });

  const before = await panel.refresh();
  const after = await panel.evict("group-1");

  assert.deepEqual(calls, ["fetch", "evict"]);
  assert.equal(before.sections.RAW[0].state, "RAW");
  assert.equal(after.sections.RAW[0].state, "RAW");
  assert.equal(after.lastError, "denied");
});

test("view raw fetches original content from API and operations are available", async () => {
  const { createContextPanel } = await import(moduleUrl("src/features/context-panel/ContextPanel.js"));

  const apiClient = {
    async fetchSessionContext() {
      return [];
    },
    async fetchRaw(itemId) {
      assert.equal(itemId, "item-1");
      return { id: "item-1", raw_content: "original raw" };
    },
  };
  const panel = createContextPanel(apiClient, { sessionId: "session-1", maxTokens: 10 });

  const raw = await panel.viewRaw("item-1");

  assert.equal(raw.rawContent, "original raw");
  assert.deepEqual(panel.operations, ["pin", "unpin", "abstract", "evict", "restore", "view_raw"]);
});
