from pathlib import Path
import json
import sys
import tempfile
import unittest
from urllib.request import Request, urlopen


BACKEND_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND_ROOT / "src"))


class HttpRuntimeHostTests(unittest.TestCase):
    def test_host_serves_demo_session_contracts_over_http(self) -> None:
        from contextos.api.server import create_http_runtime_host

        host = create_http_runtime_host(host="127.0.0.1", port=0)
        host.start()
        try:
            health = get_json(f"{host.url}/health")
            session = get_json(f"{host.url}/api/sessions/demo-session")
            messages = get_json(f"{host.url}/api/sessions/demo-session/messages")
            debug = get_json(f"{host.url}/api/debug/sessions/demo-session?traceId=trace-send-report-email")
            sse = get_text(f"{host.url}/sse/sessions/demo-session/chat")
        finally:
            host.stop()

        self.assertEqual(health["status"], "ok")
        self.assertEqual(session["id"], "demo-session")
        self.assertEqual(session["current_timeline_id"], "demo-timeline")
        self.assertGreaterEqual(len(messages["messages"]), 2)
        self.assertIsNone(messages["next_cursor"])
        self.assertEqual(debug["session"]["id"], "demo-session")
        self.assertEqual(debug["traces"]["items"][0]["trace_id"], "trace-send-report-email")
        self.assertIn("event: token", sse)
        self.assertIn("event: done", sse)

    def test_host_accepts_session_message_post_over_http(self) -> None:
        from contextos.api.server import create_http_runtime_host

        host = create_http_runtime_host(host="127.0.0.1", port=0)
        host.start()
        try:
            created = post_json(
                f"{host.url}/api/sessions/demo-session/messages",
                {"role": "user", "content": "Run the Studio interaction smoke.", "token_count": 6},
            )
            messages = get_json(f"{host.url}/api/sessions/demo-session/messages")
        finally:
            host.stop()

        self.assertEqual(created["role"], "user")
        self.assertEqual(created["content"], "Run the Studio interaction smoke.")
        self.assertIn("Run the Studio interaction smoke.", [message["content"] for message in messages["messages"]])

    def test_host_accepts_utf8_bom_json_message_post_over_http(self) -> None:
        from contextos.api.server import create_http_runtime_host

        host = create_http_runtime_host(host="127.0.0.1", port=0)
        host.start()
        try:
            created = post_raw_json(
                f"{host.url}/api/sessions/demo-session/messages",
                b"\xef\xbb\xbf" + json.dumps(
                    {"role": "user", "content": "Windows JSON body", "token_count": 3},
                ).encode("utf-8"),
            )
        finally:
            host.stop()

        self.assertEqual(created["role"], "user")
        self.assertEqual(created["content"], "Windows JSON body")

    def test_host_rejects_message_for_timeline_outside_session(self) -> None:
        from contextos.api.server import create_http_runtime_host

        host = create_http_runtime_host(host="127.0.0.1", port=0)
        host.start()
        try:
            first = post_json(f"{host.url}/api/sessions", {"agent_template_id": "research-agent"})
            second = post_json(f"{host.url}/api/sessions", {"agent_template_id": "research-agent"})
            response = post_json_error(
                f"{host.url}/api/sessions/{first['id']}/messages",
                {"role": "user", "content": "wrong timeline", "token_count": 2, "timeline_id": second["current_timeline_id"]},
            )
        finally:
            host.stop()

        self.assertEqual(response["status"], 400)
        self.assertEqual(response["body"]["error"]["code"], "timeline.invalid")

    def test_chat_stream_uses_latest_user_message_and_persists_assistant_response(self) -> None:
        from contextos.api.server import create_http_runtime_host

        host = create_http_runtime_host(host="127.0.0.1", port=0)
        host.start()
        try:
            post_json(
                f"{host.url}/api/sessions/demo-session/messages",
                {"role": "user", "content": "Hello, please reply with OK", "token_count": 5},
            )
            sse = get_text(f"{host.url}/sse/sessions/demo-session/chat?timelineId=demo-timeline")
            messages = get_json(f"{host.url}/api/sessions/demo-session/messages")
        finally:
            host.stop()

        self.assertIn("event: token", sse)
        self.assertIn('"content": "OK"', sse)
        assistant_messages = [message for message in messages["messages"] if message["role"] == "assistant"]
        self.assertEqual(assistant_messages[-1]["content"], "OK")
        self.assertEqual(assistant_messages[-1]["trace_id"], "trace-chat-response")

    def test_chat_stream_calls_configured_llm_client_with_persisted_context_and_persists_response(self) -> None:
        from contextos.api.server import create_http_runtime_host

        llm_client = RecordingLlmClient("ContextOS Chat OK")
        host = create_http_runtime_host(host="127.0.0.1", port=0, llm_client=llm_client)
        host.start()
        try:
            post_json(
                f"{host.url}/api/sessions/demo-session/messages",
                {"role": "user", "content": "Please reply with ContextOS Chat OK", "token_count": 5},
            )
            sse = get_text(f"{host.url}/sse/sessions/demo-session/chat?timelineId=demo-timeline")
            messages = get_json(f"{host.url}/api/sessions/demo-session/messages")
        finally:
            host.stop()

        self.assertEqual(
            llm_client.user_messages,
            ["Summarize the incident report and email the team.", "Please reply with ContextOS Chat OK"],
        )
        self.assertEqual(sse_token_text(sse), "ContextOS Chat OK")
        assistant_messages = [message for message in messages["messages"] if message["role"] == "assistant"]
        self.assertEqual(assistant_messages[-1]["content"], "ContextOS Chat OK")

    def test_chat_stream_uses_streaming_llm_client_and_persists_final_text(self) -> None:
        from contextos.api.server import create_http_runtime_host

        llm_client = StreamingLlmClient(["ContextOS ", "stream OK"])
        host = create_http_runtime_host(host="127.0.0.1", port=0, llm_client=llm_client)
        host.start()
        try:
            post_json(
                f"{host.url}/api/sessions/demo-session/messages",
                {"role": "user", "content": "stream please", "token_count": 2},
            )
            sse = get_text(f"{host.url}/sse/sessions/demo-session/chat?timelineId=demo-timeline")
            messages = get_json(f"{host.url}/api/sessions/demo-session/messages")
        finally:
            host.stop()

        self.assertEqual(llm_client.user_messages, ["Summarize the incident report and email the team.", "stream please"])
        self.assertEqual(sse_token_text(sse), "ContextOS stream OK")
        assistant_messages = [message for message in messages["messages"] if message["role"] == "assistant"]
        self.assertEqual(assistant_messages[-1]["content"], "ContextOS stream OK")

    def test_chat_stream_reports_midstream_llm_error_without_persisting_partial_assistant(self) -> None:
        from contextos.api.server import create_http_runtime_host

        llm_client = FailingStreamingLlmClient("DeepSeek stream error overloaded_error: busy")
        host = create_http_runtime_host(host="127.0.0.1", port=0, llm_client=llm_client)
        host.start()
        try:
            before = get_json(f"{host.url}/api/sessions/demo-session/messages")
            post_json(
                f"{host.url}/api/sessions/demo-session/messages",
                {"role": "user", "content": "stream fail", "token_count": 2},
            )
            sse = get_text(f"{host.url}/sse/sessions/demo-session/chat?timelineId=demo-timeline")
            after = get_json(f"{host.url}/api/sessions/demo-session/messages")
        finally:
            host.stop()

        self.assertEqual(sse_token_text(sse), "partial")
        self.assertIn("event: error", sse)
        self.assertIn("overloaded_error", sse)
        before_assistants = [message for message in before["messages"] if message["role"] == "assistant"]
        after_assistants = [message for message in after["messages"] if message["role"] == "assistant"]
        self.assertEqual(len(after_assistants), len(before_assistants))

    def test_chat_stream_can_retry_after_midstream_llm_error(self) -> None:
        from contextos.api.server import create_http_runtime_host

        llm_client = FlakyStreamingLlmClient()
        host = create_http_runtime_host(host="127.0.0.1", port=0, llm_client=llm_client)
        host.start()
        try:
            before = get_json(f"{host.url}/api/sessions/demo-session/messages")
            post_json(
                f"{host.url}/api/sessions/demo-session/messages",
                {"role": "user", "content": "first try", "token_count": 2},
            )
            failed_sse = get_text(f"{host.url}/sse/sessions/demo-session/chat?timelineId=demo-timeline")
            post_json(
                f"{host.url}/api/sessions/demo-session/messages",
                {"role": "user", "content": "retry try", "token_count": 2},
            )
            retry_sse = get_text(f"{host.url}/sse/sessions/demo-session/chat?timelineId=demo-timeline")
            after = get_json(f"{host.url}/api/sessions/demo-session/messages")
        finally:
            host.stop()

        self.assertIn("event: error", failed_sse)
        self.assertEqual(sse_token_text(retry_sse), "retry ok")
        before_assistants = [message for message in before["messages"] if message["role"] == "assistant"]
        after_assistants = [message for message in after["messages"] if message["role"] == "assistant"]
        self.assertEqual(len(after_assistants), len(before_assistants) + 1)
        self.assertEqual(after_assistants[-1]["content"], "retry ok")

    def test_session_timeline_groups_reload_and_continue_with_persisted_llm_context(self) -> None:
        from contextos.api.server import create_http_runtime_host

        with tempfile.TemporaryDirectory() as temp_dir:
            storage_path = Path(temp_dir) / "runtime-state.json"
            first_llm = RecordingStreamingLlmClient(["Hello Tom.", "Your name is Tom."])
            host = create_http_runtime_host(host="127.0.0.1", port=0, llm_client=first_llm, storage_path=storage_path)
            host.start()
            try:
                session = post_json(f"{host.url}/api/sessions", {"agent_template_id": "research-agent"})
                session_id = str(session["id"])
                timeline_id = str(session["current_timeline_id"])
                post_json(
                    f"{host.url}/api/sessions/{session_id}/messages",
                    {"role": "user", "content": "My name is Tom", "token_count": 4, "timeline_id": timeline_id},
                )
                get_text(f"{host.url}/sse/sessions/{session_id}/chat?timelineId={timeline_id}")
                post_json(
                    f"{host.url}/api/sessions/{session_id}/messages",
                    {"role": "user", "content": "What is my name?", "token_count": 4, "timeline_id": timeline_id},
                )
                get_text(f"{host.url}/sse/sessions/{session_id}/chat?timelineId={timeline_id}")
            finally:
                host.stop()

            second_llm = RecordingStreamingLlmClient(["We discussed that your name is Tom."])
            restarted = create_http_runtime_host(host="127.0.0.1", port=0, llm_client=second_llm, storage_path=storage_path)
            restarted.start()
            try:
                reloaded = get_json(f"{restarted.url}/api/sessions/{session_id}/messages?timelineId={timeline_id}")
                post_json(
                    f"{restarted.url}/api/sessions/{session_id}/messages",
                    {"role": "user", "content": "Summarize what we discussed.", "token_count": 5, "timeline_id": timeline_id},
                )
                get_text(f"{restarted.url}/sse/sessions/{session_id}/chat?timelineId={timeline_id}")
            finally:
                restarted.stop()

        self.assertEqual(
            [message["content"] for message in reloaded["messages"]],
            ["My name is Tom", "Hello Tom.", "What is my name?", "Your name is Tom."],
        )
        self.assertEqual(
            second_llm.calls[-1],
            [
                {"role": "user", "content": "My name is Tom"},
                {"role": "assistant", "content": "Hello Tom."},
                {"role": "user", "content": "What is my name?"},
                {"role": "assistant", "content": "Your name is Tom."},
                {"role": "user", "content": "Summarize what we discussed."},
            ],
        )


def get_json(url: str) -> dict[str, object]:
    with urlopen(url, timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))


def get_text(url: str) -> str:
    request = Request(url, headers={"Accept": "text/event-stream"})
    with urlopen(request, timeout=5) as response:
        return response.read().decode("utf-8")


def post_json(url: str, payload: dict[str, object]) -> dict[str, object]:
    return post_raw_json(url, json.dumps(payload).encode("utf-8"))


def post_raw_json(url: str, payload: bytes) -> dict[str, object]:
    request = Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))


def post_json_error(url: str, payload: dict[str, object]) -> dict[str, object]:
    from urllib.error import HTTPError

    request = Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=5) as response:
            return {"status": response.status, "body": json.loads(response.read().decode("utf-8"))}
    except HTTPError as error:
        return {"status": error.code, "body": json.loads(error.read().decode("utf-8"))}


def sse_token_text(sse: str) -> str:
    parts: list[str] = []
    for frame in sse.split("\n\n"):
        event_type = None
        data = None
        for line in frame.splitlines():
            if line.startswith("event: "):
                event_type = line.removeprefix("event: ")
            if line.startswith("data: "):
                data = json.loads(line.removeprefix("data: "))
        if event_type == "token" and data is not None:
            parts.append(str(data["content"]))
    return "".join(parts)


class RecordingLlmClient:
    def __init__(self, response: str) -> None:
        self.response = response
        self.user_messages: list[str] = []

    def complete(self, messages: list[dict[str, str]]) -> str:
        self.user_messages = [message["content"] for message in messages if message["role"] == "user"]
        return self.response


class StreamingLlmClient:
    def __init__(self, chunks: list[str]) -> None:
        self.chunks = chunks
        self.user_messages: list[str] = []

    def stream_complete(self, messages: list[dict[str, str]]):
        self.user_messages = [message["content"] for message in messages if message["role"] == "user"]
        yield from self.chunks


class FailingStreamingLlmClient:
    def __init__(self, message: str) -> None:
        self.message = message

    def stream_complete(self, messages: list[dict[str, str]]):
        from contextos.provider.deepseek_anthropic import LlmStreamError

        yield "partial"
        raise LlmStreamError(self.message)


class FlakyStreamingLlmClient:
    def __init__(self) -> None:
        self.calls = 0

    def stream_complete(self, messages: list[dict[str, str]]):
        from contextos.provider.deepseek_anthropic import LlmStreamError

        self.calls += 1
        if self.calls == 1:
            yield "partial"
            raise LlmStreamError("DeepSeek stream error overloaded_error: busy")
        yield "retry ok"


class RecordingStreamingLlmClient:
    def __init__(self, responses: list[str]) -> None:
        self.responses = responses
        self.calls: list[list[dict[str, str]]] = []

    def stream_complete(self, messages: list[dict[str, str]]):
        self.calls.append(messages)
        response = self.responses.pop(0)
        yield response


if __name__ == "__main__":
    unittest.main()
