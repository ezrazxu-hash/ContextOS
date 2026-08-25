import assert from "node:assert/strict";
import test from "node:test";

import { createMessageCard } from "../src/features/conversation/MessageCard.js";
import { createToolInteractionCard } from "../src/features/conversation/ToolInteractionCard.js";

test("UI03-T03-TC01 long ToolResult is summarized without horizontal overflow", () => {
  const longJson = JSON.stringify({ rows: Array.from({ length: 120 }, (_, index) => ({ index, value: "x".repeat(20) })) });
  const card = createToolInteractionCard({
    groupId: "group-long",
    toolCalls: [{ tool_call_id: "call-long", name: "query_sales", arguments: { quarter: "Q3" } }],
    toolResults: [{ tool_call_id: "call-long", content: longJson }],
  });

  assert.equal(card.layout.overflowX, "hidden");
  assert.equal(card.tools[0].resultPreview.truncated, true);
  assert.equal(card.tools[0].resultPreview.action, "open_raw_drawer");
});

test("UI03-T03-TC02 user modified assistant message is distinguishable from a normal assistant message", () => {
  const normal = createMessageCard({ id: "message-a", role: "assistant", content: "ok", status: "completed" });
  const modified = createMessageCard({
    id: "message-b",
    role: "assistant",
    content: "edited",
    status: "completed",
    user_modified: true,
    revision_id: "revision-1",
  });

  assert.equal(normal.presentation.variant, "assistant");
  assert.equal(modified.presentation.variant, "assistant-modified");
  assert.deepEqual(modified.presentation.badges, ["User Modified"]);
  assert.equal(modified.revisionId, "revision-1");
});

test("UI03-T03-TC03 tool error keeps call id and trace link in Developer Mode", () => {
  const card = createToolInteractionCard({
    groupId: "group-error",
    developerMode: true,
    toolCalls: [{ tool_call_id: "call-error", name: "send_email", trace_id: "trace-email" }],
    toolResults: [{ tool_call_id: "call-error", status: "error", error: { code: "smtp_failed", message: "SMTP failed" } }],
  });

  assert.equal(card.status, "failed");
  assert.equal(card.issue.code, "tool_result_error");
  assert.equal(card.tools[0].developer.callId, "call-error");
  assert.equal(card.tools[0].developer.traceId, "trace-email");
});
