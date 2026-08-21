import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\tests$/, "");

function moduleUrl(relativePath) {
  return pathToFileURL(join(studioRoot, relativePath)).href;
}

test("single tool interaction displays call and result", async () => {
  const { createToolInteractionCard } = await import(moduleUrl("src/features/conversation/ToolInteractionCard.js"));

  const card = createToolInteractionCard({
    groupId: "group-1",
    toolCalls: [{ tool_call_id: "call-1", name: "lookup", arguments: { order: "A-42" } }],
    toolResults: [{ tool_call_id: "call-1", content: "shipped" }],
  });

  assert.equal(card.status, "complete");
  assert.equal(card.tools[0].callId, "call-1");
  assert.equal(card.tools[0].result.content, "shipped");
  assert.equal(card.expandable, false);
});

test("out-of-order multiple tools map by tool_call_id", async () => {
  const { createToolInteractionCard } = await import(moduleUrl("src/features/conversation/ToolInteractionCard.js"));

  const card = createToolInteractionCard({
    groupId: "group-1",
    expanded: true,
    toolCalls: [
      { tool_call_id: "call-a", name: "first" },
      { tool_call_id: "call-b", name: "second" },
    ],
    toolResults: [
      { tool_call_id: "call-b", content: "B result" },
      { tool_call_id: "call-a", content: "A result" },
    ],
  });

  assert.equal(card.expandable, true);
  assert.deepEqual(card.tools.map((tool) => [tool.callId, tool.result.content]), [
    ["call-a", "A result"],
    ["call-b", "B result"],
  ]);
});

test("incomplete group displays issue and no single call or result delete actions", async () => {
  const { createToolInteractionCard } = await import(moduleUrl("src/features/conversation/ToolInteractionCard.js"));

  const card = createToolInteractionCard({
    groupId: "group-1",
    toolCalls: [
      { tool_call_id: "call-a", name: "first" },
      { tool_call_id: "call-b", name: "second" },
    ],
    toolResults: [{ tool_call_id: "call-a", content: "A result" }],
  });

  assert.equal(card.status, "incomplete");
  assert.deepEqual(card.missingResultCallIds, ["call-b"]);
  assert.equal(card.issue.code, "missing_tool_result");
  assert.ok(!card.actions.includes("delete_call"));
  assert.ok(!card.actions.includes("delete_result"));
});
