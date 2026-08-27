from typing import Protocol


class ChatCompletionClient(Protocol):
    def complete(self, messages: list[dict[str, str]]) -> str:
        ...

    def stream_complete(self, messages: list[dict[str, str]]):
        ...
