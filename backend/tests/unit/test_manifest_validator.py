import unittest


def valid_manifest_with(**overrides):
    from contextos.template.manifest.parser import parse_manifest

    payload = {
        "template": {"id": "research-agent", "name": "Research Agent", "version": "1.0.0"},
        "graph": {
            "state_schema": "default_chat_state",
            "nodes": [
                {
                    "id": "planner",
                    "type": "llm",
                    "config": {"model": "default", "prompt": "{{input}}", "output_key": "answer"},
                },
                {"id": "final", "type": "output", "config": {"source": "$state.answer"}},
            ],
            "edges": [{"from": "START", "to": "planner"}, {"from": "planner", "to": "final"}, {"from": "final", "to": "END"}],
        },
        "context": {
            "policy": "balanced",
            "budget": {"high_watermark": 0.8, "target_watermark": 0.65},
            "restore": {"mode": "auto", "max_tokens_per_restore": 12000, "max_restore_per_turn": 3},
        },
        "checkpoint": {"enabled": True},
        "ui": {"editable_messages": True, "expose_context_panel": True},
    }
    payload.update(overrides)
    return parse_manifest(payload)


def create_registries():
    from contextos.template.extension.registry import ExtensionRegistry
    from contextos.tool.registry.registry import ToolRegistry

    extension_registry = ExtensionRegistry()
    tool_registry = ToolRegistry()
    return extension_registry, tool_registry


class ManifestValidatorTests(unittest.TestCase):
    def test_edge_to_missing_node_fails(self) -> None:
        from contextos.template.validator.validator import ManifestValidationError, ManifestValidator

        extension_registry, tool_registry = create_registries()
        manifest = valid_manifest_with(
            graph={
                "state_schema": "default_chat_state",
                "nodes": [{"id": "planner", "type": "llm", "config": {"model": "default", "prompt": "{{input}}", "output_key": "answer"}}],
                "edges": [{"from": "planner", "to": "missing"}],
            }
        )

        with self.assertRaises(ManifestValidationError) as error:
            ManifestValidator(extension_registry, tool_registry).validate(manifest)

        self.assertEqual(error.exception.field_path, "graph.edges[0].to")

    def test_unsupported_custom_node_fails_without_dynamic_import(self) -> None:
        from contextos.template.extension.registry import ExtensionRegistry
        from contextos.template.validator.validator import ManifestValidationError, ManifestValidator
        from contextos.tool.registry.registry import ToolRegistry

        manifest = valid_manifest_with(
            graph={
                "state_schema": "default_chat_state",
                "nodes": [{"id": "custom", "type": "custom", "extension": "extensions.requirement_review"}],
                "edges": [{"from": "START", "to": "custom"}, {"from": "custom", "to": "END"}],
            }
        )
        tool_registry = ToolRegistry()

        with self.assertRaises(ManifestValidationError) as error:
            ManifestValidator(ExtensionRegistry(), tool_registry).validate(manifest)

        self.assertEqual(error.exception.field_path, "graph.nodes[0].type")
        self.assertEqual(error.exception.code, "unsupported_node_type")

    def test_missing_tool_binding_fails(self) -> None:
        from contextos.template.validator.validator import ManifestValidationError, ManifestValidator
        from contextos.tool.registry.registry import ToolRegistry

        extension_registry, _ = create_registries()
        manifest = valid_manifest_with(
            graph={
                "state_schema": "default_chat_state",
                "nodes": [{"id": "lookup", "type": "tool", "config": {"tool_name": "web_search", "output_key": "tool_result"}}],
                "edges": [{"from": "START", "to": "lookup"}, {"from": "lookup", "to": "END"}],
            }
        )

        with self.assertRaises(ManifestValidationError) as error:
            ManifestValidator(extension_registry, ToolRegistry()).validate(manifest)

        self.assertEqual(error.exception.field_path, "graph.nodes[0].config.tool_name")
        self.assertEqual(error.exception.code, "unknown_tool")

    def test_registered_extensions_and_tools_validate(self) -> None:
        from contextos.template.validator.validator import ManifestValidator

        extension_registry, tool_registry = create_registries()

        self.assertEqual(ManifestValidator(extension_registry, tool_registry).validate(valid_manifest_with()), [])

    def test_validation_result_returns_multiple_structured_errors(self) -> None:
        from contextos.template.validator.validator import ManifestValidator

        extension_registry, tool_registry = create_registries()
        manifest = valid_manifest_with(
            graph={
                "state_schema": "default_chat_state",
                "nodes": [
                    {"id": "planner", "type": "agent", "config": {"tools": ["web_search"]}},
                    {"id": "orphan", "type": "output", "config": {"output_key": "answer"}},
                ],
                "edges": [
                    {"from": "START", "to": "planner"},
                    {"from": "planner", "to": "missing"},
                ],
            }
        )

        result = ManifestValidator(extension_registry, tool_registry).validate_result(manifest)

        self.assertFalse(result.valid)
        self.assertEqual(
            [(error.code, error.node_id, error.edge_id, error.field) for error in result.errors],
            [
                ("unknown_node", None, "1:planner->missing", "graph.edges[1].to"),
                ("unsupported_node_type", "planner", None, "graph.nodes[0].type"),
                ("output_config.required", "orphan", None, "graph.nodes[1].config.source"),
                ("missing_end_edge", None, None, "graph.edges"),
                ("isolated_node", "orphan", None, "graph.nodes[1]"),
                ("output_not_reachable", "orphan", None, "graph.nodes[1]"),
            ],
        )
        self.assertEqual(result.to_dict()["errors"][0]["message"], "Edge references unknown target node: missing")

    def test_llm_node_config_errors_are_structured(self) -> None:
        from contextos.template.validator.validator import ManifestValidator

        extension_registry, tool_registry = create_registries()
        manifest = valid_manifest_with(
            graph={
                "state_schema": "default_chat_state",
                "nodes": [{"id": "planner", "type": "llm", "config": {"model": "default"}}],
                "edges": [{"from": "START", "to": "planner"}, {"from": "planner", "to": "END"}],
            }
        )

        result = ManifestValidator(extension_registry, tool_registry).validate_result(manifest)

        self.assertFalse(result.valid)
        self.assertEqual(result.errors[0].code, "llm_config.required")
        self.assertEqual(result.errors[0].node_id, "planner")
        self.assertEqual(result.errors[0].field, "graph.nodes[0].config.prompt")

    def test_prompt_llm_and_tool_output_keys_are_not_required(self) -> None:
        from contextos.template.validator.validator import ManifestValidator
        from contextos.tool.registry.metadata import ToolMetadata
        from contextos.tool.registry.registry import ToolRegistry

        extension_registry, _ = create_registries()
        tool_registry = ToolRegistry(
            [
                ToolMetadata(
                    tool_id="web_search",
                    name="Web Search",
                    description="Searches",
                    input_schema={},
                    output_schema={},
                )
            ]
        )
        manifest = valid_manifest_with(
            graph={
                "state_schema": "default_chat_state",
                "nodes": [
                    {"id": "prompt", "type": "prompt", "config": {"template": "{{input}}"}},
                    {"id": "planner", "type": "llm", "config": {"model": "default", "prompt": "{{input}}"}},
                    {"id": "lookup", "type": "tool", "config": {"tool_name": "web_search"}},
                    {"id": "final", "type": "output", "config": {"source": "$state.answer"}},
                ],
                "edges": [
                    {"from": "START", "to": "prompt"},
                    {"from": "prompt", "to": "planner"},
                    {"from": "planner", "to": "lookup"},
                    {"from": "lookup", "to": "final"},
                    {"from": "final", "to": "END"},
                ],
            }
        )

        result = ManifestValidator(extension_registry, tool_registry).validate_result(manifest)

        self.assertTrue(result.valid, [error.to_dict() for error in result.errors])

    def test_start_and_end_cannot_be_manifest_nodes(self) -> None:
        from contextos.template.validator.validator import ManifestValidator

        extension_registry, tool_registry = create_registries()
        manifest = valid_manifest_with(
            graph={
                "state_schema": "default_chat_state",
                "nodes": [
                    {"id": "START", "type": "start", "config": {}},
                    {"id": "END", "type": "end", "config": {}},
                ],
                "edges": [{"from": "START", "to": "END"}],
            }
        )

        result = ManifestValidator(extension_registry, tool_registry).validate_result(manifest)

        self.assertFalse(result.valid)
        self.assertEqual([error.code for error in result.errors[:2]], ["reserved_boundary_node", "reserved_boundary_node"])

    def test_condition_must_have_true_and_false_routes(self) -> None:
        from contextos.template.validator.validator import ManifestValidator

        extension_registry, tool_registry = create_registries()
        manifest = valid_manifest_with(
            graph={
                "state_schema": "default_chat_state",
                "nodes": [
                    {"id": "check", "type": "condition", "config": {"source": "$state.flag", "operator": "is_true"}},
                    {"id": "yes", "type": "output", "config": {"source": "$state.answer"}},
                ],
                "edges": [
                    {"from": "START", "to": "check"},
                    {"from": "check", "to": "yes", "condition": "true"},
                    {"from": "yes", "to": "END"},
                ],
            }
        )

        result = ManifestValidator(extension_registry, tool_registry).validate_result(manifest)

        self.assertFalse(result.valid)
        self.assertEqual(result.errors[0].code, "condition_routes_required")
        self.assertEqual(result.errors[0].node_id, "check")

    def test_agent_and_router_are_legacy_unsupported(self) -> None:
        from contextos.template.validator.validator import ManifestValidator

        extension_registry, tool_registry = create_registries()
        manifest = valid_manifest_with(
            graph={
                "state_schema": "default_chat_state",
                "nodes": [
                    {"id": "old_agent", "type": "agent", "config": {}},
                    {"id": "old_router", "type": "router", "config": {}},
                ],
                "edges": [
                    {"from": "START", "to": "old_agent"},
                    {"from": "old_agent", "to": "old_router"},
                    {"from": "old_router", "to": "END"},
                ],
            }
        )

        result = ManifestValidator(extension_registry, tool_registry).validate_result(manifest)

        self.assertFalse(result.valid)
        self.assertEqual(
            [(error.code, error.node_id, error.field) for error in result.errors[:2]],
            [
                ("unsupported_node_type", "old_agent", "graph.nodes[0].type"),
                ("unsupported_node_type", "old_router", "graph.nodes[1].type"),
            ],
        )


if __name__ == "__main__":
    unittest.main()
