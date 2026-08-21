import json
import unittest


def make_item(*, item_id: str, state, raw_content: str, generated_content: str | None = None, user_override: str | None = None):
    from contextos.context.model.enums import ContextItemType
    from contextos.context.model.item import ContextItem

    return ContextItem(
        id=item_id,
        session_id="session-1",
        timeline_id="timeline-1",
        group_id=f"group-{item_id}",
        type=ContextItemType.MESSAGE,
        state=state,
        raw_content=raw_content,
        generated_content=generated_content,
        user_override=user_override,
        source_ids=[],
        token_count_raw=100,
        token_count_effective=10,
        priority=0,
        restorable=True,
    )


class ContextStateResolverTests(unittest.TestCase):
    def test_evicted_payload_does_not_include_raw_content(self) -> None:
        from contextos.context.compiler.state_resolver import resolve_context_items
        from contextos.context.model.enums import ContextItemState
        from contextos.context.model.placeholder import Placeholder

        item = make_item(
            item_id="evicted",
            state=ContextItemState.EVICTED,
            raw_content="large private raw payload",
        )
        placeholder = Placeholder(
            id="placeholder-1",
            group_id=item.group_id,
            type="MESSAGE_GROUP",
            summary="A compact summary",
            source_count=1,
            original_tokens=100,
            current_tokens=3,
            restorable=True,
            reason="evicted",
        )

        resolved = resolve_context_items([item], placeholders_by_group_id={item.group_id: placeholder})
        payload = json.dumps([entry.to_dict() for entry in resolved])

        self.assertNotIn("large private raw payload", payload)
        self.assertIn("context_placeholder", payload)

    def test_abstract_uses_user_override_before_generated_content(self) -> None:
        from contextos.context.compiler.state_resolver import resolve_context_items
        from contextos.context.model.enums import ContextItemState

        item = make_item(
            item_id="abstract",
            state=ContextItemState.ABSTRACT,
            raw_content="raw content should stay out",
            generated_content="generated abstraction",
            user_override="manual abstraction",
        )

        resolved = resolve_context_items([item])

        self.assertEqual(resolved[0].to_dict()["content"], "manual abstraction")

    def test_placeholder_renderer_does_not_carry_original_large_content(self) -> None:
        from contextos.context.compiler.placeholder_renderer import render_placeholder
        from contextos.context.model.placeholder import Placeholder

        placeholder = Placeholder(
            id="placeholder-1",
            group_id="group-1",
            type="TOOL_INTERACTION",
            summary="Tool details summarized",
            source_count=4,
            original_tokens=5000,
            current_tokens=3,
            restorable=True,
            reason="budget",
        )

        rendered = render_placeholder(placeholder)
        payload = rendered.to_dict()

        self.assertEqual(payload["type"], "context_placeholder")
        self.assertEqual(payload["summary"], "Tool details summarized")
        self.assertNotIn("raw_content", payload)

    def test_pinned_item_enters_even_when_not_selected(self) -> None:
        from contextos.context.compiler.state_resolver import resolve_context_items
        from contextos.context.model.enums import ContextItemState

        pinned = make_item(item_id="pinned", state=ContextItemState.PINNED, raw_content="must keep")
        ordinary = make_item(item_id="ordinary", state=ContextItemState.RAW, raw_content="optional")

        resolved = resolve_context_items([pinned, ordinary], selected_item_ids=[])

        self.assertEqual([entry.to_dict()["content"] for entry in resolved], ["must keep"])

    def test_reference_state_renders_context_reference(self) -> None:
        from contextos.context.compiler.state_resolver import resolve_context_items
        from contextos.context.model.enums import ContextItemState

        item = make_item(item_id="reference", state=ContextItemState.REFERENCE, raw_content="do not send raw")

        resolved = resolve_context_items([item])
        payload = resolved[0].to_dict()

        self.assertEqual(payload["type"], "context_reference")
        self.assertEqual(payload["target_id"], "reference")
        self.assertNotIn("content", payload)


if __name__ == "__main__":
    unittest.main()
