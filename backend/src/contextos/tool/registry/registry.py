from contextos.tool.registry.metadata import ReplayPolicy, SideEffect, ToolMetadata


class ToolRegistry:
    def __init__(self, tools: list[ToolMetadata] | None = None) -> None:
        self._tools: dict[str, ToolMetadata] = {}
        for tool in tools or []:
            self.register(tool)

    def register(self, metadata: ToolMetadata) -> None:
        self._tools[metadata.tool_id] = metadata

    def has(self, tool_id: str) -> bool:
        return tool_id in self._tools

    def get(self, tool_id: str) -> ToolMetadata:
        if tool_id not in self._tools:
            return ToolMetadata(
                tool_id=tool_id,
                name=tool_id,
                side_effect=SideEffect.WRITE,
                idempotent=False,
                replay_policy=ReplayPolicy.ASK,
            )
        return self._tools[tool_id]

    def list(self) -> list[ToolMetadata]:
        return [self._tools[tool_id] for tool_id in sorted(self._tools)]
