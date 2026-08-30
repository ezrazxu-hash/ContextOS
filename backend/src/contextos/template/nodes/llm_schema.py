from __future__ import annotations

import re
from typing import Any

from contextos.template.validator.validator import ValidationIssue


_STATE_KEY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def validate_llm_node_config(config: dict[str, Any], *, field_prefix: str, node_id: str | None = None) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    if not config.get("model"):
        issues.append(
            ValidationIssue(
                code="llm_config.required",
                field=f"{field_prefix}.model",
                message="LLM node config field is required: model",
                node_id=node_id,
            )
        )
    if not config.get("prompt") and not config.get("prompt_template"):
        issues.append(
            ValidationIssue(
                code="llm_config.required",
                field=f"{field_prefix}.prompt",
                message="LLM node config field is required: prompt",
                node_id=node_id,
            )
        )
    if not config.get("output_key"):
        issues.append(
            ValidationIssue(
                code="llm_config.required",
                field=f"{field_prefix}.output_key",
                message="LLM node config field is required: output_key",
                node_id=node_id,
            )
        )

    temperature = config.get("temperature")
    if temperature is not None and not _valid_temperature(temperature):
        issues.append(
            ValidationIssue(
                code="llm_config.invalid_temperature",
                field=f"{field_prefix}.temperature",
                message="LLM node temperature must be between 0 and 2",
                node_id=node_id,
            )
        )

    output_key = config.get("output_key")
    if output_key and not _STATE_KEY_RE.match(str(output_key)):
        issues.append(
            ValidationIssue(
                code="llm_config.invalid_output_key",
                field=f"{field_prefix}.output_key",
                message="LLM node output_key must be a simple state key",
                node_id=node_id,
            )
        )

    input_mapping = config.get("input_mapping", {})
    if not isinstance(input_mapping, dict):
        issues.append(
            ValidationIssue(
                code="llm_config.invalid_input_mapping",
                field=f"{field_prefix}.input_mapping",
                message="LLM node input_mapping must be an object",
                node_id=node_id,
            )
        )
    else:
        for key, value in input_mapping.items():
            if not isinstance(value, str) or not value.startswith("$state.") or value == "$state.":
                issues.append(
                    ValidationIssue(
                        code="llm_config.invalid_input_mapping",
                        field=f"{field_prefix}.input_mapping.{key}",
                        message=f"LLM node input_mapping must reference a state path: {key}",
                        node_id=node_id,
                    )
                )

    return issues


def _valid_temperature(value: object) -> bool:
    try:
        temperature = float(value)
    except (TypeError, ValueError):
        return False
    return 0 <= temperature <= 2
