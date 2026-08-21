export function createToolInteractionCard({ groupId, toolCalls = [], toolResults = [], expanded = false }) {
  const resultsByCallId = new Map(toolResults.map((result) => [toolCallId(result), result]));
  const tools = toolCalls.map((call) => {
    const callId = toolCallId(call);
    return {
      callId,
      name: call.name,
      arguments: call.arguments ?? {},
      result: resultsByCallId.get(callId) ?? null,
    };
  });
  const missingResultCallIds = tools.filter((tool) => tool.result === null).map((tool) => tool.callId);
  const complete = missingResultCallIds.length === 0;
  const visibleTools = expanded ? tools : tools.slice(0, 1);

  return {
    groupId,
    status: complete ? "complete" : "incomplete",
    expandable: tools.length > 1,
    expanded,
    tools: visibleTools,
    toolCount: tools.length,
    missingResultCallIds,
    issue: complete
      ? null
      : {
          code: "missing_tool_result",
          message: "Tool interaction has ToolCall without matching ToolResult",
        },
    actions: ["view_group"],
  };
}

function toolCallId(entry) {
  return entry.tool_call_id ?? entry.call_id;
}
