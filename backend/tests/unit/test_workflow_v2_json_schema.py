import unittest


class WorkflowV2JsonSchemaServiceTests(unittest.TestCase):
    def test_accepts_mvp_object_schema_with_required_enum_and_array_fields(self) -> None:
        from contextos.workflow_v2.application.json_schema import WorkflowV2JsonSchemaService

        result = WorkflowV2JsonSchemaService().validate_schema(
            {
                "type": "object",
                "required": ["category", "summary"],
                "properties": {
                    "category": {"type": "string", "enum": ["technical", "business", "other"]},
                    "summary": {"type": "string", "description": "Short summary"},
                    "confidence": {"type": "number"},
                    "tags": {"type": "array", "items": {"type": "string"}},
                },
            }
        )

        self.assertTrue(result["valid"], result["errors"])
        self.assertEqual(result["errors"], [])

    def test_rejects_invalid_schema_with_precise_paths(self) -> None:
        from contextos.workflow_v2.application.json_schema import WorkflowV2JsonSchemaService

        result = WorkflowV2JsonSchemaService().validate_schema(
            {
                "type": "object",
                "required": ["missing"],
                "properties": {
                    "category": {"type": "enum", "enum": []},
                    "created": {"type": "date"},
                    "items": {"type": "array"},
                },
            }
        )

        self.assertFalse(result["valid"])
        errors_by_path = {error["path"]: error["code"] for error in result["errors"]}
        self.assertEqual(errors_by_path["$.required[0]"], "unknown_required_field")
        self.assertEqual(errors_by_path["$.properties.category.type"], "unsupported_schema_type")
        self.assertEqual(errors_by_path["$.properties.category.enum"], "empty_enum")
        self.assertEqual(errors_by_path["$.properties.created.type"], "unsupported_schema_type")
        self.assertEqual(errors_by_path["$.properties.items.items"], "array_items_required")

    def test_validates_runtime_values_against_mvp_schema_subset(self) -> None:
        from contextos.workflow_v2.application.json_schema import WorkflowV2JsonSchemaService

        schema = {
            "type": "object",
            "required": ["summary", "confidence"],
            "properties": {
                "summary": {"type": "string"},
                "confidence": {"type": "number"},
                "category": {"type": "string", "enum": ["technical", "business"]},
            },
        }

        service = WorkflowV2JsonSchemaService()
        ok = service.validate_value(schema, {"summary": "Needs API work", "confidence": 0.82, "category": "technical"})
        bad = service.validate_value(schema, {"summary": 42, "category": "other"})

        self.assertTrue(ok["valid"], ok["errors"])
        self.assertFalse(bad["valid"])
        errors_by_path = {error["path"]: error["code"] for error in bad["errors"]}
        self.assertEqual(errors_by_path["$.summary"], "type_mismatch")
        self.assertEqual(errors_by_path["$.confidence"], "required_value_missing")
        self.assertEqual(errors_by_path["$.category"], "enum_value_not_allowed")


if __name__ == "__main__":
    unittest.main()
