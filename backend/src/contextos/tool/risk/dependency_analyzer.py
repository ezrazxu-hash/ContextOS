from dataclasses import dataclass
from typing import Any

from contextos.tool.risk.impact_models import ImpactIssue


@dataclass(frozen=True)
class ToolCallDependencyInput:
    call_id: str
    name: str
    arguments: dict[str, Any]
    trace_id: str
    checkpoint_id: str
    message_id: str


@dataclass(frozen=True)
class StateUpdateDependencyInput:
    update_id: str
    source_message_id: str
    keys: list[str]
    trace_id: str
    checkpoint_id: str
    message_id: str


@dataclass(frozen=True)
class GraphNodeDependencyInput:
    node_id: str
    depends_on_message_ids: list[str]
    trace_id: str
    checkpoint_id: str
    message_id: str


class DependencyAnalyzer:
    def analyze(
        self,
        edited_message_id: str,
        original_content: str,
        edited_content: str,
        tool_calls: list[ToolCallDependencyInput] | None = None,
        state_updates: list[StateUpdateDependencyInput] | None = None,
        graph_nodes: list[GraphNodeDependencyInput] | None = None,
    ) -> list[ImpactIssue]:
        issues: list[ImpactIssue] = []
        if original_content != edited_content:
            issues.extend(_tool_argument_issues(edited_message_id, original_content, tool_calls or []))
            issues.extend(_state_update_issues(edited_message_id, state_updates or []))
            issues.extend(_graph_node_issues(edited_message_id, graph_nodes or []))
        return issues


def _tool_argument_issues(
    edited_message_id: str,
    original_content: str,
    tool_calls: list[ToolCallDependencyInput],
) -> list[ImpactIssue]:
    if not original_content:
        return []

    issues: list[ImpactIssue] = []
    for tool_call in tool_calls:
        if _contains_value(tool_call.arguments, original_content):
            issues.append(
                ImpactIssue(
                    issue_type="tool_argument_dependency",
                    severity="warning",
                    evidence={
                        "edited_message_id": edited_message_id,
                        "matched_value": original_content,
                        "tool_name": tool_call.name,
                    },
                    related_ids=[
                        tool_call.call_id,
                        tool_call.trace_id,
                        tool_call.checkpoint_id,
                        tool_call.message_id,
                    ],
                )
            )
    return issues


def _state_update_issues(
    edited_message_id: str,
    state_updates: list[StateUpdateDependencyInput],
) -> list[ImpactIssue]:
    issues: list[ImpactIssue] = []
    for state_update in state_updates:
        if state_update.source_message_id == edited_message_id:
            issues.append(
                ImpactIssue(
                    issue_type="state_dependency",
                    severity="warning",
                    evidence={
                        "edited_message_id": edited_message_id,
                        "source_message_id": state_update.source_message_id,
                        "state_keys": list(state_update.keys),
                    },
                    related_ids=[
                        state_update.update_id,
                        state_update.trace_id,
                        state_update.checkpoint_id,
                        state_update.message_id,
                    ],
                )
            )
    return issues


def _graph_node_issues(
    edited_message_id: str,
    graph_nodes: list[GraphNodeDependencyInput],
) -> list[ImpactIssue]:
    issues: list[ImpactIssue] = []
    for graph_node in graph_nodes:
        if edited_message_id in graph_node.depends_on_message_ids:
            issues.append(
                ImpactIssue(
                    issue_type="graph_dependency",
                    severity="warning",
                    evidence={
                        "edited_message_id": edited_message_id,
                        "node_id": graph_node.node_id,
                    },
                    related_ids=[
                        graph_node.node_id,
                        graph_node.trace_id,
                        graph_node.checkpoint_id,
                        graph_node.message_id,
                    ],
                )
            )
    return issues


def _contains_value(value: Any, needle: str) -> bool:
    if isinstance(value, dict):
        return any(_contains_value(item, needle) for item in value.values())
    if isinstance(value, list):
        return any(_contains_value(item, needle) for item in value)
    return str(value) == needle
