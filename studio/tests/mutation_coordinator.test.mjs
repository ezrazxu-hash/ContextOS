import assert from "node:assert/strict";
import test from "node:test";

import { ClientError } from "../src/client/http.js";
import { createMutationCoordinator } from "../src/client/mutationCoordinator.js";

test("UI02-T04-TC01 double-clicking Evict creates one effective request", async () => {
  let calls = 0;
  const coordinator = createMutationCoordinator();

  const first = coordinator.contextGroup("group-1", "evict", async () => {
    calls += 1;
    await Promise.resolve();
    return { ok: true };
  });
  const second = coordinator.contextGroup("group-1", "evict", async () => {
    calls += 1;
    return { ok: true };
  });

  assert.equal(await first, await second);
  assert.equal(calls, 1);
  assert.equal(coordinator.isPending("context-group:group-1"), false);
});

test("UI02-T04-TC02 version conflict requests reload instead of overwriting local state", async () => {
  const revalidated = [];
  const notifications = [];
  const optimistic = [];
  const coordinator = createMutationCoordinator({
    revalidate: (keys) => revalidated.push(...keys),
    notifyConflict: (details) => notifications.push(details),
  });

  const result = await coordinator.run({
    scope: "message:message-1",
    revalidateKeys: [["runtime", "messages", "session-1", "timeline-1"]],
    optimisticUpdate: () => optimistic.push("applied"),
    commit: async () => {
      throw new ClientError({
        code: "message.version_conflict",
        message: "Message revision is stale",
        requestId: "req-409",
        status: 409,
      });
    },
  });

  assert.deepEqual(result, {
    status: "conflict",
    code: "message.version_conflict",
    message: "Message revision is stale",
    requestId: "req-409",
    prompt: "reload_required",
  });
  assert.deepEqual(optimistic, []);
  assert.deepEqual(revalidated, [["runtime", "messages", "session-1", "timeline-1"]]);
  assert.equal(notifications[0].scope, "message:message-1");
});

test("UI02-T04-TC03 replay failure keeps UI state based on server projection", async () => {
  const revalidated = [];
  const localState = { timelineId: "timeline-before" };
  const coordinator = createMutationCoordinator({
    revalidate: (keys) => revalidated.push(...keys),
  });

  const result = await coordinator.run({
    scope: "replay:plan-1",
    dangerous: true,
    revalidateKeys: [
      ["runtime", "snapshot", "session-1"],
      ["runtime", "timeline", "session-1", "timeline-before"],
    ],
    optimisticUpdate: () => {
      localState.timelineId = "optimistic-timeline";
    },
    commit: async () => {
      throw new ClientError({
        code: "replay.failed",
        message: "Replay failed",
        requestId: "req-replay",
        status: 500,
      });
    },
  });

  assert.equal(result.status, "failed");
  assert.equal(localState.timelineId, "timeline-before");
  assert.deepEqual(revalidated, [
    ["runtime", "snapshot", "session-1"],
    ["runtime", "timeline", "session-1", "timeline-before"],
  ]);
});
