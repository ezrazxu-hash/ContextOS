import unittest


class WorkflowV2ToolPolicyTests(unittest.TestCase):
    def test_workflow_tools_route_reuses_registered_tool_catalog(self) -> None:
        from contextos.api.routes.workflow_tools import list_workflow_tools
        from contextos.tool.registry.metadata import SideEffect, ToolMetadata
        from contextos.tool.registry.registry import ToolRegistry

        registry = ToolRegistry(
            [
                ToolMetadata(
                    tool_id="context.echo",
                    name="Context Echo",
                    description="Echo query",
                    side_effect=SideEffect.READ,
                    idempotent=True,
                    input_schema={"type": "object", "required": ["query"], "properties": {"query": {"type": "string"}}},
                    output_schema={"type": "object", "properties": {"echo": {"type": "string"}}},
                )
            ]
        )

        response = list_workflow_tools(registry)

        self.assertEqual(response["status"], 200)
        self.assertEqual(
            response["body"]["tools"],
            [
                {
                    "id": "context.echo",
                    "name": "Context Echo",
                    "description": "Echo query",
                    "inputSchema": {"type": "object", "required": ["query"], "properties": {"query": {"type": "string"}}},
                    "outputSchema": {"type": "object", "properties": {"echo": {"type": "string"}}},
                }
            ],
        )

    def test_accepts_auto_tool_policy_for_workflow_registered_tool(self) -> None:
        from contextos.tool.registry.metadata import SideEffect, ToolMetadata
        from contextos.tool.registry.registry import ToolRegistry
        from contextos.workflow_v2.application.validation import WorkflowV2DefinitionValidator

        registry = ToolRegistry([ToolMetadata(tool_id="context.echo", name="Context Echo", side_effect=SideEffect.READ)])
        result = WorkflowV2DefinitionValidator(tool_registry=registry).validate(
            workflow_definition(
                workflow_tools=["context.echo"],
                tool_policy={"mode": "auto", "allowedTools": ["context.echo"], "requiredTools": []},
            )
        )

        self.assertTrue(result["valid"], result["errors"])

    def test_rejects_required_tool_policy_outside_allowed_and_workflow_registry(self) -> None:
        from contextos.tool.registry.metadata import SideEffect, ToolMetadata
        from contextos.tool.registry.registry import ToolRegistry
        from contextos.workflow_v2.application.validation import WorkflowV2DefinitionValidator

        registry = ToolRegistry([ToolMetadata(tool_id="context.echo", name="Context Echo", side_effect=SideEffect.READ)])
        result = WorkflowV2DefinitionValidator(tool_registry=registry).validate(
            workflow_definition(
                workflow_tools=["context.echo"],
                tool_policy={"mode": "required", "allowedTools": ["missing.search"], "requiredTools": ["context.echo"]},
            )
        )

        self.assertFalse(result["valid"])
        errors_by_code = {error["code"]: error["field"] for error in result["errors"]}
        self.assertEqual(errors_by_code["node_tool_not_in_workflow_registry"], "nodes[0].config.toolPolicy.allowedTools[0]")
        self.assertEqual(errors_by_code["unknown_agent_tool"], "nodes[0].config.toolPolicy.allowedTools[0]")
        self.assertEqual(errors_by_code["required_tool_not_allowed"], "nodes[0].config.toolPolicy.requiredTools[0]")

    def test_rejects_disabled_tool_policy_with_configured_tools(self) -> None:
        from contextos.tool.registry.metadata import SideEffect, ToolMetadata
        from contextos.tool.registry.registry import ToolRegistry
        from contextos.workflow_v2.application.validation import WorkflowV2DefinitionValidator

        registry = ToolRegistry([ToolMetadata(tool_id="context.echo", name="Context Echo", side_effect=SideEffect.READ)])
        result = WorkflowV2DefinitionValidator(tool_registry=registry).validate(
            workflow_definition(
                workflow_tools=["context.echo"],
                tool_policy={"mode": "disabled", "allowedTools": ["context.echo"], "requiredTools": ["context.echo"]},
            )
        )

        self.assertFalse(result["valid"])
        self.assertIn("disabled_tool_policy_has_tools", [error["code"] for error in result["errors"]])


def workflow_definition(workflow_tools, tool_policy):
    return {
        "schemaVersion": 2,
        "id": "support-flow",
        "tools": workflow_tools,
        "nodes": [
            {
                "id": "agent-1",
                "type": "agent",
                "config": {
                    "instruction": "Analyze the user request.",
                    "visibility": "visible",
                    "toolPolicy": tool_policy,
                },
            },
            {"id": "end-1", "type": "end"},
        ],
        "edges": [{"source": "START", "target": "agent-1"}, {"source": "agent-1", "target": "end-1"}],
    }


if __name__ == "__main__":
    unittest.main()
