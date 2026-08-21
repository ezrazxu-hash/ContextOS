from contextos.tool.replay.decision import ReplayAction, ReplayDecision
from contextos.tool.replay.manager import ReplayManager, ReplayPlan


def post_replay_plan(payload: dict[str, object], replay_manager: ReplayManager) -> dict[str, object]:
    decisions = [
        ReplayDecision(
            tool_call_id=str(item["tool_call_id"]),
            tool_id=str(item["tool_id"]) if item.get("tool_id") is not None else None,
            action=ReplayAction(str(item["action"])),
            confirmation_token=str(item["confirmation_token"]) if item.get("confirmation_token") is not None else None,
            provenance=dict(item.get("provenance", {})),
        )
        for item in payload["decisions"]
        if isinstance(item, dict)
    ]
    result = replay_manager.execute_plan(
        ReplayPlan(
            parent_timeline_id=str(payload["parent_timeline_id"]),
            fork_checkpoint_id=str(payload["fork_checkpoint_id"]),
            fork_message_id=str(payload["fork_message_id"]),
            decisions=decisions,
            idempotency_key=str(payload["idempotency_key"]),
        )
    )
    return {"status": 200, "body": result.to_dict()}
