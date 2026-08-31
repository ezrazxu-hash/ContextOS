from __future__ import annotations

import re
from typing import Any

from contextos.template.validator.validator import ValidationIssue


_STATE_KEY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def validate_agent_node_config(config: dict[str, Any], *, field_prefix: str, node_id: str | None = None) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    for field in ("model", "instruction"):
        if not config.get(field):
            issues.append(
                ValidationIssue(
                    code="agent_config.required",
                    field=f"{field_prefix}.{field}",
                    message=f"Agent node config field is required: {field}",
                    node_id=node_id,
                )
            )

    output_key = config.get("output_key")
    if output_key and not _STATE_KEY_RE.match(str(output_key)):
        issues.append(
            ValidationIssue(
                code="agent_config.invalid_output_key",
                field=f"{field_prefix}.output_key",
                message="Agent node output_key must be a simple state key",
                node_id=node_id,
            )
        )

    tools = config.get("tools", [])
    if not isinstance(tools, list):
        issues.append(
            ValidationIssue(
                code="agent_config.invalid_tools",
                field=f"{field_prefix}.tools",
                message="Agent node tools must be a list",
                node_id=node_id,
            )
        )

    max_steps = config.get("max_steps")
    if max_steps is not None and (not isinstance(max_steps, int) or max_steps < 1):
        issues.append(
            ValidationIssue(
                code="agent_config.invalid_max_steps",
                field=f"{field_prefix}.max_steps",
                message="Agent node max_steps must be a positive integer",
                node_id=node_id,
            )
        )

    return issues
