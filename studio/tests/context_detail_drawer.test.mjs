import assert from "node:assert/strict";
import test from "node:test";

import { createContextPanel } from "../src/features/context-panel/ContextPanel.js";

test("UI04-T02-TC01 opening detail does not download raw until Raw tab is selected", async () => {
  const calls = [];
  const panel = createContextPanel({
    async fetchSessionContext() {
      calls.push("context");
      return [
        {
          id: "item-1",
          group_id: "group-1",
          state: "RAW",
          effective_content: "effective projection",
          raw_content: "raw projection should stay out of detail summary",
          token_count_effective: 2,
        },
      ];
    },
    async fetchRevisions(itemId) {
      calls.push(`revisions:${itemId}`);
      return [];
    },
    async fetchRaw(itemId) {
      calls.push(`raw:${itemId}`);
      return { id: itemId, raw_content: "full raw" };
    },
  }, { sessionId: "session-1", maxTokens: 10 });

  await panel.refresh();
  const detail = await panel.openDetail("item-1");

  assert.deepEqual(calls, ["context", "revisions:item-1"]);
  assert.equal(detail.tabs.raw.loaded, false);
  assert.equal(detail.summary.rawContentLoaded, false);
});

test("UI04-T02-TC02 restoring system version refreshes revision list", async () => {
  let restored = false;
  const panel = createContextPanel({
    async fetchSessionContext() {
      return [
        {
          id: "item-1",
          group_id: "group-1",
          state: "RAW",
          effective_content: restored ? "system generated" : "user override",
          generated_content: "system generated",
          user_override: restored ? null : "user override",
          token_count_effective: 2,
        },
      ];
    },
    async fetchRevisions() {
      return restored
        ? [
            { id: "rev-1", context_item_id: "item-1", revision_type: "USER_EDIT" },
            { id: "rev-2", context_item_id: "item-1", revision_type: "USER_RESTORE" },
          ]
        : [{ id: "rev-1", context_item_id: "item-1", revision_type: "USER_EDIT" }];
    },
    async restoreSystemVersion(itemId) {
      assert.equal(itemId, "item-1");
      restored = true;
      return { id: "item-1", effective_content: "system generated", user_override: null };
    },
  }, { sessionId: "session-1", maxTokens: 10 });

  await panel.refresh();
  await panel.openDetail("item-1");
  const detail = await panel.restoreSystemVersion("item-1");

  assert.equal(detail.item.effective_content, "system generated");
  assert.equal(detail.userModified, false);
  assert.deepEqual(detail.tabs.revisions.items.map((revision) => revision.id), ["rev-1", "rev-2"]);
});

test("UI04-T02-TC03 effective content and sources match backend projection", async () => {
  const panel = createContextPanel({
    async fetchSessionContext() {
      return [
        {
          id: "item-1",
          group_id: "group-1",
          state: "ABSTRACT",
          effective_content: "projected effective content",
          generated_content: "projected generated content",
          user_override: null,
          source: { ids: ["external:doc-1"], type: "external", trust: "unverified" },
          source_ids: ["external:doc-1"],
          token_count_effective: 3,
        },
      ];
    },
    async fetchRevisions() {
      return [];
    },
  }, { sessionId: "session-1", maxTokens: 10 });

  await panel.refresh();
  const detail = await panel.openDetail("item-1");

  assert.equal(detail.tabs.effective.content, "projected effective content");
  assert.deepEqual(detail.tabs.sources.source, { ids: ["external:doc-1"], type: "external", trust: "unverified" });
});
