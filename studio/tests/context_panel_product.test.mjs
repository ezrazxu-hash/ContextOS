import assert from "node:assert/strict";
import test from "node:test";

import { createContextPanel } from "../src/features/context-panel/ContextPanel.js";

test("UI04-T01-TC01 token meter refreshes after context state changes", async () => {
  let evicted = false;
  const panel = createContextPanel({
    async fetchSessionContext() {
      return [
        { id: "item-1", group_id: "group-1", state: evicted ? "EVICTED" : "RAW", token_count_effective: evicted ? 0 : 12 },
        { id: "item-2", group_id: "group-1", state: evicted ? "EVICTED" : "RAW", token_count_effective: evicted ? 0 : 8 },
      ];
    },
    async evictGroup() {
      evicted = true;
      return { ok: true };
    },
  }, { sessionId: "session-1", maxTokens: 100 });

  const before = await panel.refresh();
  const after = await panel.evict("group-1");

  assert.deepEqual(before.tokenMeter, { current: 20, max: 100, remaining: 80, percent: 20 });
  assert.deepEqual(after.tokenMeter, { current: 0, max: 100, remaining: 100, percent: 0 });
});

test("UI04-T01-TC02 1000+ context items do not render all details at once", async () => {
  const panel = createContextPanel({
    async fetchSessionContext() {
      return Array.from({ length: 1200 }, (_, index) => ({
        id: `item-${index}`,
        group_id: `group-${Math.floor(index / 3)}`,
        state: "RAW",
        effective_content: `effective ${index}`,
        raw_content: `raw ${index}`,
        token_count_effective: 1,
      }));
    },
  }, { sessionId: "session-1", maxTokens: 2000, renderLimit: 40 });

  const view = await panel.refresh();

  assert.equal(view.productSections.RAW.totalCount, 1200);
  assert.equal(view.productSections.RAW.renderedItems.length, 40);
  assert.equal("raw_content" in view.productSections.RAW.renderedItems[0], false);
});

test("UI04-T01-TC03 context state is readable by screen readers and not color-only", async () => {
  const panel = createContextPanel({
    async fetchSessionContext() {
      return [
        { id: "pin", group_id: "g1", state: "PINNED", token_count_effective: 3 },
        { id: "evict", group_id: "g2", state: "EVICTED", token_count_effective: 0 },
      ];
    },
  }, { sessionId: "session-1", maxTokens: 10 });

  const view = await panel.refresh();

  assert.equal(view.productSections.PINNED.stateLabel, "Pinned");
  assert.equal(view.productSections.PINNED.icon, "pin");
  assert.equal(view.productSections.PINNED.ariaLabel, "Pinned context, 1 item, 3 tokens");
  assert.equal(view.productSections.EVICTED.ariaLabel, "Evicted context, 1 item, 0 tokens");
});
