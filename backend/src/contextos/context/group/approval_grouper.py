from dataclasses import dataclass


class AtomicApprovalViolation(Exception):
    pass


@dataclass(frozen=True)
class ApprovalGroup:
    approval_id: str
    item_ids: list[str]
    event_kinds: list[str]
    atomic: bool = True

    @property
    def complete(self) -> bool:
        has_request = "approval_request" in self.event_kinds
        has_decision = "approval_approve" in self.event_kinds or "approval_reject" in self.event_kinds
        return has_request and has_decision


def group_approval_events(events: list[dict[str, str]]) -> list[ApprovalGroup]:
    by_approval: dict[str, ApprovalGroup] = {}
    for event in events:
        approval_id = event["approval_id"]
        existing = by_approval.get(approval_id)
        if existing is None:
            by_approval[approval_id] = ApprovalGroup(
                approval_id=approval_id,
                item_ids=[event["id"]],
                event_kinds=[event["kind"]],
            )
        else:
            existing.item_ids.append(event["id"])
            existing.event_kinds.append(event["kind"])
    return list(by_approval.values())


def validate_approval_atomic_operation(group: ApprovalGroup, target_item_ids: list[str]) -> None:
    if group.atomic and set(target_item_ids) != set(group.item_ids):
        raise AtomicApprovalViolation("Human approval lifecycle must be operated as one group")

