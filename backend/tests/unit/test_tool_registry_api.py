import unittest


class ToolRegistryApiTests(unittest.TestCase):
    def test_tool_metadata_serializes_business_schema_for_builder(self) -> None:
        from contextos.tool.registry.metadata import SideEffect, ToolMetadata

        metadata = ToolMetadata(
            tool_id="orders.lookup",
            name="Lookup order",
            description="Find an order by id",
            side_effect=SideEffect.READ,
            idempotent=True,
            input_schema={"type": "object", "required": ["order_id"]},
            output_schema={"type": "object", "properties": {"status": {"type": "string"}}},
            config_schema={"type": "object", "properties": {"region": {"type": "string"}}},
        )

        self.assertEqual(
            metadata.to_catalog_dict(),
            {
                "id": "orders.lookup",
                "name": "Lookup order",
                "description": "Find an order by id",
                "side_effect": "READ",
                "idempotent": True,
                "replay_policy": "AUTO",
                "risk_level": "MEDIUM",
                "input_schema": {"type": "object", "required": ["order_id"]},
                "output_schema": {"type": "object", "properties": {"status": {"type": "string"}}},
                "config_schema": {"type": "object", "properties": {"region": {"type": "string"}}},
                "configurable": True,
            },
        )

    def test_list_tools_route_returns_registered_tools(self) -> None:
        from contextos.api.routes.tools import list_tools
        from contextos.tool.registry.metadata import SideEffect, ToolMetadata
        from contextos.tool.registry.registry import ToolRegistry

        registry = ToolRegistry(
            [
                ToolMetadata(
                    tool_id="orders.lookup",
                    name="Lookup order",
                    description="Find an order by id",
                    side_effect=SideEffect.READ,
                    idempotent=True,
                    input_schema={"type": "object"},
                    output_schema={"type": "object"},
                )
            ]
        )

        response = list_tools(registry)

        self.assertEqual(response["status"], 200)
        self.assertEqual(response["body"]["tools"][0]["id"], "orders.lookup")
        self.assertEqual(response["body"]["tools"][0]["description"], "Find an order by id")
        self.assertEqual(response["body"]["tools"][0]["input_schema"], {"type": "object"})

    def test_default_runtime_executes_registered_context_echo_tool(self) -> None:
        from contextos.api.routes.agent_test_runs import post_agent_version_test_run
        from contextos.api.routes.agents import post_agent_publish, put_agent_draft
        from contextos.api.routes.templates import post_template
        from contextos.api.routes.tools import list_tools
        from contextos.api.server import create_demo_services

        services = create_demo_services(llm_client=FakeProvider("lookup-key"))
        post_template(tool_workflow_manifest(), services.template_service)
        put_agent_draft("tool-agent", tool_workflow_manifest(), services.template_service)

        catalog = list_tools(services.tool_registry)
        published = post_agent_publish("tool-agent", services.publish_service)
        run = post_agent_version_test_run(published["body"]["id"], {"input": "hello"}, services.agent_test_run_service)

        self.assertEqual(catalog["body"]["tools"][0]["id"], "context.echo")
        self.assertEqual(published["status"], 200)
        self.assertEqual(run["body"]["status"], "completed")
        self.assertEqual(run["body"]["output"], {"echo": "lookup-key"})


class FakeProvider:
    def __init__(self, response: str) -> None:
        self.response = response

    def complete(self, messages, options=None):
        del messages, options
        return self.response


def tool_workflow_manifest() -> dict[str, object]:
    return {
        "schema_version": "1.0",
        "template": {"id": "tool-agent", "name": "Tool Agent", "version": "1.0.0"},
        "runtime": {
            "nodes": [
                {
                    "id": "planner",
                    "type": "llm",
                    "config": {
                        "model": "default",
                        "prompt": "{{input}}",
                        "input_mapping": {"input": "$state.input"},
                        "output_key": "answer",
                    },
                },
                {
                    "id": "lookup",
                    "type": "tool",
                    "config": {"tool_name": "context.echo", "args": {"query": "$state.answer"}, "output_key": "lookup_result"},
                },
                {"id": "final", "type": "output", "config": {"source": "$state.lookup_result"}},
            ],
            "edges": [
                {"source": "START", "target": "planner"},
                {"source": "planner", "target": "lookup"},
                {"source": "lookup", "target": "final"},
                {"source": "final", "target": "END"},
            ],
        },
        "ui": {"nodes": {}, "viewport": {}},
    }


if __name__ == "__main__":
    unittest.main()
