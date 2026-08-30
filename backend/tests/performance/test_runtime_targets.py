from pathlib import Path
import sys
from time import perf_counter
import unittest


BACKEND_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND_ROOT / "src"))


class RuntimeTargetPerformanceTests(unittest.TestCase):
    def test_benchmark_report_contains_p50_and_p95(self) -> None:
        from contextos.performance.benchmark import benchmark_report

        report = benchmark_report(
            "compiler",
            samples_ms=[10.0, 20.0, 30.0, 40.0, 50.0],
            target_ms=100.0,
        )

        self.assertEqual(report["name"], "compiler")
        self.assertEqual(report["p50_ms"], 30.0)
        self.assertEqual(report["p95_ms"], 50.0)
        self.assertEqual(report["target_ms"], 100.0)
        self.assertEqual(report["status"], "pass")

    def test_debug_index_pages_large_message_history_without_full_load(self) -> None:
        from contextos.runtime.debug.projection import DebugProjection
        from contextos.runtime.session.message import MessageRole, MessageStatus, SessionMessage
        from contextos.runtime.session.repository import InMemorySessionRepository
        from contextos.runtime.session.service import SessionService
        from contextos.runtime.timeline.repository import InMemoryTimelineRepository
        from contextos.runtime.trace.repository import InMemoryTraceRepository
        from contextos.runtime.checkpoint.store import InMemoryCheckpointStore

        class CountingMessageService:
            def __init__(self) -> None:
                self.calls = []

            def list_messages(self, session_id: str, after_cursor: int | None = None, limit: int = 50):
                self.calls.append({"session_id": session_id, "after_cursor": after_cursor, "limit": limit})
                page = [
                    SessionMessage(
                        id=f"message-{cursor}",
                        session_id=session_id,
                        cursor=cursor,
                        role=MessageRole.USER,
                        content=f"message {cursor}",
                        status=MessageStatus.COMPLETED,
                        token_count=1,
                    )
                    for cursor in range(101, 151)
                ]
                return page, 150

        session_repository = InMemorySessionRepository()
        session = SessionService(session_repository).create_session("research-agent")
        message_service = CountingMessageService()
        projection = DebugProjection(
            session_repository,
            InMemoryTimelineRepository(),
            InMemoryCheckpointStore(),
            message_service,
            InMemoryTraceRepository(),
        )

        body = projection.index(session.id, message_after_cursor=100, message_limit=50)

        self.assertEqual(message_service.calls, [{"session_id": session.id, "after_cursor": 100, "limit": 50}])
        self.assertEqual(len(body["messages"]), 50)
        self.assertEqual(body["message_page"], {"after_cursor": 100, "limit": 50, "next_cursor": 150})

    def test_medium_workflow_graph_compile_and_run_stays_within_baseline(self) -> None:
        from contextos.performance.benchmark import benchmark_report
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.compiler.compile_service import GraphCompileService
        from contextos.template.manifest.parser import parse_manifest

        manifest = parse_manifest(linear_manifest_payload(node_count=120))
        started = perf_counter()
        graph = GraphCompileService().compile(manifest, node_executor_registry=step_registry())
        state = graph.run({}, RuntimeContext("session-1", "timeline-1", "trace-1"))
        duration_ms = (perf_counter() - started) * 1000
        report = benchmark_report("workflow-120-node-compile-run", [duration_ms], target_ms=2000)

        self.assertEqual(len(state["visited_nodes"]), 120)
        self.assertEqual(report["status"], "pass", report)


def linear_manifest_payload(node_count: int) -> dict[str, object]:
    nodes = [{"id": f"step-{index}", "type": "step", "config": {}} for index in range(node_count)]
    edges = [{"id": "start-step-0", "source": "START", "target": "step-0"}]
    edges.extend(
        {"id": f"step-{index}-step-{index + 1}", "source": f"step-{index}", "target": f"step-{index + 1}"}
        for index in range(node_count - 1)
    )
    edges.append({"id": f"step-{node_count - 1}-end", "source": f"step-{node_count - 1}", "target": "END"})
    return {
        "schema_version": "1.0",
        "runtime": {"nodes": nodes, "edges": edges},
        "ui": {"nodes": {}, "viewport": {}},
    }


def step_registry():
    class Executor:
        node_type = "step"

        def build(self, node, runtime_context):
            del runtime_context

            def run(state):
                return {**state, "visited_nodes": [*state.get("visited_nodes", []), node.id]}

            return run

    class Registry:
        def get(self, node_type: str):
            if node_type != "step":
                raise AssertionError(f"Unexpected executor lookup: {node_type}")
            return Executor()

    return Registry()


if __name__ == "__main__":
    unittest.main()
