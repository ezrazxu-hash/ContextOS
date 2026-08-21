from dataclasses import dataclass


@dataclass(frozen=True)
class AgentStepGroup:
    node_execution_id: str
    item_ids: list[str]
    event_kinds: list[str]


def group_agent_step_events(events: list[dict[str, str]]) -> list[AgentStepGroup]:
    by_node: dict[str, AgentStepGroup] = {}
    for event in events:
        node_execution_id = event["node_execution_id"]
        existing = by_node.get(node_execution_id)
        if existing is None:
            by_node[node_execution_id] = AgentStepGroup(
                node_execution_id=node_execution_id,
                item_ids=[event["id"]],
                event_kinds=[event["kind"]],
            )
        else:
            existing.item_ids.append(event["id"])
            existing.event_kinds.append(event["kind"])
    return list(by_node.values())

