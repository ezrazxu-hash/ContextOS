import unittest


class AgentNodeExecutorTests(unittest.TestCase):
    def test_agent_schema_is_distinct_from_llm_schema(self) -> None:
        from contextos.template.nodes.agent_schema import validate_agent_node_config

        errors = validate_agent_node_config(
            {"model": "default", "prompt_template": "{{input}}", "output_key": "answer"},
            field_prefix="config",
        )

        self.assertEqual(errors[0].code, "agent_config.required")
        self.assertEqual(errors[0].field, "config.instruction")

    def test_context_is_included_in_single_turn_messages(self) -> None:
        from contextos.runtime.graph.nodes.agent import AgentNodeExecutor
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.manifest.schema import NodeSpec

        provider = FakeProvider("ok")
        context_api = FakeContextAPI(["persisted context"])
        node = NodeSpec(id="agent", type="agent", config=agent_config())

        AgentNodeExecutor(provider).build(node, RuntimeContext("session-1", "timeline-1", "trace-1", context_api=context_api))(
            {"input": "hello"}
        )

        self.assertEqual(provider.messages[0][0], {"role": "system", "content": "Use context."})
        self.assertIn("persisted context", provider.messages[0][1]["content"])
        self.assertIn("hello", provider.messages[0][1]["content"])

    def test_single_turn_output_is_written_to_output_key(self) -> None:
        from contextos.runtime.graph.nodes.agent import AgentNodeExecutor
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.manifest.schema import NodeSpec

        node = NodeSpec(id="agent", type="agent", config=agent_config(output_key="agent_answer"))

        state = AgentNodeExecutor(FakeProvider("agent-ok")).build(node, RuntimeContext("session-1", "timeline-1", "trace-1"))(
            {"input": "hello"}
        )

        self.assertEqual(state["agent_answer"], "agent-ok")

    def test_tool_loop_config_is_rejected_explicitly(self) -> None:
        from contextos.runtime.graph.nodes.agent import AgentNodeExecutionError, AgentNodeExecutor
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.manifest.schema import NodeSpec

        node = NodeSpec(id="agent", type="agent", config=agent_config(tool_loop=True))

        with self.assertRaises(AgentNodeExecutionError) as error:
            AgentNodeExecutor(FakeProvider("agent-ok")).build(node, RuntimeContext("session-1", "timeline-1", "trace-1"))(
                {"input": "hello"}
            )

        self.assertEqual(error.exception.code, "agent.tool_loop_unsupported")
        self.assertEqual(error.exception.node_id, "agent")


class FakeProvider:
    def __init__(self, response: str) -> None:
        self.response = response
        self.messages = []

    def complete(self, messages):
        self.messages.append(messages)
        return self.response


class FakeContextAPI:
    def __init__(self, context: list[str]) -> None:
        self.context = context

    def build_context(self, session_id: str, timeline_id: str) -> list[str]:
        self.request = (session_id, timeline_id)
        return self.context


def agent_config(**overrides) -> dict[str, object]:
    config = {
        "model": "default",
        "instruction": "Use context.",
        "input": "$state.input",
        "context_policy": "session",
        "tools": [],
        "max_steps": 1,
        "output_key": "answer",
    }
    config.update(overrides)
    return config


if __name__ == "__main__":
    unittest.main()
