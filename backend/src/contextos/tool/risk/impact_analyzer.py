from typing import Any

from contextos.provider.base.ir import ToolResult
from contextos.tool.risk.impact_models import ImpactIssue


class EditImpactAnalyzer:
    def analyze_message_tool_result_conflicts(
        self,
        edited_content: str,
        tool_results: list[ToolResult],
    ) -> list[ImpactIssue]:
        if not _mentions_refund(edited_content):
            return []

        issues: list[ImpactIssue] = []
        for tool_result in tool_results:
            status = _extract_status(tool_result.content)
            if status == "shipped":
                issues.append(
                    ImpactIssue(
                        issue_type="message_tool_result_conflict",
                        severity="warning",
                        evidence={
                            "edited_signal": "refunded",
                            "tool_result_status": "shipped",
                            "tool_result_call_id": tool_result.call_id,
                        },
                        related_ids=[tool_result.call_id],
                    )
                )
            elif status is None:
                issues.append(
                    ImpactIssue(
                        issue_type="message_tool_result_uncertain",
                        severity="info",
                        evidence={
                            "edited_signal": "refunded",
                            "tool_result_call_id": tool_result.call_id,
                            "reason": "tool_result_status_unknown",
                        },
                        related_ids=[tool_result.call_id],
                    )
                )
        return issues


def _mentions_refund(content: str) -> bool:
    normalized = content.lower()
    return "退款" in normalized or "refunded" in normalized or "refund" in normalized


def _extract_status(content: Any) -> str | None:
    if isinstance(content, dict):
        status = content.get("status")
        return str(status).lower() if status is not None else None
    if isinstance(content, str):
        normalized = content.lower()
        if "status" in normalized and "shipped" in normalized:
            return "shipped"
    return None
