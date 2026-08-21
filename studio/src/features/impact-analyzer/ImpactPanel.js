export function createImpactPanel({ issues = [], sideEffects = [] } = {}) {
  return {
    view() {
      const warnings = issues.map(formatIssue).filter(Boolean);
      return {
        hasRisk: warnings.length > 0 || sideEffects.length > 0,
        warnings,
        sideEffects: sideEffects.map((item) => ({
          toolId: item.tool_id,
          sideEffect: item.side_effect,
          replayPolicy: item.replay_policy,
        })),
      };
    },
  };
}

function formatIssue(issue) {
  if (issue.issue_type === "message_tool_result_conflict") {
    return {
      title: "Message conflicts with ToolResult",
      severity: issue.severity,
      explanation: explanationForConflict(issue.evidence),
      relatedIds: [...issue.related_ids],
    };
  }
  return null;
}

function explanationForConflict(evidence) {
  if (evidence.edited_signal === "refunded" && evidence.tool_result_status === "shipped") {
    return "Edited message says refunded while ToolResult says shipped.";
  }
  return "Edited message may conflict with a historical ToolResult.";
}

