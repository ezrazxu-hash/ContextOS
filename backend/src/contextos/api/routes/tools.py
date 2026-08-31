from contextos.tool.registry.registry import ToolRegistry


def list_tools(tool_registry: ToolRegistry) -> dict[str, object]:
    return {
        "status": 200,
        "body": {"tools": [tool.to_catalog_dict() for tool in tool_registry.list()]},
    }
