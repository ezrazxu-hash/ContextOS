import unittest


class WorkflowV2DefinitionValidatorTests(unittest.TestCase):
    def test_minimal_start_agent_end_graph_is_valid(self) -> None:
        from contextos.workflow_v2.application.validation import WorkflowV2DefinitionValidator

        result = WorkflowV2DefinitionValidator().validate(
            definition(
                nodes=[agent_node(), {"id": "end-1", "type": "end"}],
                edges=[
                    {"source": "START", "target": "agent-1"},
                    {"source": "agent-1", "target": "end-1"},
                ],
            )
        )

        self.assertTrue(result["valid"])
        self.assertEqual(result["errors"], [])

    def test_rejects_basic_invalid_topology(self) -> None:
        from contextos.workflow_v2.application.validation import WorkflowV2DefinitionValidator

        result = WorkflowV2DefinitionValidator().validate(
            definition(
                nodes=[{"id": "agent-1", "type": "agent"}, {"id": "agent-1", "type": "agent"}],
                edges=[
                    {"source": "START", "target": "missing"},
                    {"source": "agent-1", "target": "agent-1"},
                    {"source": "agent-1", "target": "START"},
                ],
            )
        )

        self.assertFalse(result["valid"])
        codes = [error["code"] for error in result["errors"]]
        self.assertIn("duplicate_node_id", codes)
        self.assertIn("missing_end_node", codes)
        self.assertIn("unknown_node", codes)
        self.assertIn("self_connection", codes)
        self.assertIn("start_has_incoming_edge", codes)

    def test_rejects_end_outgoing_and_multiple_agent_success_edges_and_duplicate_condition_branch(self) -> None:
        from contextos.workflow_v2.application.validation import WorkflowV2DefinitionValidator

        result = WorkflowV2DefinitionValidator().validate(
            definition(
                nodes=[
                    {"id": "agent-1", "type": "agent"},
                    {"id": "condition-1", "type": "condition"},
                    {"id": "end-1", "type": "end"},
                    {"id": "end-2", "type": "end"},
                ],
                edges=[
                    {"source": "START", "target": "agent-1"},
                    {"source": "agent-1", "target": "end-1"},
                    {"source": "agent-1", "target": "end-2"},
                    {"source": "end-1", "target": "end-2"},
                    {"source": "condition-1", "target": "end-1", "sourceHandle": "technical"},
                    {"source": "condition-1", "target": "end-2", "sourceHandle": "technical"},
                ],
            )
        )

        self.assertFalse(result["valid"])
        self.assertIn("end_has_outgoing_edge", [error["code"] for error in result["errors"]])
        self.assertIn("multiple_success_edges", [error["code"] for error in result["errors"]])
        self.assertIn("duplicate_condition_branch", [error["code"] for error in result["errors"]])

    def test_rejects_invalid_agent_node_execution_policy_fields(self) -> None:
        from contextos.workflow_v2.application.validation import WorkflowV2DefinitionValidator

        result = WorkflowV2DefinitionValidator().validate(
            definition(
                nodes=[
                    {
                        "id": "agent-1",
                        "type": "agent",
                        "config": {
                            "instruction": "  ",
                            "visibility": "private",
                            "retryPolicy": {
                                "schemaRetryCount": -1,
                                "nodeRetryCount": -2,
                                "timeoutMs": -10,
                            },
                            "promptTemplate": "legacy prompt",
                            "messageRole": "system",
                        },
                    },
                    {"id": "end-1", "type": "end"},
                ],
                edges=[
                    {"source": "START", "target": "agent-1"},
                    {"source": "agent-1", "target": "end-1"},
                ],
            )
        )

        self.assertFalse(result["valid"])
        codes = [error["code"] for error in result["errors"]]
        self.assertIn("agent_instruction_required", codes)
        self.assertIn("invalid_agent_visibility", codes)
        self.assertEqual(codes.count("invalid_retry_policy"), 3)
        self.assertEqual(codes.count("legacy_agent_field"), 2)

    def test_accepts_agent_node_execution_policy_without_legacy_prompt_fields(self) -> None:
        from contextos.workflow_v2.application.validation import WorkflowV2DefinitionValidator

        result = WorkflowV2DefinitionValidator().validate(
            definition(
                nodes=[
                    agent_node(
                        config={
                            "name": "Analyze Requirement",
                            "description": "Classify the incoming request",
                            "instruction": "Analyze the user request and return a structured summary.",
                            "visibility": "auto",
                            "contextPolicy": {
                                "conversationHistory": True,
                                "userInput": True,
                                "uploadedFiles": False,
                            },
                            "outputSchema": None,
                            "toolPolicy": {"mode": "disabled"},
                            "retryPolicy": {
                                "schemaRetryCount": 2,
                                "nodeRetryCount": 1,
                                "timeoutMs": 30000,
                            },
                        }
                    ),
                    {"id": "end-1", "type": "end"},
                ],
                edges=[
                    {"source": "START", "target": "agent-1"},
                    {"source": "agent-1", "target": "end-1"},
                ],
            )
        )

        self.assertTrue(result["valid"], result["errors"])

    def test_rejects_invalid_agent_node_output_schema_with_field_path(self) -> None:
        from contextos.workflow_v2.application.validation import WorkflowV2DefinitionValidator

        result = WorkflowV2DefinitionValidator().validate(
            definition(
                nodes=[
                    agent_node(
                        config={
                            "instruction": "Analyze the user request.",
                            "visibility": "visible",
                            "outputSchema": {
                                "type": "object",
                                "required": ["category"],
                                "properties": {
                                    "category": {"type": "string", "enum": []},
                                    "confidence": {"type": "decimal"},
                                },
                            },
                        }
                    ),
                    {"id": "end-1", "type": "end"},
                ],
                edges=[
                    {"source": "START", "target": "agent-1"},
                    {"source": "agent-1", "target": "end-1"},
                ],
            )
        )

        self.assertFalse(result["valid"])
        errors_by_field = {error["field"]: error["code"] for error in result["errors"]}
        self.assertEqual(errors_by_field["nodes[0].config.outputSchema.properties.category.enum"], "invalid_output_schema")
        self.assertEqual(errors_by_field["nodes[0].config.outputSchema.properties.confidence.type"], "invalid_output_schema")

    def test_rejects_condition_source_that_is_not_agent_output_schema_field(self) -> None:
        from contextos.workflow_v2.application.validation import WorkflowV2DefinitionValidator

        result = WorkflowV2DefinitionValidator().validate(
            definition(
                nodes=[
                    agent_node(
                        config={
                            "instruction": "Classify the user request.",
                            "visibility": "visible",
                            "outputSchema": {
                                "type": "object",
                                "properties": {
                                    "category": {"type": "string", "enum": ["technical", "business"]},
                                },
                            },
                            "toolPolicy": {"mode": "disabled"},
                        }
                    ),
                    {
                        "id": "condition-1",
                        "type": "condition",
                        "config": {
                            "branches": [
                                {"handle": "bad-source", "source": {"nodeId": "missing-agent", "path": ["category"]}, "operator": "equals", "value": "technical"},
                                {"handle": "bad-field", "source": {"nodeId": "agent-1", "path": ["missing"]}, "operator": "equals", "value": "technical"},
                            ],
                        },
                    },
                    {"id": "end-1", "type": "end"},
                ],
                edges=[
                    {"source": "START", "target": "agent-1"},
                    {"source": "agent-1", "target": "condition-1"},
                    {"source": "condition-1", "target": "end-1", "sourceHandle": "bad-source"},
                    {"source": "condition-1", "target": "end-1", "sourceHandle": "bad-field"},
                ],
            )
        )

        self.assertFalse(result["valid"])
        errors_by_field = {error["field"]: error["code"] for error in result["errors"]}
        self.assertEqual(errors_by_field["nodes[1].config.branches[0].source.nodeId"], "condition_source_not_agent")
        self.assertEqual(errors_by_field["nodes[1].config.branches[1].source.path"], "condition_source_field_not_found")


def definition(nodes, edges):
    return {"schemaVersion": 2, "id": "support-flow", "nodes": nodes, "edges": edges}


def agent_node(config=None):
    return {
        "id": "agent-1",
        "type": "agent",
        "config": config
        or {
            "instruction": "Analyze the user request.",
            "visibility": "visible",
            "retryPolicy": {"schemaRetryCount": 0, "nodeRetryCount": 0, "timeoutMs": 1000},
        },
    }


if __name__ == "__main__":
    unittest.main()
