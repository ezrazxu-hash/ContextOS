from pathlib import Path
import sys
import unittest


BACKEND_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND_ROOT / "src"))


def make_tool_item(item_id: str, item_type, raw_content: str):
    from contextos.context.model.enums import ContextItemState
    from contextos.context.model.item import ContextItem

    return ContextItem(
        id=item_id,
        session_id="session-1",
        timeline_id="timeline-1",
        group_id="tool-group",
        type=item_type,
        state=ContextItemState.RAW,
        raw_content=raw_content,
        generated_content=None,
        user_override=None,
        source_ids=[],
        token_count_raw=len(raw_content.split()),
        token_count_effective=len(raw_content.split()),
        priority=0,
        restorable=True,
    )


class MvpEvictToolGroupE2ETests(unittest.TestCase):
    def create_service(self):
        from contextos.context.group.model import ContextGroup, ContextGroupType
        from contextos.context.group.service import ContextGroupService
        from contextos.context.model.enums import ContextItemState, ContextItemType
        from contextos.context.revision.repository import InMemoryContextRevisionRepository
        from contextos.context.revision.service import ContextRevisionService

        items = {
            "tool-call": make_tool_item("tool-call", ContextItemType.TOOL_CALL, "Assistant ToolCall call-weather"),
            "tool-result": make_tool_item("tool-result", ContextItemType.TOOL_RESULT, "ToolResult sunny"),
        }
        group = ContextGroup(
            id="tool-group",
            session_id="session-1",
            timeline_id="timeline-1",
            group_type=ContextGroupType.TOOL_INTERACTION,
            item_ids=["tool-call", "tool-result"],
            atomic=True,
            state=ContextItemState.RAW,
            summary="weather lookup returned sunny",
            placeholder=None,
            source_token_count=8,
            effective_token_count=8,
            restorable=True,
            dependencies=[],
        )
        return ContextGroupService(items, {"tool-group": group}, ContextRevisionService(InMemoryContextRevisionRepository()))

    def test_evict_tool_interaction_as_atomic_group_keeps_raw_and_compiles_placeholder(self) -> None:
        from contextos.api.routes.context import get_context_item_raw, post_context_group_evict, post_context_item_evict
        from contextos.context.compiler.compiler import CompileRequest, ContextCompiler
        from contextos.context.model.placeholder import Placeholder
        from contextos.provider.openai_compatible.adapter import OpenAICompatibleAdapter

        service = self.create_service()

        partial = post_context_item_evict("tool-call", service)
        evicted = post_context_group_evict("tool-group", service)
        raw_call = get_context_item_raw("tool-call", service)
        raw_result = get_context_item_raw("tool-result", service)
        placeholder = Placeholder(**evicted["body"]["placeholder"])
        compiled = ContextCompiler(OpenAICompatibleAdapter()).compile(
            CompileRequest(
                context_items=list(service.items.values()),
                groups=[service.groups["tool-group"]],
                placeholders_by_group_id={"tool-group": placeholder},
            )
        )

        self.assertEqual(partial["status"], 400)
        self.assertEqual(partial["body"]["error"]["code"], "context.atomic_group_partial_evict")
        self.assertEqual(evicted["status"], 200)
        self.assertEqual(evicted["body"]["placeholder"]["group_id"], "tool-group")
        self.assertEqual(service.groups["tool-group"].state.value, "EVICTED")
        self.assertEqual(raw_call["body"]["raw_content"], "Assistant ToolCall call-weather")
        self.assertEqual(raw_result["body"]["raw_content"], "ToolResult sunny")
        self.assertTrue(compiled.allowed)
        self.assertEqual(len(compiled.provider_payload), 1)
        self.assertIn("context-placeholder", compiled.provider_payload[0]["content"])
        self.assertIn("weather lookup returned sunny", compiled.provider_payload[0]["content"])
        self.assertNotIn("Assistant ToolCall call-weather", str(compiled.provider_payload))
        self.assertNotIn("ToolResult sunny", str(compiled.provider_payload))


if __name__ == "__main__":
    unittest.main()
