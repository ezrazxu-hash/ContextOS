export function createImpactPanel({ issues = [], sideEffects = [] } = {}) {
  return {
    view() {
      const warnings = issues.map(formatIssue).filter(Boolean);
      return {
        hasRisk: warnings.length > 0 || sideEffects.length > 0,
        warnings,
        riskCategories: riskCategories(issues, sideEffects),
        sideEffects: sideEffects.map((item) => ({
          toolId: item.tool_id,
          sideEffect: item.side_effect,
          replayPolicy: item.replay_policy,
        })),
      };
    },
  };
}

function riskCategories(issues, sideEffects) {
  return [
    ...issues.map((issue) => categoryForIssue(issue)).filter(Boolean),
    ...sideEffects.map((item) => ({
      kind: "side_effect",
      severity: riskSeverityForSideEffect(item.side_effect),
      relatedIds: [item.tool_id],
    })),
  ];
}

function categoryForIssue(issue) {
  if (issue.issue_type === "message_tool_result_conflict" || issue.issue_type === "message_tool_result_uncertain") {
    return { kind: "semantic_conflict", severity: issue.severity, relatedIds: [...(issue.related_ids ?? [])] };
  }
  if (issue.issue_type === "tool_argument_dependency" || issue.issue_type === "tool_call_parameter_impact") {
    return { kind: "tool_args", severity: issue.severity, relatedIds: [...(issue.related_ids ?? [])] };
  }
  if (issue.issue_type === "state_dependency") {
    return { kind: "state", severity: issue.severity, relatedIds: [...(issue.related_ids ?? [])] };
  }
  if (issue.issue_type === "graph_dependency") {
    return { kind: "graph", severity: issue.severity, relatedIds: [...(issue.related_ids ?? [])] };
  }
  return null;
}

function riskSeverityForSideEffect(sideEffect) {
  if (["WRITE", "EXTERNAL_WRITE", "DESTRUCTIVE", "FINANCIAL"].includes(sideEffect)) {
    return "warning";
  }
  return "info";
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
