from typing import Protocol


class LlmProviderError(Exception):
    pass


class LlmHttpError(LlmProviderError):
    pass


class LlmResponseFormatError(LlmProviderError):
    pass


class LlmStreamError(LlmProviderError):
    pass


class LlmTimeoutError(LlmProviderError):
    pass


class ChatCompletionClient(Protocol):
    def complete(self, messages: list[dict[str, str]]) -> str:
        ...

    def stream_complete(self, messages: list[dict[str, str]]):
        ...
