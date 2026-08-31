from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass


ToolCallable = Callable[[dict[str, object]], Awaitable[object]]


@dataclass(frozen=True)
class ToolExecutor:
    tool_name: str
    run: ToolCallable
    required_args: tuple[str, ...] = ()


class FakeReadOnlyTool:
    def __init__(self, tool_name: str) -> None:
        self.tool_name = tool_name

    def as_executor(self) -> ToolExecutor:
        async def run(args: dict[str, object]) -> object:
            if "query" in args:
                return {"echo": args["query"]}
            return {"tool": self.tool_name, "args": dict(args)}

        return ToolExecutor(tool_name=self.tool_name, run=run)
