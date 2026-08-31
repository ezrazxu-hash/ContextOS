import unittest


class LlmNodeExecutorTests(unittest.TestCase):
    def test_prompt_mapping_builds_provider_messages(self) -> None:
        from contextos.runtime.graph.nodes.llm import LLMNodeExecutor
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.manifest.schema import NodeSpec

        provider = FakeProvider("ok")
        node = NodeSpec(
            id="planner",
            type="llm",
            config={
                "model": "default",
                "system_prompt": "You are helpful.",
                "prompt": "Topic: {{topic}}",
                "input_mapping": {"topic": "$state.input"},
                "output_key": "answer",
            },
        )

        LLMNodeExecutor(provider).build(node, RuntimeContext("session-1", "timeline-1", "trace-1"))({"input": "Mars"})

        self.assertEqual(
            provider.messages,
            [[{"role": "system", "content": "You are helpful."}, {"role": "user", "content": "Topic: Mars"}]],
        )

    def test_fake_llm_response_is_written_to_output_key(self) -> None:
        from contextos.runtime.graph.nodes.llm import LLMNodeExecutor
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.manifest.schema import NodeSpec

        node = NodeSpec(id="planner", type="llm", config=llm_config(output_key="planner_result"))

        state = LLMNodeExecutor(FakeProvider("planned")).build(node, RuntimeContext("session-1", "timeline-1", "trace-1"))({"input": "hello"})

        self.assertEqual(state["planner_result"], "planned")

    def test_response_is_written_to_generated_node_output_key_without_output_key(self) -> None:
        from contextos.runtime.graph.nodes.llm import LLMNodeExecutor
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.manifest.schema import NodeSpec

        node = NodeSpec(id="planner-1", type="llm", config={"model": "default", "prompt": "{{input}}"})

        state = LLMNodeExecutor(FakeProvider("planned")).build(node, RuntimeContext("session-1", "timeline-1", "trace-1"))(
            {"input": "hello"}
        )

        self.assertEqual(state["__planner_1_response"], "planned")

    def test_prompt_mapping_accepts_structured_node_output_reference(self) -> None:
        from contextos.runtime.graph.nodes.llm import LLMNodeExecutor
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.manifest.schema import NodeSpec

        provider = FakeProvider("ok")
        node = NodeSpec(
            id="planner",
            type="llm",
            config={
                "model": "default",
                "prompt": "Previous: {{draft}}",
                "input_mapping": {"draft": {"type": "node_output", "node_id": "compose-prompt", "port": "out"}},
            },
        )

        LLMNodeExecutor(provider).build(node, RuntimeContext("session-1", "timeline-1", "trace-1"))(
            {"__compose_prompt_out": "hello"}
        )

        self.assertEqual(provider.messages[0][0], {"role": "user", "content": "Previous: hello"})

    def test_runtime_events_are_appended_in_order(self) -> None:
        from contextos.runtime.graph.nodes.llm import LLMNodeExecutor
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.manifest.schema import NodeSpec

        node = NodeSpec(id="planner", type="llm", config=llm_config())

        state = LLMNodeExecutor(FakeProvider("planned")).build(node, RuntimeContext("session-1", "timeline-1", "trace-1"))({"input": "hello"})

        self.assertEqual([event["type"] for event in state["runtime_events"]], ["node_started", "token", "node_finished"])
        self.assertEqual(state["runtime_events"][1]["data"]["content"], "planned")

    def test_node_model_options_are_passed_to_provider(self) -> None:
        from contextos.runtime.graph.nodes.llm import LLMNodeExecutor
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.manifest.schema import NodeSpec

        provider = OptionsProvider("ok")
        node = NodeSpec(
            id="planner",
            type="llm",
            config=llm_config(
                provider="openai-compatible",
                model="gpt-workflow",
                temperature=0.3,
                max_tokens=512,
            ),
        )

        LLMNodeExecutor(provider).build(node, RuntimeContext("session-1", "timeline-1", "trace-1"))({"input": "hello"})

        self.assertEqual(
            provider.options,
            [
                {
                    "provider": "openai-compatible",
                    "model": "gpt-workflow",
                    "temperature": 0.3,
                    "max_tokens": 512,
                }
            ],
        )

    def test_provider_error_becomes_structured_node_error(self) -> None:
        from contextos.provider.base.chat_client import LlmProviderError
        from contextos.runtime.graph.nodes.llm import LLMNodeExecutionError, LLMNodeExecutor
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.manifest.schema import NodeSpec

        class FailingProvider:
            def complete(self, messages):
                del messages
                raise LlmProviderError("provider down")

        node = NodeSpec(id="planner", type="llm", config=llm_config())

        with self.assertRaises(LLMNodeExecutionError) as error:
            LLMNodeExecutor(FailingProvider()).build(node, RuntimeContext("session-1", "timeline-1", "trace-1"))({"input": "hello"})

        self.assertEqual(error.exception.code, "llm.request_failed")
        self.assertEqual(error.exception.node_id, "planner")


class FakeProvider:
    def __init__(self, response: str) -> None:
        self.response = response
        self.messages = []

    def complete(self, messages):
        self.messages.append(messages)
        return self.response


class OptionsProvider:
    def __init__(self, response: str) -> None:
        self.response = response
        self.options = []

    def complete(self, messages, options=None):
        del messages
        self.options.append(dict(options or {}))
        return self.response


def llm_config(**overrides):
    config = {
        "model": "default",
        "prompt": "{{input}}",
        "input_mapping": {"input": "$state.input"},
        "output_key": "answer",
    }
    config.update(overrides)
    return config


if __name__ == "__main__":
    unittest.main()
