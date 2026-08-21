import unittest


class ToolDependencyValidatorTests(unittest.TestCase):
    def test_complete_tool_interaction_passes(self) -> None:
        from contextos.context.compiler.tool_validator import validate_tool_dependencies
        from contextos.provider.base.ir import AssistantMessage, ToolCall, ToolResult

        issues = validate_tool_dependencies(
            [
                AssistantMessage(
                    content="Checking.",
                    tool_calls=[
                        ToolCall(call_id="call-a", name="lookup"),
                        ToolCall(call_id="call-b", name="lookup"),
                    ],
                ),
                ToolResult(call_id="call-b", content="B"),
                ToolResult(call_id="call-a", content="A"),
            ]
        )

        self.assertEqual(issues, [])

    def test_missing_tool_result_is_rejected(self) -> None:
        from contextos.context.compiler.tool_validator import validate_tool_dependencies
        from contextos.provider.base.ir import AssistantMessage, ToolCall, ToolResult

        issues = validate_tool_dependencies(
            [
                AssistantMessage(
                    content="Checking.",
                    tool_calls=[
                        ToolCall(call_id="call-a", name="lookup"),
                        ToolCall(call_id="call-b", name="lookup"),
                    ],
                ),
                ToolResult(call_id="call-a", content="A"),
            ]
        )

        self.assertEqual(len(issues), 1)
        self.assertEqual(issues[0].code, "missing_tool_result")
        self.assertEqual(issues[0].call_id, "call-b")
        self.assertEqual(issues[0].to_dict()["severity"], "error")

    def test_wrong_tool_call_id_is_rejected(self) -> None:
        from contextos.context.compiler.tool_validator import validate_tool_dependencies
        from contextos.provider.base.ir import AssistantMessage, ToolCall, ToolResult

        issues = validate_tool_dependencies(
            [
                AssistantMessage(
                    content="Checking.",
                    tool_calls=[ToolCall(call_id="call-a", name="lookup")],
                ),
                ToolResult(call_id="call-x", content="unknown"),
            ]
        )

        self.assertEqual(len(issues), 2)
        self.assertEqual([issue.code for issue in issues], ["unknown_tool_call", "missing_tool_result"])
        self.assertEqual(issues[0].call_id, "call-x")


class GroupDependencyValidatorTests(unittest.TestCase):
    def test_atomic_group_partial_selection_is_rejected(self) -> None:
        from contextos.context.compiler.group_validator import validate_group_selection
        from contextos.context.group.model import ContextGroup, ContextGroupType
        from contextos.context.model.enums import ContextItemState

        group = ContextGroup(
            id="group-1",
            session_id="session-1",
            timeline_id="timeline-1",
            group_type=ContextGroupType.TOOL_INTERACTION,
            item_ids=["item-a", "item-b"],
            atomic=True,
            state=ContextItemState.RAW,
            summary=None,
            placeholder=None,
            source_token_count=20,
            effective_token_count=20,
            restorable=True,
            dependencies=[],
        )

        issues = validate_group_selection([group], selected_item_ids=["item-a"])

        self.assertEqual(len(issues), 1)
        self.assertEqual(issues[0].code, "atomic_group_partial_selection")
        self.assertEqual(issues[0].group_id, "group-1")

    def test_missing_group_dependency_is_rejected(self) -> None:
        from contextos.context.compiler.group_validator import validate_group_selection
        from contextos.context.group.model import ContextGroup, ContextGroupType
        from contextos.context.model.enums import ContextItemState

        parent = ContextGroup(
            id="parent",
            session_id="session-1",
            timeline_id="timeline-1",
            group_type=ContextGroupType.AGENT_STEP,
            item_ids=["parent-item"],
            atomic=False,
            state=ContextItemState.RAW,
            summary=None,
            placeholder=None,
            source_token_count=10,
            effective_token_count=10,
            restorable=True,
            dependencies=["dependency"],
        )
        dependency = ContextGroup(
            id="dependency",
            session_id="session-1",
            timeline_id="timeline-1",
            group_type=ContextGroupType.MESSAGE_GROUP,
            item_ids=["dependency-item"],
            atomic=False,
            state=ContextItemState.RAW,
            summary=None,
            placeholder=None,
            source_token_count=10,
            effective_token_count=10,
            restorable=True,
            dependencies=[],
        )

        issues = validate_group_selection([parent, dependency], selected_item_ids=["parent-item"])

        self.assertEqual(len(issues), 1)
        self.assertEqual(issues[0].code, "missing_group_dependency")
        self.assertEqual(issues[0].group_id, "parent")
        self.assertEqual(issues[0].dependency_id, "dependency")


if __name__ == "__main__":
    unittest.main()
