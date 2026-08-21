import unittest


class TokenBudgetTests(unittest.TestCase):
    def test_payload_under_budget_passes_with_diagnostics(self) -> None:
        from contextos.context.compiler.token_budget import validate_token_budget
        from contextos.provider.base.ir import UserMessage
        from contextos.provider.base.token_counter import ProviderCapability

        diagnostics = validate_token_budget(
            [UserMessage(content="one two three")],
            ProviderCapability(max_context_tokens=5),
        )

        self.assertTrue(diagnostics.allowed)
        self.assertEqual(diagnostics.current_tokens, 3)
        self.assertEqual(diagnostics.max_tokens, 5)
        self.assertEqual(diagnostics.remaining_tokens, 2)

    def test_payload_over_budget_does_not_call_provider(self) -> None:
        from contextos.context.compiler.token_budget import call_provider_if_budget_allows
        from contextos.provider.base.ir import UserMessage
        from contextos.provider.base.token_counter import ProviderCapability

        calls: list[str] = []

        diagnostics = call_provider_if_budget_allows(
            [UserMessage(content="one two three four")],
            ProviderCapability(max_context_tokens=3),
            lambda: calls.append("called"),
        )

        self.assertFalse(diagnostics.allowed)
        self.assertEqual(diagnostics.remaining_tokens, -1)
        self.assertEqual(calls, [])

    def test_context_panel_and_compiler_use_same_token_source(self) -> None:
        from contextos.context.compiler.state_resolver import resolve_context_items
        from contextos.context.compiler.token_budget import count_context_panel_tokens
        from contextos.context.model.enums import ContextItemState, ContextItemType
        from contextos.context.model.item import ContextItem
        from contextos.provider.base.token_counter import count_ir_tokens

        item = ContextItem(
            id="item-1",
            session_id="session-1",
            timeline_id="timeline-1",
            group_id="group-1",
            type=ContextItemType.MESSAGE,
            state=ContextItemState.RAW,
            raw_content="shared token source",
            generated_content=None,
            user_override=None,
            source_ids=[],
            token_count_raw=999,
            token_count_effective=999,
            priority=0,
            restorable=True,
        )

        compiler_count = count_ir_tokens(resolve_context_items([item]))
        panel_count = count_context_panel_tokens([item])

        self.assertEqual(compiler_count, 3)
        self.assertEqual(panel_count, compiler_count)

    def test_context_panel_projection_reports_shared_token_count(self) -> None:
        from contextos.context.projection import project_context_item
        from contextos.context.model.enums import ContextItemState, ContextItemType
        from contextos.context.model.item import ContextItem

        item = ContextItem(
            id="item-1",
            session_id="session-1",
            timeline_id="timeline-1",
            group_id="group-1",
            type=ContextItemType.MESSAGE,
            state=ContextItemState.RAW,
            raw_content="shared token source",
            generated_content=None,
            user_override=None,
            source_ids=[],
            token_count_raw=999,
            token_count_effective=999,
            priority=0,
            restorable=True,
        )

        projection = project_context_item(item)

        self.assertEqual(projection["token_count_effective"], 3)


if __name__ == "__main__":
    unittest.main()
