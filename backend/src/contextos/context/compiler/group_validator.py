from contextos.context.compiler.tool_validator import ValidationIssue
from contextos.context.group.model import ContextGroup


def validate_group_selection(groups: list[ContextGroup], selected_item_ids: list[str]) -> list[ValidationIssue]:
    selected_items = set(selected_item_ids)
    groups_by_id = {group.id: group for group in groups}
    selected_group_ids = {
        group.id
        for group in groups
        if selected_items.intersection(group.item_ids)
    }
    issues: list[ValidationIssue] = []

    for group in groups:
        selected_group_items = selected_items.intersection(group.item_ids)
        if group.atomic and selected_group_items and selected_group_items != set(group.item_ids):
            issues.append(
                ValidationIssue(
                    code="atomic_group_partial_selection",
                    message=f"Atomic ContextGroup selected partially: {group.id}",
                    group_id=group.id,
                )
            )

        if group.id in selected_group_ids:
            for dependency_id in group.dependencies:
                if dependency_id in groups_by_id and dependency_id not in selected_group_ids:
                    issues.append(
                        ValidationIssue(
                            code="missing_group_dependency",
                            message=f"ContextGroup dependency is not selected: {dependency_id}",
                            group_id=group.id,
                            dependency_id=dependency_id,
                        )
                    )

    return issues
