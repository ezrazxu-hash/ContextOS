from dataclasses import dataclass


@dataclass(frozen=True)
class ToolInteractionGroup:
    item_ids: list[str]
    results_by_call_id: dict[str, str]
    continuations_by_call_id: dict[str, list[str]]
    missing_result_call_ids: list[str]

    @property
    def complete(self) -> bool:
        return not self.missing_result_call_ids

    @property
    def legal_for_provider(self) -> bool:
        return self.complete


def group_tool_interactions(events: list[dict[str, str]]) -> ToolInteractionGroup:
    call_ids: list[str] = []
    item_ids: list[str] = []
    results_by_call_id: dict[str, str] = {}
    continuations_by_call_id: dict[str, list[str]] = {}

    for event in events:
        item_ids.append(event["id"])
        kind = event["kind"]
        tool_call_id = event["tool_call_id"]
        if kind == "tool_call":
            call_ids.append(tool_call_id)
        elif kind == "tool_result":
            results_by_call_id[tool_call_id] = event["id"]
        elif kind == "assistant_continuation":
            continuations_by_call_id.setdefault(tool_call_id, []).append(event["id"])

    missing_result_call_ids = [call_id for call_id in call_ids if call_id not in results_by_call_id]
    return ToolInteractionGroup(
        item_ids=item_ids,
        results_by_call_id=results_by_call_id,
        continuations_by_call_id=continuations_by_call_id,
        missing_result_call_ids=missing_result_call_ids,
    )

