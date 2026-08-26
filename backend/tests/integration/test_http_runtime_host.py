from pathlib import Path
import json
import sys
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


def get_json(url: str) -> dict[str, object]:
    with urlopen(url, timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))


def get_text(url: str) -> str:
    request = Request(url, headers={"Accept": "text/event-stream"})
    with urlopen(request, timeout=5) as response:
        return response.read().decode("utf-8")


def post_json(url: str, payload: dict[str, object]) -> dict[str, object]:
    request = Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))


if __name__ == "__main__":
    unittest.main()
