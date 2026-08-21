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
                    "type": "agent",
                    "config": {"tools": ["web_search"]},
                },
                {"id": "review", "type": "custom", "extension": "extensions.requirement_review"},
            ],
            "edges": [{"from": "START", "to": "planner"}, {"from": "planner", "to": "review"}, {"from": "review", "to": "END"}],
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
    from contextos.tool.registry.metadata import SideEffect, ToolMetadata
    from contextos.tool.registry.registry import ToolRegistry

    extension_registry = ExtensionRegistry()
    extension_registry.register_custom_node("extensions.requirement_review", object())
    tool_registry = ToolRegistry([ToolMetadata(tool_id="web_search", name="Web Search", side_effect=SideEffect.READ, idempotent=True)])
    return extension_registry, tool_registry


class ManifestValidatorTests(unittest.TestCase):
    def test_edge_to_missing_node_fails(self) -> None:
        from contextos.template.validator.validator import ManifestValidationError, ManifestValidator

        extension_registry, tool_registry = create_registries()
        manifest = valid_manifest_with(
            graph={
                "state_schema": "default_chat_state",
                "nodes": [{"id": "planner", "type": "agent", "config": {"tools": ["web_search"]}}],
                "edges": [{"from": "planner", "to": "missing"}],
            }
        )

        with self.assertRaises(ManifestValidationError) as error:
            ManifestValidator(extension_registry, tool_registry).validate(manifest)

        self.assertEqual(error.exception.field_path, "graph.edges[0].to")

    def test_unregistered_custom_node_fails_without_dynamic_import(self) -> None:
        from contextos.template.extension.registry import ExtensionRegistry
        from contextos.template.validator.validator import ManifestValidationError, ManifestValidator
        from contextos.tool.registry.metadata import SideEffect, ToolMetadata
        from contextos.tool.registry.registry import ToolRegistry

        manifest = valid_manifest_with()
        tool_registry = ToolRegistry([ToolMetadata(tool_id="web_search", name="Web Search", side_effect=SideEffect.READ, idempotent=True)])

        with self.assertRaises(ManifestValidationError) as error:
            ManifestValidator(ExtensionRegistry(), tool_registry).validate(manifest)

        self.assertEqual(error.exception.field_path, "graph.nodes[1].extension")
        self.assertEqual(error.exception.code, "unknown_extension")

    def test_missing_tool_binding_fails(self) -> None:
        from contextos.template.validator.validator import ManifestValidationError, ManifestValidator
        from contextos.tool.registry.registry import ToolRegistry

        extension_registry, _ = create_registries()
        manifest = valid_manifest_with()

        with self.assertRaises(ManifestValidationError) as error:
            ManifestValidator(extension_registry, ToolRegistry()).validate(manifest)

        self.assertEqual(error.exception.field_path, "graph.nodes[0].config.tools[0]")
        self.assertEqual(error.exception.code, "unknown_tool")

    def test_registered_extensions_and_tools_validate(self) -> None:
        from contextos.template.validator.validator import ManifestValidator

        extension_registry, tool_registry = create_registries()

        self.assertEqual(ManifestValidator(extension_registry, tool_registry).validate(valid_manifest_with()), [])


if __name__ == "__main__":
    unittest.main()
