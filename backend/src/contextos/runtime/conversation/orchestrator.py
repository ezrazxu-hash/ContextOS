from __future__ import annotations

from collections.abc import Iterator

from contextos.provider.base.chat_client import ChatCompletionClient, LlmProviderError, LlmResponseFormatError
from contextos.runtime.conversation.context_builder import ConversationContextBuilder
from contextos.runtime.conversation.service import ConversationGroupService
from contextos.runtime.session.message_service import MessageService


class ChatOrchestrator:
    def __init__(
        self,
        context_builder: ConversationContextBuilder,
        group_service: ConversationGroupService,
        message_service: MessageService,
        llm_client: ChatCompletionClient | None,
    ) -> None:
        self._context_builder = context_builder
        self._group_service = group_service
        self._message_service = message_service
        self._llm_client = llm_client

    def stream_runtime_events(self, session_id: str, timeline_id: str, trace_id: str) -> Iterator[dict[str, object]]:
        provider_messages = self._context_builder.build_llm_messages(session_id, timeline_id)
        latest_group = self._group_service.latest_group(session_id, timeline_id)
        group_id = latest_group.id if latest_group is not None else None

        if self._llm_client is not None and hasattr(self._llm_client, "stream_complete"):
            try:
                yielded_text = False
                for chunk in self._llm_client.stream_complete(provider_messages):
                    if not chunk:
                        continue
                    yielded_text = True
                    yield _token_event(chunk, trace_id, group_id)
                if not yielded_text:
                    raise LlmResponseFormatError("DeepSeek stream completed without assistant text")
            except LlmProviderError as error:
                yield {"type": "error", "data": {"message": str(error), "code": "llm.request_failed"}}
                return
        else:
            try:
                response = _assistant_response_for(provider_messages, self._llm_client)
            except LlmProviderError as error:
                yield {"type": "error", "data": {"message": str(error), "code": "llm.request_failed"}}
                return
            for chunk in _stream_chunks(response):
                yield _token_event(chunk, trace_id, group_id)

        yield {
            "type": "checkpoint",
            "data": {
                "graph_state": {"node": "chat", "status": "completed", "timeline_id": timeline_id},
                "message_cursor": len(self._message_service.list_messages(session_id, limit=10000, timeline_id=timeline_id)[0]) + 1,
                "context_revision": "demo-context-revision",
            },
        }
        yield {"type": "done", "data": {"message_id": "message-stream", "group_id": group_id}}


def _token_event(content: str, trace_id: str, group_id: str | None) -> dict[str, object]:
    return {
        "type": "token",
        "data": {
            "message_id": "message-stream",
            "role": "assistant",
            "content": content,
            "trace_id": trace_id,
            "group_id": group_id,
        },
    }


def _assistant_response_for(messages: list[dict[str, str]], llm_client: ChatCompletionClient | None = None) -> str:
    if llm_client is not None:
        return llm_client.complete(messages)
    latest_user = next((message["content"] for message in reversed(messages) if message["role"] == "user"), "")
    if "OK" in latest_user.upper():
        return "OK"
    return f"I heard: {latest_user}"


def _stream_chunks(content: str, size: int = 24) -> list[str]:
    return [content[index : index + size] for index in range(0, len(content), size)] or [""]
