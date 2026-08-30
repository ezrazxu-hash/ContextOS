import unittest


class LlmNodeSchemaTests(unittest.TestCase):
    def test_required_fields_are_reported(self) -> None:
        from contextos.template.nodes.llm_schema import validate_llm_node_config

        issues = validate_llm_node_config({}, field_prefix="graph.nodes[0].config")

        self.assertEqual(
            [(issue.code, issue.field) for issue in issues],
            [
                ("llm_config.required", "graph.nodes[0].config.model"),
                ("llm_config.required", "graph.nodes[0].config.prompt_template"),
                ("llm_config.required", "graph.nodes[0].config.output_key"),
            ],
        )

    def test_temperature_must_be_in_supported_range(self) -> None:
        from contextos.template.nodes.llm_schema import validate_llm_node_config

        too_low = validate_llm_node_config(valid_config(temperature=-0.1), field_prefix="config")
        too_high = validate_llm_node_config(valid_config(temperature=2.1), field_prefix="config")

        self.assertEqual(too_low[0].field, "config.temperature")
        self.assertEqual(too_high[0].field, "config.temperature")

    def test_output_key_must_be_simple_state_key(self) -> None:
        from contextos.template.nodes.llm_schema import validate_llm_node_config

        issues = validate_llm_node_config(valid_config(output_key="answer.text"), field_prefix="config")

        self.assertEqual(issues[0].code, "llm_config.invalid_output_key")
        self.assertEqual(issues[0].field, "config.output_key")

    def test_input_mapping_values_must_reference_state_paths(self) -> None:
        from contextos.template.nodes.llm_schema import validate_llm_node_config

        issues = validate_llm_node_config(valid_config(input_mapping={"topic": "topic"}), field_prefix="config")

        self.assertEqual(issues[0].code, "llm_config.invalid_input_mapping")
        self.assertEqual(issues[0].field, "config.input_mapping.topic")


def valid_config(**overrides):
    config = {
        "model": "default",
        "system_prompt": "You are helpful.",
        "prompt_template": "{{input}}",
        "temperature": 0.2,
        "input_mapping": {"input": "$state.input"},
        "output_key": "answer",
    }
    config.update(overrides)
    return config


if __name__ == "__main__":
    unittest.main()
