from pathlib import Path
import sys
import unittest


BACKEND_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND_ROOT / "src"))


class TwoNodeRunner:
    def __init__(self) -> None:
        self.seen_context = None

    def run(self, graph_state, runtime_context):
        self.seen_context = runtime_context
        return {
            "visited": [*graph_state["visited"], "planner", "writer"],
            "context": {
                "session_id": runtime_context.session_id,
                "timeline_id": runtime_context.timeline_id,
                "trace_id": runtime_context.trace_id,
            },
        }


class FailingRunner:
    def run(self, graph_state, runtime_context):
        raise RuntimeError("node failed")


class RuntimeExecutorTests(unittest.TestCase):
    def create_checkpoint_service(self):
        from contextos.runtime.checkpoint.service import CheckpointService
        from contextos.runtime.checkpoint.store import InMemoryCheckpointStore

        return CheckpointService(InMemoryCheckpointStore())

    def test_minimal_two_node_graph_runs_and_creates_checkpoint(self) -> None:
        from contextos.runtime.graph.executor import RuntimeExecutor

        checkpoint_service = self.create_checkpoint_service()
        result = RuntimeExecutor(TwoNodeRunner(), checkpoint_service).run(
            session_id="session-1",
            timeline_id="timeline-1",
            trace_id="trace-1",
            graph_state={"visited": []},
            message_cursor=2,
            context_revision="ctx-rev-1",
        )

        restored = checkpoint_service.restore_checkpoint(result.checkpoint_id)

        self.assertEqual(result.graph_state["visited"], ["planner", "writer"])
        self.assertEqual(restored.graph_state, result.graph_state)

    def test_runtime_context_contains_session_timeline_and_trace(self) -> None:
        from contextos.runtime.graph.executor import RuntimeExecutor

        runner = TwoNodeRunner()
        RuntimeExecutor(runner, self.create_checkpoint_service()).run(
            session_id="session-1",
            timeline_id="timeline-1",
            trace_id="trace-1",
            graph_state={"visited": []},
            message_cursor=2,
            context_revision="ctx-rev-1",
        )

        self.assertEqual(runner.seen_context.session_id, "session-1")
        self.assertEqual(runner.seen_context.timeline_id, "timeline-1")
        self.assertEqual(runner.seen_context.trace_id, "trace-1")

    def test_failed_execution_leaves_previous_checkpoint_recoverable(self) -> None:
        from contextos.runtime.graph.executor import RuntimeExecutor

        checkpoint_service = self.create_checkpoint_service()
        first = RuntimeExecutor(TwoNodeRunner(), checkpoint_service).run(
            session_id="session-1",
            timeline_id="timeline-1",
            trace_id="trace-1",
            graph_state={"visited": []},
            message_cursor=2,
            context_revision="ctx-rev-1",
        )

        with self.assertRaises(RuntimeError):
            RuntimeExecutor(FailingRunner(), checkpoint_service).run(
                session_id="session-1",
                timeline_id="timeline-1",
                trace_id="trace-2",
                graph_state={"visited": ["unsafe"]},
                message_cursor=3,
                context_revision="ctx-rev-2",
                parent_checkpoint_id=first.checkpoint_id,
            )

        restored = checkpoint_service.restore_checkpoint(first.checkpoint_id)
        self.assertEqual(restored.graph_state["visited"], ["planner", "writer"])

    def test_executor_does_not_construct_provider_payload(self) -> None:
        executor_source = BACKEND_ROOT / "src" / "contextos" / "runtime" / "graph" / "executor.py"

        self.assertTrue(executor_source.exists(), "missing runtime executor")
        source = executor_source.read_text(encoding="utf-8").lower()
        for forbidden in ["openai", "anthropic", "provider payload", "chat.completions"]:
            self.assertNotIn(forbidden, source)


if __name__ == "__main__":
    unittest.main()
