from contextos.context.group.model import ContextGroup


class AtomicGroupViolation(Exception):
    pass


class MissingContextItem(Exception):
    pass


class UnsupportedGroupMutation(Exception):
    pass


def validate_atomic_operation(group: ContextGroup, target_item_ids: list[str]) -> None:
    if group.atomic and set(target_item_ids) != set(group.item_ids):
        raise AtomicGroupViolation("Atomic ContextGroup operations must target all members")


def validate_group_references(group: ContextGroup, existing_item_ids: set[str]) -> None:
    missing = [item_id for item_id in group.item_ids if item_id not in existing_item_ids]
    if missing:
        raise MissingContextItem(f"ContextGroup references missing ContextItems: {missing}")


def validate_v1_group_mutation(operation: str) -> None:
    if operation in {"split", "merge"}:
        raise UnsupportedGroupMutation(f"ContextGroup {operation} is not supported in V1")

