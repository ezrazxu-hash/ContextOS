from contextos.context.group.model import ContextGroup
from contextos.context.group.service import ContextGroupService
from contextos.context.restore.search import ContextSearchQuery, search_context_groups


class ContextOperatorNode:
    def __init__(self, group_service: ContextGroupService, groups: list[ContextGroup]) -> None:
        self._group_service = group_service
        self._groups = list(groups)

    def run(self, state: dict[str, object]) -> dict[str, object]:
        operator = str(state["operator"]).upper()
        trace_events = list(state.get("trace_events", []))

        if operator == "SEARCH":
            keyword = str(state["keyword"])
            results = search_context_groups(self._groups, ContextSearchQuery(keyword=keyword))
            return {
                **state,
                "search_results": [result.to_dict() for result in results],
                "trace_events": [*trace_events, f"context.search:{keyword}"],
            }

        if operator == "ABSTRACT":
            group_id = str(state["group_id"])
            generated = dict(state["generated_content_by_item_id"])
            self._group_service.abstract_group(group_id, generated, operator="workflow", reason="context operator")
            return {**state, "trace_events": [*trace_events, f"context.abstract:{group_id}"]}

        if operator == "EVICT":
            group_id = str(state["group_id"])
            self._group_service.evict_group(group_id, operator="workflow", reason="context operator")
            return {**state, "trace_events": [*trace_events, f"context.evict:{group_id}"]}

        if operator == "PIN":
            group_id = str(state["group_id"])
            self._group_service.pin_group(group_id, operator="workflow", reason="context operator")
            return {**state, "trace_events": [*trace_events, f"context.pin:{group_id}"]}

        if operator == "UNPIN":
            group_id = str(state["group_id"])
            self._group_service.unpin_group(group_id, operator="workflow", reason="context operator")
            return {**state, "trace_events": [*trace_events, f"context.unpin:{group_id}"]}

        if operator == "RESTORE":
            group_id = str(state["group_id"])
            self._group_service.restore_group(group_id, operator="workflow", reason="context operator")
            return {**state, "trace_events": [*trace_events, f"context.restore:{group_id}"]}

        if operator == "SUMMARIZE":
            return {**state, "trace_events": [*trace_events, "context.summarize"]}

        raise ValueError(f"Unsupported context operator: {operator}")
