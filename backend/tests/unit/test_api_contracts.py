from pathlib import Path
import os
import subprocess
import sys
import textwrap
import unittest


BACKEND_ROOT = Path(__file__).resolve().parents[2]
SRC_ROOT = BACKEND_ROOT / "src"
REPO_ROOT = BACKEND_ROOT.parent


def run_backend_python(script: str) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    existing_pythonpath = env.get("PYTHONPATH")
    env["PYTHONPATH"] = str(SRC_ROOT) if not existing_pythonpath else f"{SRC_ROOT}{os.pathsep}{existing_pythonpath}"
    return subprocess.run(
        [sys.executable, "-c", textwrap.dedent(script)],
        cwd=BACKEND_ROOT,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )


class ApiContractTests(unittest.TestCase):
    def test_duplicate_idempotency_key_does_not_execute_second_write(self) -> None:
        result = run_backend_python(
            """
            from contextos.api.idempotency import InMemoryIdempotencyStore

            writes = []
            store = InMemoryIdempotencyStore()

            first = store.run_once("restore-key-1", lambda: writes.append("write") or {"status": "created"})
            second = store.run_once("restore-key-1", lambda: writes.append("duplicate") or {"status": "created-again"})

            assert first == {"status": "created"}
            assert second == {"status": "created"}
            assert writes == ["write"]
            """
        )

        self.assertEqual(result.returncode, 0, result.stderr)

    def test_request_context_links_request_id_to_trace_attributes(self) -> None:
        result = run_backend_python(
            """
            from contextos.api.contracts.common import RequestContext

            context = RequestContext(request_id="req-1", trace_id="trace-1", idempotency_key="idem-1")

            assert context.trace_attributes() == {
                "request_id": "req-1",
                "trace_id": "trace-1",
                "idempotency_key": "idem-1",
            }
            """
        )

        self.assertEqual(result.returncode, 0, result.stderr)

    def test_rest_and_sse_errors_share_one_parse_contract(self) -> None:
        result = run_backend_python(
            """
            from contextos.api.errors import ApiError, parse_error_payload

            error = ApiError(code="context.missing", message="Context group not found", request_id="req-1", status=404)
            rest_payload = error.to_rest_payload()
            sse_payload = error.to_sse_event()

            assert parse_error_payload(rest_payload).code == "context.missing"
            assert parse_error_payload(sse_payload["data"]).request_id == "req-1"
            assert sse_payload["event"] == "error"
            """
        )

        self.assertEqual(result.returncode, 0, result.stderr)

    def test_protocol_boundaries_match_prd_transport_rules(self) -> None:
        result = run_backend_python(
            """
            from contextos.api.contracts.common import OperationKind, Transport, transport_for_operation

            assert transport_for_operation(OperationKind.CRUD) is Transport.REST
            assert transport_for_operation(OperationKind.STATE_WRITE) is Transport.REST
            assert transport_for_operation(OperationKind.LLM_STREAM) is Transport.SSE
            assert transport_for_operation(OperationKind.INTERRUPT_DEBUG) is Transport.WEBSOCKET
            """
        )

        self.assertEqual(result.returncode, 0, result.stderr)

    def test_api_conventions_document_records_transport_and_idempotency_rules(self) -> None:
        conventions = REPO_ROOT / "docs" / "implementation" / "api-conventions.md"

        self.assertTrue(conventions.exists(), f"missing API conventions document: {conventions}")
        text = conventions.read_text(encoding="utf-8")
        self.assertIn("CRUD / state operations use REST", text)
        self.assertIn("LLM streaming uses SSE", text)
        self.assertIn("WebSocket is reserved for Interrupt/debug control", text)
        self.assertIn("Replay, Restore, and Checkpoint writes require idempotency_key", text)


if __name__ == "__main__":
    unittest.main()
