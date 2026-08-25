import assert from "node:assert/strict";
import test from "node:test";

import { createContextPanel } from "../src/features/context-panel/ContextPanel.js";

test("UI04-T03-TC01 failed Evict keeps item in server state and exposes failure feedback", async () => {
  const panel = createContextPanel({
    async fetchSessionContext() {
      return [{ id: "item-1", group_id: "group-1", state: "RAW", token_count_effective: 4 }];
    },
    async evictGroup() {
      return { ok: false, error: "permission denied" };
    },
  }, { sessionId: "session-1", maxTokens: 10 });

  await panel.refresh();
  const after = await panel.evict("group-1");

  assert.equal(after.sections.RAW[0].id, "item-1");
  assert.equal(after.sections.EVICTED.length, 0);
  assert.deepEqual(after.groupOperations["group-1"], {
    groupId: "group-1",
    status: "failed",
    operation: "evict",
    message: "permission denied",
    disabledOperations: [],
  });
});

test("UI04-T03-TC02 Restore reallocation syncs evicted groups and keeps selected item anchored", async () => {
  let restored = false;
  const panel = createContextPanel({
    async fetchSessionContext() {
      return restored
        ? [
            { id: "restore-item", group_id: "restore-group", state: "RAW", token_count_effective: 6 },
            { id: "evicted-item", group_id: "other-group", state: "EVICTED", token_count_effective: 0 },
          ]
        : [
            { id: "restore-item", group_id: "restore-group", state: "EVICTED", token_count_effective: 0 },
            { id: "evicted-item", group_id: "other-group", state: "RAW", token_count_effective: 5 },
          ];
    },
    async restoreGroup(groupId) {
      assert.equal(groupId, "restore-group");
      restored = true;
      return {
        ok: true,
        reallocation: {
          status: "restored",
          evicted_group_ids: ["other-group"],
          final_tokens: 6,
        },
      };
    },
  }, { sessionId: "session-1", maxTokens: 10 });

  await panel.refresh();
  panel.selectItem("restore-item");
  const after = await panel.restore("restore-group");

  assert.equal(after.sections.RAW[0].id, "restore-item");
  assert.equal(after.sections.EVICTED[0].id, "evicted-item");
  assert.equal(after.selection.itemId, "restore-item");
  assert.deepEqual(after.reallocationSummary, {
    status: "restored",
    evictedGroupIds: ["other-group"],
    finalTokens: 6,
  });
});

test("UI04-T03-TC03 rapid conflicting operations do not issue a second mutation while group is pending", async () => {
  let releaseEvict;
  let evictCalls = 0;
  let restoreCalls = 0;
  const panel = createContextPanel({
    async fetchSessionContext() {
      return [{ id: "item-1", group_id: "group-1", state: "RAW", token_count_effective: 4 }];
    },
    async evictGroup() {
      evictCalls += 1;
      await new Promise((resolve) => {
        releaseEvict = resolve;
      });
      return { ok: true };
    },
    async restoreGroup() {
      restoreCalls += 1;
      return { ok: true };
    },
  }, { sessionId: "session-1", maxTokens: 10 });

  await panel.refresh();
  const evictPromise = panel.evict("group-1");
  const duringPending = panel.view();
  const restoreWhilePending = await panel.restore("group-1");
  releaseEvict();
  await evictPromise;

  assert.equal(evictCalls, 1);
  assert.equal(restoreCalls, 0);
  assert.deepEqual(duringPending.groupOperations["group-1"].disabledOperations, ["pin", "unpin", "abstract", "evict", "restore"]);
  assert.equal(restoreWhilePending.groupOperations["group-1"].status, "pending");
});
