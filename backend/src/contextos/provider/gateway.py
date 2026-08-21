from collections.abc import Callable

from contextos.context.compiler.compiler import CompileResult


class ProviderGateway:
    def __init__(self, sender: Callable[[list[dict[str, object]]], object]) -> None:
        self._sender = sender

    def send(self, compiled: CompileResult) -> dict[str, object]:
        if not isinstance(compiled, CompileResult):
            raise TypeError("ProviderGateway accepts only CompileResult from ContextCompiler")
        if not compiled.allowed:
            return {"status": "blocked", "reason": "compiler_rejected"}
        self._sender(compiled.provider_payload)
        return {"status": "sent"}
