from __future__ import annotations

import json
import os
import socket
import codecs
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from contextos.provider.base.chat_client import (
    LlmHttpError,
    LlmProviderError,
    LlmResponseFormatError,
    LlmStreamError,
    LlmTimeoutError,
)


@dataclass(frozen=True)
class DeepSeekAnthropicConfig:
    base_url: str
    api_key: str
    model: str
    max_tokens: int = 1000

    @property
    def api_key_configured(self) -> bool:
        return bool(self.api_key)


class DeepSeekAnthropicClient:
    def __init__(self, config: DeepSeekAnthropicConfig, timeout: float = 60) -> None:
        self._config = config
        self._timeout = timeout

    def complete(self, messages: list[dict[str, str]], options: dict[str, object] | None = None) -> str:
        request = self._request(messages, stream=False, options=options)
        try:
            with urlopen(request, timeout=self._timeout) as response:
                body = json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            detail = _safe_error_detail(error)
            raise LlmHttpError(f"DeepSeek request failed with HTTP {error.code}: {detail}") from error
        except (TimeoutError, socket.timeout) as error:
            raise LlmTimeoutError(f"DeepSeek request timed out after {self._timeout:g}s") from error
        except URLError as error:
            if isinstance(error.reason, TimeoutError | socket.timeout):
                raise LlmTimeoutError(f"DeepSeek request timed out after {self._timeout:g}s") from error
            raise LlmProviderError(f"DeepSeek request failed: {error}") from error
        except json.JSONDecodeError as error:
            raise LlmResponseFormatError(f"DeepSeek returned invalid JSON: {error.msg}") from error
        except OSError as error:
            raise LlmProviderError(f"DeepSeek request failed: {error}") from error

        text = _extract_text(body)
        if not text:
            if not _has_text_container(body):
                raise LlmResponseFormatError(_unexpected_shape_error(body))
            raise LlmResponseFormatError(_empty_text_error(body))
        return text

    def stream_complete(self, messages: list[dict[str, str]]) -> Iterator[str]:
        request = self._request(messages, stream=True)
        try:
            with urlopen(request, timeout=self._timeout) as response:
                yield from _iter_stream_text(response)
        except HTTPError as error:
            detail = _safe_error_detail(error)
            raise LlmHttpError(f"DeepSeek stream failed with HTTP {error.code}: {detail}") from error
        except (TimeoutError, socket.timeout) as error:
            raise LlmTimeoutError(f"DeepSeek stream timed out after {self._timeout:g}s") from error
        except URLError as error:
            if isinstance(error.reason, TimeoutError | socket.timeout):
                raise LlmTimeoutError(f"DeepSeek stream timed out after {self._timeout:g}s") from error
            raise LlmProviderError(f"DeepSeek stream failed: {error}") from error
        except json.JSONDecodeError as error:
            raise LlmStreamError(f"DeepSeek stream returned invalid JSON: {error.msg}") from error
        except OSError as error:
            raise LlmProviderError(f"DeepSeek stream failed: {error}") from error

    def _request(self, messages: list[dict[str, str]], *, stream: bool, options: dict[str, object] | None = None) -> Request:
        options = options or {}
        payload = {
            "model": str(options.get("model") or self._config.model),
            "max_tokens": int(options.get("max_tokens") or self._config.max_tokens),
            "thinking": {"type": "disabled"},
            "messages": [{"role": item["role"], "content": item["content"]} for item in messages],
        }
        if stream:
            payload["stream"] = True
        if options.get("temperature") is not None:
            payload["temperature"] = float(options["temperature"])
        return Request(
            _messages_url(self._config.base_url),
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "x-api-key": self._config.api_key,
                "anthropic-version": "2023-06-01",
            },
            method="POST",
        )


def create_deepseek_client_from_env() -> DeepSeekAnthropicClient | None:
    if os.environ.get("CONTEXTOS_DISABLE_LLM") == "1":
        return None
    config = deepseek_config_from_env()
    if not config or not config.api_key_configured:
        return None
    return DeepSeekAnthropicClient(config)


def deepseek_config_from_env() -> DeepSeekAnthropicConfig | None:
    base_url = os.environ.get("ANTHROPIC_BASE_URL")
    api_key = os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")
    model = (
        os.environ.get("ANTHROPIC_MODEL")
        or os.environ.get("ANTHROPIC_DEFAULT_SONNET_MODEL")
        or os.environ.get("ANTHROPIC_DEFAULT_OPUS_MODEL")
        or os.environ.get("ANTHROPIC_DEFAULT_HAIKU_MODEL")
    )
    if not base_url or not model:
        return None
    return DeepSeekAnthropicConfig(base_url=base_url, api_key=api_key or "", model=model)


def describe_deepseek_env() -> str:
    config = deepseek_config_from_env()
    if not config:
        return "LLM Provider: local fallback (DeepSeek env not configured)"
    return f"LLM Provider: DeepSeek; Model: {config.model}; API Key: {'configured' if config.api_key_configured else 'missing'}"


def _messages_url(base_url: str) -> str:
    base = base_url.rstrip("/")
    return base if base.endswith("/v1/messages") else f"{base}/v1/messages"


def _extract_text(body: dict[str, Any]) -> str:
    content = body.get("content")
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, dict) and content.get("type") == "text":
        return str(content.get("text", "")).strip()
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(str(block.get("text", "")))
        return "".join(parts).strip()
    choices = body.get("choices")
    if isinstance(choices, list) and choices:
        first = choices[0]
        if isinstance(first, dict):
            message = first.get("message")
            if isinstance(message, dict):
                content = message.get("content")
                if isinstance(content, str):
                    return content.strip()
    return ""


def _empty_text_error(body: dict[str, Any]) -> str:
    summary = {
        "top_level_keys": sorted(body.keys()),
        "content_types": _content_types(body.get("content")),
        "stop_reason": body.get("stop_reason"),
        "finish_reason": _finish_reason(body),
        "has_error": "error" in body,
    }
    if "error" in body:
        summary["error"] = _redact_known_secret_fields(body["error"])
    return f"DeepSeek returned no assistant text; response summary: {json.dumps(summary, ensure_ascii=False, sort_keys=True)}"


def _unexpected_shape_error(body: dict[str, Any]) -> str:
    summary = {
        "top_level_keys": sorted(body.keys()),
        "has_content": "content" in body,
        "has_choices": "choices" in body,
        "has_error": "error" in body,
    }
    return f"unexpected DeepSeek response shape; response summary: {json.dumps(summary, ensure_ascii=False, sort_keys=True)}"


def _has_text_container(body: dict[str, Any]) -> bool:
    if "content" in body:
        return True
    choices = body.get("choices")
    if isinstance(choices, list) and choices and isinstance(choices[0], dict):
        return isinstance(choices[0].get("message"), dict)
    return False


def _content_types(content: object) -> list[str]:
    if isinstance(content, dict):
        return [str(content.get("type", "object"))]
    if isinstance(content, list):
        return [str(block.get("type", "object")) if isinstance(block, dict) else type(block).__name__ for block in content]
    if content is None:
        return []
    return [type(content).__name__]


def _finish_reason(body: dict[str, Any]) -> object:
    choices = body.get("choices")
    if isinstance(choices, list) and choices and isinstance(choices[0], dict):
        return choices[0].get("finish_reason")
    return None


def _iter_stream_text(response: object) -> Iterator[str]:
    decoder = codecs.getincrementaldecoder("utf-8")()
    buffer = ""
    yielded_text = False
    for raw_chunk in response:
        buffer += decoder.decode(raw_chunk)
        while _frame_separator(buffer) is not None:
            separator = _frame_separator(buffer)
            assert separator is not None
            index, length = separator
            frame, buffer = buffer[:index], buffer[index + length :]
            text = _stream_frame_text(frame)
            if text is not None:
                yielded_text = True
                yield text
    buffer += decoder.decode(b"", final=True)
    if buffer.strip():
        text = _stream_frame_text(buffer)
        if text is not None:
            yielded_text = True
            yield text
    if not yielded_text:
        raise LlmResponseFormatError("DeepSeek stream completed without assistant text")


def _frame_separator(buffer: str) -> tuple[int, int] | None:
    lf = buffer.find("\n\n")
    crlf = buffer.find("\r\n\r\n")
    if lf == -1 and crlf == -1:
        return None
    if crlf != -1 and (lf == -1 or crlf < lf):
        return crlf, 4
    return lf, 2


def _stream_frame_text(frame: str) -> str | None:
    event_type = ""
    data_lines: list[str] = []
    for line in frame.splitlines():
        if line.startswith("event:"):
            event_type = line.removeprefix("event:").strip()
        elif line.startswith("data:"):
            data_lines.append(line.removeprefix("data:").strip())
    if not data_lines:
        return None
    data_text = "\n".join(data_lines)
    if data_text == "[DONE]":
        return None
    data = json.loads(data_text)
    if event_type == "error" or data.get("type") == "error":
        error = data.get("error", {})
        if isinstance(error, dict):
            error_type = error.get("type", "stream_error")
            message = error.get("message", "DeepSeek stream error")
            raise LlmStreamError(f"DeepSeek stream error {error_type}: {message}")
        raise LlmStreamError("DeepSeek stream error")

    delta = data.get("delta")
    if isinstance(delta, dict):
        if delta.get("type") == "text_delta":
            return str(delta.get("text", ""))
        if "content" in delta:
            return str(delta.get("content") or "")

    content_block = data.get("content_block")
    if isinstance(content_block, dict) and content_block.get("type") == "text":
        return str(content_block.get("text", ""))

    choices = data.get("choices")
    if isinstance(choices, list) and choices:
        first = choices[0]
        if isinstance(first, dict):
            delta = first.get("delta")
            if isinstance(delta, dict) and delta.get("content") is not None:
                return str(delta.get("content") or "")
    return None


def _safe_error_detail(error: HTTPError) -> str:
    try:
        payload = error.read().decode("utf-8")
    except Exception:
        return ""
    try:
        body = json.loads(payload)
    except json.JSONDecodeError:
        return payload[:300]
    if isinstance(body, dict):
        return json.dumps(_redact_known_secret_fields(body), ensure_ascii=False)[:300]
    return str(body)[:300]


def _redact_known_secret_fields(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: "[redacted]" if "key" in key.lower() or "token" in key.lower() else _redact_known_secret_fields(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_redact_known_secret_fields(item) for item in value]
    return value
