import unittest


def base_payload(nodes, edges):
    return {
        "template": {"id": "workflow", "name": "Workflow", "version": "1.0.0"},
        "graph": {
            "state_schema": "default_chat_state",
            "nodes": nodes,
            "edges": edges,
        },
        "context": {
            "policy": "balanced",
            "budget": {"high_watermark": 0.8, "target_watermark": 0.65},
            "restore": {"mode": "auto", "max_tokens_per_restore": 12000, "max_restore_per_turn": 3},
        },
        "checkpoint": {"enabled": True},
        "ui": {"editable_messages": True, "expose_context_panel": True},
    }


class LangGraphManifestCompilerTests(unittest.TestCase):
    def test_start_agent_end_graph_runs(self) -> None:
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.compiler.langgraph_compiler import LangGraphManifestCompiler
        from contextos.template.manifest.parser import parse_manifest

        manifest = parse_manifest(
            base_payload(
                nodes=[
                    {
                        "id": "agent",
                        "type": "agent",
                        "config": {"output_key": "answer", "output": "hello from agent"},
                    }
                ],
                edges=[{"from": "START", "to": "agent"}, {"from": "agent", "to": "END"}],
            )
        )

        graph = LangGraphManifestCompiler().compile(manifest)
        state = graph.run({}, RuntimeContext("session-1", "timeline-1", "trace-1"))

        self.assertEqual(state["answer"], "hello from agent")
        self.assertEqual(state["visited_nodes"], ["agent"])

    def test_router_branch_selects_matching_edge(self) -> None:
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.compiler.langgraph_compiler import LangGraphManifestCompiler
        from contextos.template.manifest.parser import parse_manifest

        manifest = parse_manifest(
            base_payload(
                nodes=[
                    {"id": "router", "type": "router", "config": {"state_key": "route"}},
                    {"id": "billing", "type": "output", "config": {"output_key": "team", "output": "billing"}},
                    {"id": "support", "type": "output", "config": {"output_key": "team", "output": "support"}},
                ],
                edges=[
                    {"from": "START", "to": "router"},
                    {"from": "router", "to": "billing", "condition": "billing"},
                    {"from": "router", "to": "support", "condition": "support"},
                    {"from": "billing", "to": "END"},
                    {"from": "support", "to": "END"},
                ],
            )
        )

        graph = LangGraphManifestCompiler().compile(manifest)
        state = graph.run({"route": "support"}, RuntimeContext("session-1", "timeline-1", "trace-1"))

        self.assertEqual(state["team"], "support")
        self.assertEqual(state["visited_nodes"], ["router", "support"])

    def test_human_approval_node_returns_recoverable_interrupt(self) -> None:
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.compiler.langgraph_compiler import LangGraphManifestCompiler
        from contextos.template.manifest.parser import parse_manifest

        manifest = parse_manifest(
            base_payload(
                nodes=[
                    {
                        "id": "approval",
                        "type": "human_approval",
                        "config": {"prompt": "Approve external write?"},
                    }
                ],
                edges=[{"from": "START", "to": "approval"}, {"from": "approval", "to": "END"}],
            )
        )

        graph = LangGraphManifestCompiler().compile(manifest)
        state = graph.run({}, RuntimeContext("session-1", "timeline-1", "trace-1"))

        self.assertEqual(
            state["interrupt"],
            {
                "node_id": "approval",
                "type": "human_approval",
                "prompt": "Approve external write?",
                "recoverable": True,
            },
        )
        self.assertEqual(state["visited_nodes"], ["approval"])


if __name__ == "__main__":
    unittest.main()
