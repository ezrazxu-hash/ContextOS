import { test } from "node:test";
import assert from "node:assert/strict";

import { createMessageCard } from "../src/features/conversation/MessageCard.js";
import { createToolInteractionCard } from "../src/features/conversation/ToolInteractionCard.js";

test("MVP normal chat shows assistant reply with tool call and result", () => {
  const messageCard = createMessageCard({
    id: "message-1",
    role: "assistant",
    content: "It is sunny.",
    status: "completed",
    token_count: 3,
    checkpoint_id: "checkpoint-1",
    trace_id: "trace-mvp-1",
    tool_call_ids: ["call-weather"],
    tool_result_ids: ["call-weather"],
  });
  const toolCard = createToolInteractionCard({
    groupId: "group-tool-weather",
    toolCalls: [{ tool_call_id: "call-weather", name: "weather_lookup", arguments: { city: "Shanghai" } }],
    toolResults: [{ tool_call_id: "call-weather", content: "sunny" }],
  });

  assert.equal(messageCard.content, "It is sunny.");
  assert.equal(messageCard.checkpointId, "checkpoint-1");
  assert.equal(messageCard.traceId, "trace-mvp-1");
  assert.deepEqual(messageCard.toolRelation, {
    toolCallIds: ["call-weather"],
    toolResultIds: ["call-weather"],
  });
  assert.equal(toolCard.status, "complete");
  assert.equal(toolCard.tools[0].result.content, "sunny");
});
