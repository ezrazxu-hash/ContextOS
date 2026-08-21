import unittest


def manifest_payload(node_override=None):
    node = node_override or {"id": "writer", "type": "output", "config": {"output_key": "answer", "output": "ok"}}
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
        updated_payload = manifest_payload({"id": "writer", "type": "output", "config": {"output_key": "answer", "output": "updated"}})
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
        self.assertEqual(response["body"]["error"]["field_path"], "graph.nodes[0].extension")

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


if __name__ == "__main__":
    unittest.main()
