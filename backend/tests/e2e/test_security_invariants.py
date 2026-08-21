from pathlib import Path
import sys
import unittest


BACKEND_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = BACKEND_ROOT.parent
sys.path.insert(0, str(BACKEND_ROOT / "src"))


class SecurityInvariantE2ETests(unittest.TestCase):
    def test_restored_external_context_projection_has_source_type_and_trust_metadata(self) -> None:
        from contextos.context.model.enums import ContextItemState, ContextItemType
        from contextos.context.model.item import ContextItem
        from contextos.context.projection import project_context_item

        item = ContextItem(
            id="restore-item",
            session_id="session-1",
            timeline_id="timeline-1",
            group_id="restore-group",
            type=ContextItemType.MESSAGE,
            state=ContextItemState.RAW,
            raw_content="restored external context",
            generated_content=None,
            user_override=None,
            source_ids=["external:ticket-42"],
            token_count_raw=3,
            token_count_effective=3,
            priority=0,
            restorable=True,
        )

        projection = project_context_item(item)

        self.assertEqual(
            projection["source"],
            {"ids": ["external:ticket-42"], "type": "external", "trust": "unverified"},
        )

    def test_unknown_tool_defaults_to_write_and_cannot_auto_replay(self) -> None:
        from contextos.tool.registry.metadata import SideEffect
        from contextos.tool.registry.registry import ToolRegistry
        from contextos.tool.replay.decision import ReplayAction, ReplayDecision
        from contextos.tool.replay.policy import ReplayDecisionPolicy

        metadata = ToolRegistry().get("unknown-tool")
        decision = ReplayDecision(tool_call_id="call-unknown", tool_id="unknown-tool", action=ReplayAction.REINVOKE)
        result = ReplayDecisionPolicy().evaluate(decision, metadata)

        self.assertEqual(metadata.side_effect, SideEffect.WRITE)
        self.assertFalse(result.allowed)
        self.assertEqual(result.reason, "confirmation_required")

    def test_provider_gateway_accepts_only_compiler_result_payload(self) -> None:
        from contextos.context.compiler.compiler import CompileResult
        from contextos.provider.gateway import ProviderGateway

        calls: list[list[dict[str, object]]] = []
        gateway = ProviderGateway(lambda payload: calls.append(payload))
        compiled = CompileResult(
            provider_payload=[{"role": "user", "content": "hello"}],
            diagnostics={"token_budget": {"allowed": True}},
            validation_issues=[],
        )

        response = gateway.send(compiled)

        self.assertEqual(response["status"], "sent")
        self.assertEqual(calls, [[{"role": "user", "content": "hello"}]])
        with self.assertRaises(TypeError):
            gateway.send([{"role": "user", "content": "raw internal message"}])

    def test_business_api_has_no_physical_delete_or_purge_endpoint(self) -> None:
        routes_dir = BACKEND_ROOT / "src" / "contextos" / "api" / "routes"
        route_source = "\n".join(path.read_text(encoding="utf-8").lower() for path in routes_dir.glob("*.py"))

        self.assertNotIn("def delete_", route_source)
        self.assertNotIn("def purge_", route_source)
        self.assertNotIn("physical_delete", route_source)

    def test_security_invariants_document_is_present(self) -> None:
        doc = REPO_ROOT / "docs" / "implementation" / "security-invariants.md"

        self.assertTrue(doc.exists())


if __name__ == "__main__":
    unittest.main()
