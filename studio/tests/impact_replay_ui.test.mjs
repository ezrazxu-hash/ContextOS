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
