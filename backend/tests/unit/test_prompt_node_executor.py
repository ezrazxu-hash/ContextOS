import unittest


class PromptNodeExecutorTests(unittest.TestCase):
    def test_template_mapping_writes_rendered_text_to_output_key(self) -> None:
        from contextos.runtime.graph.nodes.prompt import PromptNodeExecutor
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.manifest.schema import NodeSpec

        node = NodeSpec(
            id="compose_prompt",
            type="prompt",
            config={
                "template": "Summarize {{topic}} for {{audience}}",
                "input_mapping": {"topic": "$state.topic", "audience": "finance"},
                "output_key": "prompt_text",
            },
        )

        state = PromptNodeExecutor().build(node, RuntimeContext("session-1", "timeline-1", "trace-1"))({"topic": "Q3 sales"})

        self.assertEqual(state["prompt_text"], "Summarize Q3 sales for finance")
        self.assertEqual([event["type"] for event in state["runtime_events"]], ["node_started", "node_finished"])

    def test_rendered_text_is_written_to_generated_node_output_key_without_output_key(self) -> None:
        from contextos.runtime.graph.nodes.prompt import PromptNodeExecutor
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.manifest.schema import NodeSpec

        node = NodeSpec(id="compose-prompt", type="prompt", config={"template": "Topic: {{topic}}", "input_mapping": {"topic": "$state.topic"}})

        state = PromptNodeExecutor().build(node, RuntimeContext("session-1", "timeline-1", "trace-1"))({"topic": "Q3 sales"})

        self.assertEqual(state["__compose_prompt_out"], "Topic: Q3 sales")

    def test_missing_state_reference_renders_empty_string(self) -> None:
        from contextos.runtime.graph.nodes.prompt import PromptNodeExecutor
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.manifest.schema import NodeSpec

        node = NodeSpec(
            id="compose_prompt",
            type="prompt",
            config={
                "template": "Topic: {{topic}}",
                "input_mapping": {"topic": "$state.missing"},
                "output_key": "prompt_text",
            },
        )

        state = PromptNodeExecutor().build(node, RuntimeContext("session-1", "timeline-1", "trace-1"))({})

        self.assertEqual(state["prompt_text"], "Topic: ")


if __name__ == "__main__":
    unittest.main()
