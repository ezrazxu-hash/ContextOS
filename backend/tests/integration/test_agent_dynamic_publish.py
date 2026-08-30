import unittest


class AgentDynamicPublishTests(unittest.TestCase):
    def test_publish_v1_then_v2_and_run_both_without_restarting_process(self) -> None:
        from contextos.template.extension.registry import ExtensionRegistry
        from contextos.template.publish_service import PublishService
        from contextos.template.service import TemplateService
        from contextos.template.version.repository import InMemoryAgentVersionRepository
        from contextos.template.version.service import AgentVersionService
        from contextos.tool.registry.registry import ToolRegistry

        template_service = TemplateService()
        version_service = AgentVersionService(InMemoryAgentVersionRepository())
        publisher = PublishService(template_service, version_service, ExtensionRegistry(), ToolRegistry())
        template_service.save(manifest_payload("active"))

        template_service.save_draft("research-agent", manifest_payload("v1"))
        v1 = publisher.publish("research-agent")
        v1_state = run_version(v1.manifest_payload)

        template_service.save_draft("research-agent", manifest_payload("v2"))
        v2 = publisher.publish("research-agent")
        v2_state = run_version(v2.manifest_payload)
        v1_again_state = run_version(v1.manifest_payload)

        self.assertEqual(v1.version, 1)
        self.assertEqual(v2.version, 2)
        self.assertEqual(v1_state["answer"], "v1")
        self.assertEqual(v2_state["answer"], "v2")
        self.assertEqual(v1_again_state["answer"], "v1")
        self.assertEqual(template_service.get("research-agent").active_version_id, v2.id)
        self.assertEqual(len(version_service.list_versions("research-agent")), 2)


def run_version(manifest_payload: dict[str, object]) -> dict[str, object]:
    from contextos.runtime.graph.runtime_context import RuntimeContext
    from contextos.template.compiler.langgraph_compiler import LangGraphManifestCompiler
    from contextos.template.manifest.parser import parse_manifest

    return LangGraphManifestCompiler().compile(parse_manifest(manifest_payload)).run(
        {},
        RuntimeContext("session-1", "timeline-1", "trace-1"),
    )


def manifest_payload(output: str) -> dict[str, object]:
    return {
        "template": {"id": "research-agent", "name": "Research Agent", "version": "1.0.0"},
        "graph": {
            "state_schema": "default_chat_state",
            "nodes": [{"id": "writer", "type": "output", "config": {"source": output, "output_key": "answer", "output": output}}],
            "edges": [{"from": "START", "to": "writer"}, {"from": "writer", "to": "END"}],
        },
        "context": {
            "policy": "balanced",
            "budget": {"high_watermark": 0.8, "target_watermark": 0.65},
            "restore": {"mode": "auto", "max_tokens_per_restore": 12000, "max_restore_per_turn": 3},
        },
        "checkpoint": {"enabled": True},
        "ui": {"editable_messages": True, "expose_context_panel": True},
    }


if __name__ == "__main__":
    unittest.main()
