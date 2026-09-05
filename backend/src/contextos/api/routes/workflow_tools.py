from contextos.tool.registry.registry import ToolRegistry


def list_workflow_tools(tool_registry: ToolRegistry) -> dict[str, object]:
    return {
        "status": 200,
        "body": {
            "tools": [
                {
                    "id": tool.tool_id,
                    "name": tool.name,
                    "description": tool.description,
                    "inputSchema": dict(tool.input_schema or {}),
                    "outputSchema": dict(tool.output_schema or {}),
                }
                for tool in tool_registry.list()
            ]
        },
    }
