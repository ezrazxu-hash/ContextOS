from __future__ import annotations

from contextos.tool.executor import ToolExecutor


class ToolExecutorError(RuntimeError):
    def __init__(self, code: str, tool_name: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.tool_name = tool_name


class ToolExecutorNotFound(ToolExecutorError):
    pass


class ToolInputValidationError(ToolExecutorError):
    def __init__(self, code: str, tool_name: str, field: str, message: str) -> None:
        super().__init__(code, tool_name, message)
        self.field = field


class ToolExecutorRegistry:
    def __init__(self, tools: list[ToolExecutor] | None = None) -> None:
        self._tools: dict[str, ToolExecutor] = {}
        for tool in tools or []:
            self.register(tool)

    def register(self, executor: ToolExecutor) -> None:
        self._tools[executor.tool_name] = executor

    def has(self, tool_name: str) -> bool:
        return tool_name in self._tools

    def get(self, tool_name: str) -> ToolExecutor:
        if tool_name not in self._tools:
            raise ToolExecutorNotFound("tool.not_found", tool_name, f"Tool executor is not registered: {tool_name}")
        return self._tools[tool_name]

    async def execute(self, tool_name: str, args: dict[str, object]) -> object:
        executor = self.get(tool_name)
        for required_arg in executor.required_args:
            if required_arg not in args:
                raise ToolInputValidationError(
                    "tool.input_missing",
                    tool_name,
                    f"args.{required_arg}",
                    f"Missing required tool argument: {required_arg}",
                )
        return await executor.run(args)
