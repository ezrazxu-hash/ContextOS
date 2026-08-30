import unittest


class AgentVersionServiceTests(unittest.TestCase):
    def test_published_versions_increase_monotonically(self) -> None:
        from contextos.template.version.repository import InMemoryAgentVersionRepository
        from contextos.template.version.service import AgentVersionService

        service = AgentVersionService(InMemoryAgentVersionRepository())

        first = service.create_published_version("research-agent", manifest_payload("first"))
        second = service.create_published_version("research-agent", manifest_payload("second"))

        self.assertEqual(first.version, 1)
        self.assertEqual(second.version, 2)
        self.assertEqual([version.version for version in service.list_versions("research-agent")], [1, 2])

    def test_published_version_is_immutable(self) -> None:
        from contextos.template.version.repository import InMemoryAgentVersionRepository
        from contextos.template.version.service import AgentVersionImmutableError, AgentVersionService

        service = AgentVersionService(InMemoryAgentVersionRepository())
        published = service.create_published_version("research-agent", manifest_payload("first"))

        with self.assertRaises(AgentVersionImmutableError):
            service.update_version_manifest(published.id, manifest_payload("updated"))

    def test_checksum_is_stable_for_equivalent_manifest_payloads(self) -> None:
        from contextos.template.version.repository import InMemoryAgentVersionRepository
        from contextos.template.version.service import AgentVersionService

        service = AgentVersionService(InMemoryAgentVersionRepository())

        first = service.create_published_version("research-agent", {"b": 2, "a": {"z": 1, "y": 0}})
        second = service.create_published_version("research-agent", {"a": {"y": 0, "z": 1}, "b": 2})

        self.assertEqual(first.checksum, second.checksum)

    def test_published_manifest_is_not_affected_by_source_or_draft_mutation(self) -> None:
        from contextos.template.version.repository import InMemoryAgentVersionRepository
        from contextos.template.version.service import AgentVersionService

        source = manifest_payload("published")
        service = AgentVersionService(InMemoryAgentVersionRepository())

        version = service.create_published_version("research-agent", source)
        source["graph"]["nodes"][0]["config"]["output"] = "mutated-draft"

        self.assertEqual(service.get_version(version.id).manifest_payload["graph"]["nodes"][0]["config"]["output"], "published")


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
