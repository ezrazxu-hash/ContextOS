export function createToolInteractionCard({ groupId, toolCalls = [], toolResults = [], expanded = false, developerMode = false }) {
  const resultsByCallId = new Map(toolResults.map((result) => [toolCallId(result), result]));
  const tools = toolCalls.map((call) => {
    const callId = toolCallId(call);
    const result = resultsByCallId.get(callId) ?? null;
    return {
      callId,
      name: call.name,
      arguments: call.arguments ?? {},
      result,
      resultPreview: result ? previewResult(result) : null,
      developer: developerMode
        ? {
            callId,
            traceId: call.trace_id ?? result?.trace_id ?? null,
          }
        : null,
    };
  });
  const missingResultCallIds = tools.filter((tool) => tool.result === null).map((tool) => tool.callId);
  const failedTools = tools.filter((tool) => isErrorResult(tool.result));
  const complete = missingResultCallIds.length === 0 && failedTools.length === 0;
  const visibleTools = expanded ? tools : tools.slice(0, 1);
  const status = failedTools.length > 0 ? "failed" : complete ? "complete" : "incomplete";

  return {
    groupId,
    status,
    layout: { overflowX: "hidden" },
    expandable: tools.length > 1,
    expanded,
    tools: visibleTools,
    toolCount: tools.length,
    missingResultCallIds,
    issue:
      status === "failed"
        ? {
            code: "tool_result_error",
            message: "Tool result failed",
            failedCallIds: failedTools.map((tool) => tool.callId),
          }
        : complete
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

function previewResult(result) {
  const raw = result.content ?? result.output ?? result.result ?? "";
  const text = typeof raw === "string" ? raw : JSON.stringify(raw);
  const truncated = text.length > 240;
  return {
    summary: truncated ? `${text.slice(0, 240)}...` : text,
    truncated,
    action: truncated ? "open_raw_drawer" : null,
  };
}

function isErrorResult(result) {
  return result?.status === "error" || Boolean(result?.error);
}
