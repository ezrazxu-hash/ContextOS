import { test } from "node:test";
import assert from "node:assert/strict";

import { createImpactPanel } from "../src/features/impact-analyzer/ImpactPanel.js";
import { createMessageEditor } from "../src/features/message-editor/MessageEditor.js";

test("MVP edit message shows shipped refunded warning and preserves context-only action", async () => {
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
  });
  const editor = createMessageEditor(
    {
      async saveMessageEdit(messageId, payload) {
        return {
          revision_id: "revision-1",
          impact: {
            message_id: messageId,
            revision_id: "revision-1",
            triggered: true,
            requires_replay: false,
            checks: ["message_tool_result_semantic_conflict"],
          },
          payload,
        };
      },
    },
    {
      id: "message-1",
      content: "订单已经发货。",
      checkpoint_id: "checkpoint-before-edit",
      trace_id: "trace-before-edit",
    },
  );

  editor.startEdit();
  editor.setDraft("订单已经退款。");
  const saved = await editor.save({ reason: "correct status" });
  const warningView = panel.view();

  assert.equal(saved.revisionId, "revision-1");
  assert.deepEqual(saved.availableActions, ["CONTEXT_ONLY", "CONTINUE_FROM_HERE", "REPLAY_FOLLOWING"]);
  assert.equal(warningView.warnings[0].relatedIds[0], "order-status-call");
  assert.equal(warningView.warnings[0].explanation, "Edited message says refunded while ToolResult says shipped.");
});
