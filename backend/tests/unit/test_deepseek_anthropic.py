import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch


BACKEND_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND_ROOT / "src"))


class DeepSeekAnthropicClientTests(unittest.TestCase):
    def test_complete_disables_thinking_for_anthropic_format_requests(self) -> None:
        from contextos.provider.deepseek_anthropic import DeepSeekAnthropicClient, DeepSeekAnthropicConfig

        captured_payloads: list[dict[str, object]] = []

        def fake_urlopen(request, timeout):
            captured_payloads.append(json.loads(request.data.decode("utf-8")))
            return FakeResponse(
                {
                    "id": "msg-test",
                    "type": "message",
                    "role": "assistant",
                    "model": "deepseek-v4-pro",
                    "content": [{"type": "text", "text": "ContextOS Chat OK"}],
                    "stop_reason": "end_turn",
                    "stop_sequence": None,
                    "usage": {"input_tokens": 8, "output_tokens": 4},
                }
            )

        client = DeepSeekAnthropicClient(
            DeepSeekAnthropicConfig(
                base_url="https://api.deepseek.com/anthropic",
                api_key="test-key",
                model="deepseek-v4-pro",
            )
        )

        with patch("contextos.provider.deepseek_anthropic.urlopen", fake_urlopen):
            self.assertEqual(client.complete([{"role": "user", "content": "hello"}]), "ContextOS Chat OK")

        self.assertEqual(captured_payloads[0]["thinking"], {"type": "disabled"})

    def test_complete_applies_node_level_model_options_to_payload(self) -> None:
        from contextos.provider.deepseek_anthropic import DeepSeekAnthropicClient, DeepSeekAnthropicConfig

        captured_payloads: list[dict[str, object]] = []

        def fake_urlopen(request, timeout):
            del timeout
            captured_payloads.append(json.loads(request.data.decode("utf-8")))
            return FakeResponse({"content": [{"type": "text", "text": "ok"}]})

        client = DeepSeekAnthropicClient(
            DeepSeekAnthropicConfig(
                base_url="https://api.deepseek.com/anthropic",
                api_key="test-key",
                model="default-model",
                max_tokens=1000,
            )
        )

        with patch("contextos.provider.deepseek_anthropic.urlopen", fake_urlopen):
            self.assertEqual(
                client.complete(
                    [{"role": "user", "content": "hello"}],
                    {"model": "workflow-model", "max_tokens": 256, "temperature": 0.4},
                ),
                "ok",
            )

        self.assertEqual(captured_payloads[0]["model"], "workflow-model")
        self.assertEqual(captured_payloads[0]["max_tokens"], 256)
        self.assertEqual(captured_payloads[0]["temperature"], 0.4)

    def test_complete_reports_unexpected_response_shape(self) -> None:
        from contextos.provider.deepseek_anthropic import (
            DeepSeekAnthropicClient,
            DeepSeekAnthropicConfig,
            LlmResponseFormatError,
        )

        client = DeepSeekAnthropicClient(
            DeepSeekAnthropicConfig(
                base_url="https://api.deepseek.com/anthropic",
                api_key="test-key",
                model="deepseek-v4-pro",
            )
        )

        with patch("contextos.provider.deepseek_anthropic.urlopen", lambda request, timeout: FakeResponse({"choices": []})):
            with self.assertRaisesRegex(LlmResponseFormatError, "unexpected DeepSeek response shape"):
                client.complete([{"role": "user", "content": "hello"}])

    def test_complete_reports_empty_text_content(self) -> None:
        from contextos.provider.deepseek_anthropic import (
            DeepSeekAnthropicClient,
            DeepSeekAnthropicConfig,
            LlmResponseFormatError,
        )

        client = DeepSeekAnthropicClient(
            DeepSeekAnthropicConfig(
                base_url="https://api.deepseek.com/anthropic",
                api_key="test-key",
                model="deepseek-v4-pro",
            )
        )
        body = {"content": [{"type": "thinking", "thinking": "internal"}], "stop_reason": "end_turn"}

        with patch("contextos.provider.deepseek_anthropic.urlopen", lambda request, timeout: FakeResponse(body)):
            with self.assertRaisesRegex(LlmResponseFormatError, "DeepSeek returned no assistant text"):
                client.complete([{"role": "user", "content": "hello"}])

    def test_complete_reports_timeout_separately(self) -> None:
        from contextos.provider.deepseek_anthropic import DeepSeekAnthropicClient, DeepSeekAnthropicConfig, LlmTimeoutError

        def raise_timeout(request, timeout):
            raise TimeoutError("timed out")

        client = DeepSeekAnthropicClient(
            DeepSeekAnthropicConfig(
                base_url="https://api.deepseek.com/anthropic",
                api_key="test-key",
                model="deepseek-v4-pro",
            )
        )

        with patch("contextos.provider.deepseek_anthropic.urlopen", raise_timeout):
            with self.assertRaisesRegex(LlmTimeoutError, "timed out"):
                client.complete([{"role": "user", "content": "hello"}])

    def test_stream_complete_requests_stream_and_yields_text_deltas(self) -> None:
        from contextos.provider.deepseek_anthropic import DeepSeekAnthropicClient, DeepSeekAnthropicConfig

        captured_payloads: list[dict[str, object]] = []

        def fake_urlopen(request, timeout):
            captured_payloads.append(json.loads(request.data.decode("utf-8")))
            return FakeStreamResponse(
                [
                    'event: message_start\ndata: {"type":"message_start"}\n\n',
                    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello "}}\n\n',
                    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"world"}}\n\n',
                    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
                ]
            )

        client = DeepSeekAnthropicClient(
            DeepSeekAnthropicConfig(
                base_url="https://api.deepseek.com/anthropic",
                api_key="test-key",
                model="deepseek-v4-pro",
            )
        )

        with patch("contextos.provider.deepseek_anthropic.urlopen", fake_urlopen):
            self.assertEqual(list(client.stream_complete([{"role": "user", "content": "hello"}])), ["Hello ", "world"])

        self.assertEqual(captured_payloads[0]["stream"], True)
        self.assertEqual(captured_payloads[0]["thinking"], {"type": "disabled"})

    def test_stream_complete_reports_midstream_error_with_partial_text(self) -> None:
        from contextos.provider.deepseek_anthropic import DeepSeekAnthropicClient, DeepSeekAnthropicConfig, LlmStreamError

        def fake_urlopen(request, timeout):
            return FakeStreamResponse(
                [
                    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"partial"}}\n\n',
                    'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"busy"}}\n\n',
                ]
            )

        client = DeepSeekAnthropicClient(
            DeepSeekAnthropicConfig(
                base_url="https://api.deepseek.com/anthropic",
                api_key="test-key",
                model="deepseek-v4-pro",
            )
        )

        with patch("contextos.provider.deepseek_anthropic.urlopen", fake_urlopen):
            stream = client.stream_complete([{"role": "user", "content": "hello"}])
            self.assertEqual(next(stream), "partial")
            with self.assertRaisesRegex(LlmStreamError, "overloaded_error"):
                next(stream)

    def test_stream_complete_handles_split_utf8_text(self) -> None:
        from contextos.provider.deepseek_anthropic import DeepSeekAnthropicClient, DeepSeekAnthropicConfig

        frame = 'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"你好"}}\n\n'
        payload = frame.encode("utf-8")
        split_at = payload.index("你".encode("utf-8")) + 1

        def fake_urlopen(request, timeout):
            return FakeStreamBytes([payload[:split_at], payload[split_at:]])

        client = DeepSeekAnthropicClient(
            DeepSeekAnthropicConfig(
                base_url="https://api.deepseek.com/anthropic",
                api_key="test-key",
                model="deepseek-v4-pro",
            )
        )

        with patch("contextos.provider.deepseek_anthropic.urlopen", fake_urlopen):
            self.assertEqual(list(client.stream_complete([{"role": "user", "content": "hello"}])), ["你好"])


class FakeResponse:
    def __init__(self, body: dict[str, object]) -> None:
        self._body = body

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def read(self) -> bytes:
        return json.dumps(self._body).encode("utf-8")


class FakeStreamResponse:
    def __init__(self, frames: list[str]) -> None:
        self._frames = frames

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def __iter__(self):
        for frame in self._frames:
            yield frame.encode("utf-8")


class FakeStreamBytes:
    def __init__(self, chunks: list[bytes]) -> None:
        self._chunks = chunks

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def __iter__(self):
        yield from self._chunks


if __name__ == "__main__":
    unittest.main()
