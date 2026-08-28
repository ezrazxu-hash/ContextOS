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

    def test_host_persists_message_edit_and_soft_delete_across_restart(self) -> None:
        from contextos.api.server import create_http_runtime_host

        with tempfile.TemporaryDirectory() as temp_dir:
            storage_path = Path(temp_dir) / "runtime-state.json"
            host = create_http_runtime_host(host="127.0.0.1", port=0, storage_path=storage_path)
            host.start()
            try:
                session = post_json(f"{host.url}/api/sessions", {"agent_template_id": "research-agent"})
                timeline_id = session["current_timeline_id"]
                editable = post_json(
                    f"{host.url}/api/sessions/{session['id']}/messages",
                    {"role": "assistant", "content": "before edit", "token_count": 2, "timeline_id": timeline_id},
                )
                doomed = post_json(
                    f"{host.url}/api/sessions/{session['id']}/messages",
                    {"role": "user", "content": "hide me later", "token_count": 3, "timeline_id": timeline_id},
                )
                patched = patch_json(f"{host.url}/api/messages/{editable['id']}", {"new_content": "after edit"})
                deleted = delete_json(f"{host.url}/api/messages/{doomed['id']}")
            finally:
                host.stop()

            restarted = create_http_runtime_host(host="127.0.0.1", port=0, storage_path=storage_path)
            restarted.start()
            try:
                messages = get_json(f"{restarted.url}/api/sessions/{session['id']}/messages?timelineId={timeline_id}")
            finally:
                restarted.stop()

            self.assertEqual(patched["message"]["content"], "after edit")
            self.assertEqual(deleted["message_ids"], [doomed["id"]])
            self.assertIn("after edit", [message["content"] for message in messages["messages"]])
            self.assertNotIn("hide me later", [message["content"] for message in messages["messages"]])

            persisted = json.loads(storage_path.read_text(encoding="utf-8"))
            self.assertEqual(persisted["messages"][editable["id"]]["content"], "after edit")
            self.assertEqual(persisted["messages"][doomed["id"]]["content"], "hide me later")
            self.assertEqual(persisted["messages"][doomed["id"]]["is_deleted"], True)
            self.assertIsNotNone(persisted["messages"][doomed["id"]]["deleted_at"])

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

    def test_host_lists_created_sessions_for_workspace_navigation(self) -> None:
        from contextos.api.server import create_http_runtime_host

        host = create_http_runtime_host(host="127.0.0.1", port=0)
        host.start()
        try:
            first = post_json(f"{host.url}/api/sessions", {"agent_template_id": "research-agent"})
            second = post_json(f"{host.url}/api/sessions", {"agent_template_id": "research-agent"})
            sessions = get_json(f"{host.url}/api/sessions")
        finally:
            host.stop()

        session_ids = [session["id"] for session in sessions["sessions"]]
        self.assertIn("demo-session", session_ids)
        self.assertIn(first["id"], session_ids)
        self.assertIn(second["id"], session_ids)
        self.assertEqual(len(session_ids), len(set(session_ids)))

    def test_host_restores_all_empty_sessions_from_runtime_state(self) -> None:
        from contextos.api.server import create_http_runtime_host

        with tempfile.TemporaryDirectory() as temp_dir:
            storage_path = Path(temp_dir) / "runtime-state.json"
            host = create_http_runtime_host(host="127.0.0.1", port=0, storage_path=storage_path)
            host.start()
            try:
                first = post_json(f"{host.url}/api/sessions", {"agent_template_id": "research-agent"})
                second = post_json(f"{host.url}/api/sessions", {"agent_template_id": "research-agent"})
                third = post_json(f"{host.url}/api/sessions", {"agent_template_id": "research-agent"})
            finally:
                host.stop()

            restarted = create_http_runtime_host(host="127.0.0.1", port=0, storage_path=storage_path)
            restarted.start()
            try:
                sessions = get_json(f"{restarted.url}/api/sessions")
            finally:
                restarted.stop()

        session_ids = [session["id"] for session in sessions["sessions"]]
        self.assertIn(first["id"], session_ids)
        self.assertIn(second["id"], session_ids)
        self.assertIn(third["id"], session_ids)

    def test_host_deletes_session_and_related_runtime_records(self) -> None:
        from contextos.api.server import create_http_runtime_host

        with tempfile.TemporaryDirectory() as temp_dir:
            storage_path = Path(temp_dir) / "runtime-state.json"
            host = create_http_runtime_host(host="127.0.0.1", port=0, llm_client=RecordingStreamingLlmClient(["ok"]), storage_path=storage_path)
            host.start()
            try:
                keep = post_json(f"{host.url}/api/sessions", {"agent_template_id": "research-agent"})
                doomed = post_json(f"{host.url}/api/sessions", {"agent_template_id": "research-agent"})
                post_json(
                    f"{host.url}/api/sessions/{doomed['id']}/messages",
                    {"role": "user", "content": "Delete this session", "token_count": 3, "timeline_id": doomed["current_timeline_id"]},
                )
                get_text(f"{host.url}/sse/sessions/{doomed['id']}/chat?timelineId={doomed['current_timeline_id']}")

                deleted = delete_json(f"{host.url}/api/sessions/{doomed['id']}")
                sessions = get_json(f"{host.url}/api/sessions")
                missing = get_json_error(f"{host.url}/api/sessions/{doomed['id']}")
                kept_messages = get_json(f"{host.url}/api/sessions/{keep['id']}/messages?timelineId={keep['current_timeline_id']}")
            finally:
                host.stop()

            self.assertEqual(deleted["id"], doomed["id"])
            session_ids = [session["id"] for session in sessions["sessions"]]
            self.assertIn(keep["id"], session_ids)
            self.assertNotIn(doomed["id"], session_ids)
            self.assertEqual(missing["status"], 404)
            self.assertEqual(kept_messages["messages"], [])

            persisted = json.loads(storage_path.read_text(encoding="utf-8"))
            self.assertNotIn(doomed["id"], persisted["sessions"])
            self.assertFalse(any(record.get("session_id") == doomed["id"] for record in persisted["timelines"].values()))
            self.assertFalse(any(record.get("session_id") == doomed["id"] for record in persisted["messages"].values()))
            self.assertFalse(any(record.get("session_id") == doomed["id"] for record in persisted["conversation_groups"].values()))
            self.assertFalse(any(record.get("session_id") == doomed["id"] for record in persisted["checkpoints"].values()))

    def test_host_delete_missing_session_returns_not_found(self) -> None:
        from contextos.api.server import create_http_runtime_host

        host = create_http_runtime_host(host="127.0.0.1", port=0)
        host.start()
        try:
            response = delete_json_error(f"{host.url}/api/sessions/missing-session")
        finally:
            host.stop()

        self.assertEqual(response["status"], 404)
        self.assertEqual(response["body"]["error"]["code"], "session.not_found")

    def test_host_persists_lists_and_runs_workflow_templates(self) -> None:
        from contextos.api.server import create_http_runtime_host

        with tempfile.TemporaryDirectory() as temp_dir:
            storage_path = Path(temp_dir) / "runtime-state.json"
            payload = workflow_payload(
                template_id="workflow-http",
                name="HTTP Workflow",
                output="hello workflow",
                position={"x": 240, "y": 180},
            )
            host = create_http_runtime_host(host="127.0.0.1", port=0, storage_path=storage_path)
            host.start()
            try:
                created = post_json(f"{host.url}/api/templates", payload)
                listed = get_json(f"{host.url}/api/templates")
                loaded = get_json(f"{host.url}/api/templates/workflow-http")
                run = post_json(
                    f"{host.url}/api/templates/workflow-http/run",
                    {"graph_state": {}, "session_id": "session-1", "timeline_id": "timeline-1", "trace_id": "trace-1"},
                )
            finally:
                host.stop()

            restarted = create_http_runtime_host(host="127.0.0.1", port=0, storage_path=storage_path)
            restarted.start()
            try:
                reloaded_list = get_json(f"{restarted.url}/api/templates")
            finally:
                restarted.stop()

        self.assertEqual(created["id"], "workflow-http")
        self.assertIn("workflow-http", [item["id"] for item in listed["templates"]])
        self.assertEqual(loaded["manifest"]["graph"]["nodes"][0]["position"], {"x": 240, "y": 180})
        self.assertEqual(run["graph_state"]["answer"], "hello workflow")
        self.assertEqual(run["graph_state"]["visited_nodes"], ["agent"])
        self.assertIn("workflow-http", [item["id"] for item in reloaded_list["templates"]])

    def test_deleted_demo_session_is_not_reseeded_after_restart(self) -> None:
        from contextos.api.server import create_http_runtime_host

        with tempfile.TemporaryDirectory() as temp_dir:
            storage_path = Path(temp_dir) / "runtime-state.json"
            host = create_http_runtime_host(host="127.0.0.1", port=0, storage_path=storage_path)
            host.start()
            try:
                delete_json(f"{host.url}/api/sessions/demo-session")
            finally:
                host.stop()

            restarted = create_http_runtime_host(host="127.0.0.1", port=0, storage_path=storage_path)
            restarted.start()
            try:
                sessions = get_json(f"{restarted.url}/api/sessions")
            finally:
                restarted.stop()

        self.assertNotIn("demo-session", [session["id"] for session in sessions["sessions"]])

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


def patch_json(url: str, payload: dict[str, object]) -> dict[str, object]:
    request = Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="PATCH",
    )
    with urlopen(request, timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))


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


def delete_json(url: str) -> dict[str, object]:
    request = Request(url, method="DELETE")
    with urlopen(request, timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))


def delete_json_error(url: str) -> dict[str, object]:
    from urllib.error import HTTPError

    request = Request(url, method="DELETE")
    try:
        with urlopen(request, timeout=5) as response:
            return {"status": response.status, "body": json.loads(response.read().decode("utf-8"))}
    except HTTPError as error:
        return {"status": error.code, "body": json.loads(error.read().decode("utf-8"))}


def get_json_error(url: str) -> dict[str, object]:
    from urllib.error import HTTPError

    try:
        with urlopen(url, timeout=5) as response:
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


def workflow_payload(template_id: str, name: str, output: str, position: dict[str, int]) -> dict[str, object]:
    return {
        "template": {"id": template_id, "name": name, "version": "1.0.0"},
        "graph": {
            "state_schema": "default_chat_state",
            "nodes": [
                {
                    "id": "agent",
                    "type": "agent",
                    "config": {"output_key": "answer", "output": output},
                    "position": position,
                }
            ],
            "edges": [{"from": "START", "to": "agent"}, {"from": "agent", "to": "END"}],
        },
        "context": {
            "policy": "balanced",
            "budget": {"high_watermark": 0.8, "target_watermark": 0.65},
            "restore": {"mode": "auto", "max_tokens_per_restore": 12000, "max_restore_per_turn": 3},
        },
        "checkpoint": {"enabled": True},
        "ui": {"editable_messages": True, "expose_context_panel": True},
    }


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
