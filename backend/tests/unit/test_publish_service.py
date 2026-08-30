import unittest


class PublishServiceTests(unittest.TestCase):
    def test_validate_failure_does_not_create_version(self) -> None:
        from contextos.template.publish_service import PublishService, PublishValidationError

        template_service, version_service = services_with_template()
        invalid = manifest_payload("bad")
        invalid["graph"]["edges"] = [{"from": "START", "to": "missing"}]
        template_service.save_draft("research-agent", invalid)

        with self.assertRaises(PublishValidationError):
            PublishService(template_service, version_service, *registries()).publish("research-agent")

        self.assertEqual(version_service.list_versions("research-agent"), [])
        self.assertIsNone(template_service.get("research-agent").active_version_id)

    def test_compile_failure_does_not_create_version_or_replace_active_version(self) -> None:
        from contextos.template.publish_service import PublishCompileError, PublishService

        template_service, version_service = services_with_template()
        first = version_service.create_published_version("research-agent", manifest_payload("active"))
        template_service.activate_version("research-agent", first.id)
        template_service.save_draft("research-agent", manifest_payload("draft"))

        with self.assertRaises(PublishCompileError):
            PublishService(
                template_service,
                version_service,
                *registries(),
                dry_run_service=FailingDryRun(),
            ).publish("research-agent")

        self.assertEqual([version.id for version in version_service.list_versions("research-agent")], [first.id])
        self.assertEqual(template_service.get("research-agent").active_version_id, first.id)

    def test_successful_publish_creates_version_and_activates_it(self) -> None:
        from contextos.template.publish_service import PublishService

        template_service, version_service = services_with_template()
        template_service.save_draft("research-agent", manifest_payload("draft"))

        version = PublishService(template_service, version_service, *registries()).publish("research-agent")

        self.assertEqual(version.version, 1)
        self.assertEqual(version.manifest_payload["graph"]["nodes"][0]["config"]["output"], "draft")
        self.assertEqual(template_service.get("research-agent").active_version_id, version.id)


def services_with_template():
    from contextos.template.service import TemplateService
    from contextos.template.version.repository import InMemoryAgentVersionRepository
    from contextos.template.version.service import AgentVersionService

    template_service = TemplateService()
    template_service.save(manifest_payload("active"))
    return template_service, AgentVersionService(InMemoryAgentVersionRepository())


def registries():
    from contextos.template.extension.registry import ExtensionRegistry
    from contextos.tool.registry.registry import ToolRegistry

    return ExtensionRegistry(), ToolRegistry()


class FailingDryRun:
    def run(self, manifest):
        from contextos.template.compiler.dry_run import CompileDryRunError

        del manifest
        raise CompileDryRunError("compile.failed", "graph", "compile failed")


def manifest_payload(output: str) -> dict[str, object]:
    return {
        "template": {"id": "research-agent", "name": "Research Agent", "version": "1.0.0"},
        "graph": {
            "state_schema": "default_chat_state",
            "nodes": [{"id": "writer", "type": "output", "config": {"output_key": "answer", "output": output}}],
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
