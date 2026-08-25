import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\tests$/, "");

function moduleUrl(relativePath) {
  return pathToFileURL(join(studioRoot, relativePath)).href;
}

test("shipped/refunded impact warning is visible and explainable", async () => {
  const { createImpactPanel } = await import(moduleUrl("src/features/impact-analyzer/ImpactPanel.js"));

  const panel = createImpactPanel({
    issues: [
      {
        issue_type: "message_tool_result_conflict",
        severity: "warning",
        related_ids: ["order-status-call"],
        evidence: {
          edited_signal: "refunded",
          tool_result_status: "shipped",
          tool_result_call_id: "order-status-call",
        },
      },
    ],
    sideEffects: [{ tool_id: "send_email", side_effect: "WRITE", replay_policy: "ASK" }],
  });
  const view = panel.view();

  assert.equal(view.hasRisk, true);
  assert.deepEqual(view.warnings, [
    {
      title: "Message conflicts with ToolResult",
      severity: "warning",
      explanation: "Edited message says refunded while ToolResult says shipped.",
      relatedIds: ["order-status-call"],
    },
  ]);
  assert.deepEqual(view.sideEffects, [{ toolId: "send_email", sideEffect: "WRITE", replayPolicy: "ASK" }]);
});

test("replay dialog exposes four choices and does not default high risk to reinvoke", async () => {
  const { createReplayPlanDialog } = await import(moduleUrl("src/features/replay/ReplayPlanDialog.js"));

  const dialog = createReplayPlanDialog(
    {},
    {
      parentTimelineId: "timeline-parent",
      forkCheckpointId: "checkpoint-parent",
      forkMessageId: "message-1",
      idempotencyKey: "replay-key",
      toolCall: { tool_call_id: "send-email-call", tool_id: "send_email", side_effect: "WRITE" },
    },
  );
  const view = dialog.view();

  assert.deepEqual(view.availableActions, ["USE_HISTORY", "REINVOKE", "SKIP", "CANCEL"]);
  assert.equal(view.selectedAction, "USE_HISTORY");
  assert.equal(view.requiresConfirmation, false);
});

test("send_email reinvoke does not call replay API before confirmation", async () => {
  const { createReplayPlanDialog } = await import(moduleUrl("src/features/replay/ReplayPlanDialog.js"));

  const calls = [];
  const dialog = createReplayPlanDialog(
    {
      async replayPlan(payload) {
        calls.push(payload);
        return { status: "completed" };
      },
    },
    {
      parentTimelineId: "timeline-parent",
      forkCheckpointId: "checkpoint-parent",
      forkMessageId: "message-1",
      idempotencyKey: "replay-key",
      toolCall: { tool_call_id: "send-email-call", tool_id: "send_email", side_effect: "WRITE" },
    },
  );

  dialog.selectAction("REINVOKE");
  const result = await dialog.submit();

  assert.deepEqual(calls, []);
  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "confirmation_required");
});

test("UI04-T06-TC01 send_email reinvoke requires explicit secondary confirmation before replay API", async () => {
  const { createReplayPlanDialog } = await import(moduleUrl("src/features/replay/ReplayPlanDialog.js"));

  const calls = [];
  const dialog = createReplayPlanDialog(
    {
      async replayPlan(payload) {
        calls.push(payload);
        return { status: "completed" };
      },
    },
    {
      parentTimelineId: "timeline-parent",
      forkCheckpointId: "checkpoint-parent",
      forkMessageId: "message-1",
      idempotencyKey: "replay-key",
      toolCall: { tool_call_id: "send-email-call", tool_id: "send_email", side_effect: "WRITE" },
    },
  );

  dialog.selectAction("REINVOKE");
  assert.equal(dialog.view().confirmationStep, "secondary_required");

  const blocked = await dialog.submit();
  dialog.setConfirmationToken("CONFIRM_REINVOKE");
  const completed = await dialog.submit();

  assert.equal(blocked.status, "blocked");
  assert.equal(completed.status, "completed");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].decisions[0].confirmation_token, "CONFIRM_REINVOKE");
});

test("UI04-T06-TC02 replay modal default focus is not the reinvoke tool action", async () => {
  const { createReplayPlanDialog } = await import(moduleUrl("src/features/replay/ReplayPlanDialog.js"));

  const dialog = createReplayPlanDialog(
    {},
    {
      parentTimelineId: "timeline-parent",
      forkCheckpointId: "checkpoint-parent",
      forkMessageId: "message-1",
      idempotencyKey: "replay-key",
      toolCall: { tool_call_id: "send-email-call", tool_id: "send_email", side_effect: "WRITE" },
    },
  );

  assert.equal(dialog.view().defaultFocusAction, "CANCEL");
});

test("UI04-T06-TC03 cancelling replay modal does not call replay API", async () => {
  const { createReplayPlanDialog } = await import(moduleUrl("src/features/replay/ReplayPlanDialog.js"));

  const calls = [];
  const dialog = createReplayPlanDialog(
    {
      async replayPlan(payload) {
        calls.push(payload);
        return { status: "completed" };
      },
    },
    {
      parentTimelineId: "timeline-parent",
      forkCheckpointId: "checkpoint-parent",
      forkMessageId: "message-1",
      idempotencyKey: "replay-key",
      toolCall: { tool_call_id: "read-call", tool_id: "search", side_effect: "READ" },
    },
  );

  dialog.selectAction("CANCEL");
  const result = await dialog.submit();

  assert.deepEqual(calls, []);
  assert.deepEqual(result, { status: "cancelled" });
});

test("UI04-T06 impact panel classifies semantic tool args state graph and side effect risks", async () => {
  const { createImpactPanel } = await import(moduleUrl("src/features/impact-analyzer/ImpactPanel.js"));

  const panel = createImpactPanel({
    issues: [
      { issue_type: "message_tool_result_conflict", severity: "warning", related_ids: ["message-1"], evidence: {} },
      { issue_type: "tool_argument_dependency", severity: "warning", related_ids: ["tool-1"], evidence: {} },
      { issue_type: "state_dependency", severity: "info", related_ids: ["state-1"], evidence: {} },
      { issue_type: "graph_dependency", severity: "info", related_ids: ["node-1"], evidence: {} },
    ],
    sideEffects: [{ tool_id: "send_email", side_effect: "WRITE", replay_policy: "ASK" }],
  });

  assert.deepEqual(panel.view().riskCategories.map((item) => item.kind), [
    "semantic_conflict",
    "tool_args",
    "state",
    "graph",
    "side_effect",
  ]);
});
