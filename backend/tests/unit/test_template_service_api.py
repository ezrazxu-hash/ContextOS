import unittest


def manifest_payload(node_override=None):
    node = node_override or {"id": "writer", "type": "output", "config": {"source": "ok", "output_key": "answer", "output": "ok"}}
    return {
        "template": {"id": "research-agent", "name": "Research Agent", "version": "1.0.0"},
        "graph": {
            "state_schema": "default_chat_state",
            "nodes": [node],
            "edges": [{"from": "START", "to": node["id"]}, {"from": node["id"], "to": "END"}],
        },
        "context": {
            "policy": "balanced",
            "budget": {"high_watermark": 0.8, "target_watermark": 0.65},
            "restore": {"mode": "auto", "max_tokens_per_restore": 12000, "max_restore_per_turn": 3},
        },
        "checkpoint": {"enabled": True},
        "ui": {"editable_messages": True, "expose_context_panel": True},
    }


def registries():
    from contextos.template.extension.registry import ExtensionRegistry
    from contextos.tool.registry.registry import ToolRegistry

    return ExtensionRegistry(), ToolRegistry()


class TemplateServiceApiTests(unittest.TestCase):
    def test_post_get_put_template_preserves_manifest(self) -> None:
        from contextos.api.routes.templates import get_template, post_template, put_template
        from contextos.template.service import TemplateService

        service = TemplateService()
        created = post_template(manifest_payload(), service)
        loaded = get_template("research-agent", service)
        updated_payload = manifest_payload({"id": "writer", "type": "output", "config": {"source": "updated", "output_key": "answer", "output": "updated"}})
        updated = put_template("research-agent", updated_payload, service)

        self.assertEqual(created["status"], 201)
        self.assertEqual(loaded["body"]["manifest"], manifest_payload())
        self.assertEqual(updated["status"], 200)
        self.assertEqual(get_template("research-agent", service)["body"]["manifest"], updated_payload)

    def test_validate_has_no_execution_side_effects(self) -> None:
        from contextos.api.routes.templates import post_template, post_template_validate
        from contextos.template.service import TemplateService

        service = TemplateService()
        post_template(manifest_payload(), service)
        extension_registry, tool_registry = registries()
        execution_log: list[str] = []

        response = post_template_validate(
            "research-agent",
            service,
            extension_registry=extension_registry,
            tool_registry=tool_registry,
            execution_probe=lambda: execution_log.append("executed"),
        )

        self.assertEqual(response["status"], 200)
        self.assertEqual(response["body"], {"valid": True, "issues": []})
        self.assertEqual(execution_log, [])

    def test_compile_error_locates_node(self) -> None:
        from contextos.api.routes.templates import post_template, post_template_compile
        from contextos.template.service import TemplateService

        service = TemplateService()
        post_template(
            manifest_payload({"id": "review", "type": "custom", "extension": "extensions.missing"}),
            service,
        )
        extension_registry, tool_registry = registries()

        response = post_template_compile(
            "research-agent",
            service,
            extension_registry=extension_registry,
            tool_registry=tool_registry,
        )

        self.assertEqual(response["status"], 400)
        self.assertEqual(response["body"]["error"]["field_path"], "graph.nodes[0].type")

    def test_run_uses_compiler_graph_and_does_not_call_provider(self) -> None:
        from contextos.api.routes.templates import post_template, post_template_run
        from contextos.template.service import TemplateService

        service = TemplateService()
        post_template(manifest_payload(), service)
        extension_registry, tool_registry = registries()
        provider_calls: list[str] = []

        response = post_template_run(
            "research-agent",
            {"graph_state": {}, "session_id": "session-1", "timeline_id": "timeline-1", "trace_id": "trace-1"},
            service,
            extension_registry=extension_registry,
            tool_registry=tool_registry,
            provider_call=lambda: provider_calls.append("provider"),
        )

        self.assertEqual(response["status"], 200)
        self.assertEqual(response["body"]["graph_state"]["answer"], "ok")
        self.assertEqual(provider_calls, [])

    def test_agent_draft_save_load_and_overwrite_does_not_modify_active_manifest(self) -> None:
        from contextos.api.routes.agents import get_agent_draft, put_agent_draft
        from contextos.api.routes.templates import post_template
        from contextos.template.service import TemplateService

        service = TemplateService()
        active_manifest = manifest_payload()
        first_draft = manifest_payload({"id": "writer", "type": "output", "config": {"source": "draft-1", "output_key": "answer", "output": "draft-1"}})
        second_draft = manifest_payload({"id": "writer", "type": "output", "config": {"source": "draft-2", "output_key": "answer", "output": "draft-2"}})
        post_template(active_manifest, service)

        saved = put_agent_draft("research-agent", first_draft, service)
        overwritten = put_agent_draft("research-agent", second_draft, service)
        loaded = get_agent_draft("research-agent", service)
        active = service.get("research-agent")

        self.assertEqual(saved["status"], 200)
        self.assertEqual(overwritten["status"], 200)
        self.assertEqual(loaded["body"]["draft_manifest"], second_draft)
        self.assertIsNotNone(loaded["body"]["draft_updated_at"])
        self.assertEqual(active.manifest_payload, active_manifest)

    def test_agent_validate_api_returns_structured_result_without_modifying_draft(self) -> None:
        from contextos.api.routes.agents import get_agent_draft, post_agent_validate, put_agent_draft
        from contextos.api.routes.templates import post_template
        from contextos.template.service import TemplateService

        service = TemplateService()
        post_template(manifest_payload(), service)
        draft = manifest_payload({"id": "writer", "type": "output", "config": {"source": "draft", "output_key": "answer", "output": "draft"}})
        invalid_request = manifest_payload({"id": "writer", "type": "output", "config": {"source": "request-only", "output_key": "answer", "output": "request-only"}})
        invalid_request["graph"]["edges"] = [{"from": "START", "to": "missing"}]
        put_agent_draft("research-agent", draft, service)
        extension_registry, tool_registry = registries()

        response = post_agent_validate(
            "research-agent",
            invalid_request,
            service,
            extension_registry=extension_registry,
            tool_registry=tool_registry,
        )
        loaded_draft = get_agent_draft("research-agent", service)

        self.assertEqual(response["status"], 200)
        self.assertFalse(response["body"]["valid"])
        self.assertEqual(response["body"]["errors"][0]["code"], "unknown_node")
        self.assertEqual(response["body"]["errors"][0]["field"], "graph.edges[0].to")
        self.assertEqual(loaded_draft["body"]["draft_manifest"], draft)

    def test_agent_validate_api_uses_current_draft_when_payload_is_empty(self) -> None:
        from contextos.api.routes.agents import post_agent_validate, put_agent_draft
        from contextos.api.routes.templates import post_template
        from contextos.template.service import TemplateService

        service = TemplateService()
        post_template(manifest_payload(), service)
        put_agent_draft("research-agent", manifest_payload(), service)
        extension_registry, tool_registry = registries()

        response = post_agent_validate(
            "research-agent",
            {},
            service,
            extension_registry=extension_registry,
            tool_registry=tool_registry,
        )

        self.assertEqual(response["body"], {"valid": True, "errors": [], "warnings": []})

    def test_agent_publish_and_version_routes_return_published_versions(self) -> None:
        from contextos.api.routes.agents import get_agent_version, get_agent_versions, post_agent_publish, put_agent_draft
        from contextos.api.routes.templates import post_template
        from contextos.template.publish_service import PublishService
        from contextos.template.service import TemplateService
        from contextos.template.version.repository import InMemoryAgentVersionRepository
        from contextos.template.version.service import AgentVersionService

        template_service = TemplateService()
        version_service = AgentVersionService(InMemoryAgentVersionRepository())
        extension_registry, tool_registry = registries()
        post_template(manifest_payload(), template_service)
        put_agent_draft("research-agent", manifest_payload(), template_service)
        publish_service = PublishService(template_service, version_service, extension_registry, tool_registry)

        published = post_agent_publish("research-agent", publish_service)
        listed = get_agent_versions("research-agent", version_service)
        loaded = get_agent_version(published["body"]["id"], version_service)

        self.assertEqual(published["status"], 200)
        self.assertEqual(published["body"]["agent_template_id"], "research-agent")
        self.assertEqual(published["body"]["status"], "published")
        self.assertEqual(listed["body"]["versions"][0]["id"], published["body"]["id"])
        self.assertEqual(loaded["body"]["id"], published["body"]["id"])

    def test_list_agents_only_returns_templates_with_published_active_versions(self) -> None:
        from contextos.api.routes.agents import list_agents, put_agent_draft
        from contextos.api.routes.templates import post_template
        from contextos.template.publish_service import PublishService
        from contextos.template.service import TemplateService
        from contextos.template.version.repository import InMemoryAgentVersionRepository
        from contextos.template.version.service import AgentVersionService

        template_service = TemplateService()
        version_service = AgentVersionService(InMemoryAgentVersionRepository())
        extension_registry, tool_registry = registries()
        post_template(manifest_payload(), template_service)
        put_agent_draft("research-agent", manifest_payload(), template_service)
        draft_only = manifest_payload()
        draft_only["template"] = {"id": "draft-only", "name": "Draft Only", "version": "1.0.0"}
        post_template(draft_only, template_service)
        version = PublishService(template_service, version_service, extension_registry, tool_registry).publish("research-agent")

        response = list_agents(template_service, version_service)

        self.assertEqual(response["status"], 200)
        self.assertEqual(response["body"]["agents"], [
            {
                "id": "research-agent",
                "name": "Research Agent",
                "active_version": version.to_dict(),
            }
        ])


if __name__ == "__main__":
    unittest.main()
