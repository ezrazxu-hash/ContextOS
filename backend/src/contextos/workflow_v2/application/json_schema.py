from __future__ import annotations

from typing import Any

SUPPORTED_SCHEMA_TYPES = frozenset({"string", "number", "integer", "boolean", "object", "array"})


class WorkflowV2JsonSchemaService:
    def validate_schema(self, schema: Any) -> dict[str, object]:
        errors: list[dict[str, object]] = []
        _validate_schema_node(schema, "$", errors)
        return {"valid": len(errors) == 0, "errors": errors}

    def validate_value(self, schema: dict[str, Any], value: Any) -> dict[str, object]:
        errors: list[dict[str, object]] = []
        schema_result = self.validate_schema(schema)
        if not schema_result["valid"]:
            return schema_result
        _validate_value_node(schema, value, "$", errors)
        return {"valid": len(errors) == 0, "errors": errors}


def _validate_schema_node(schema: Any, path: str, errors: list[dict[str, object]]) -> None:
    if not isinstance(schema, dict):
        errors.append(_error("schema_not_object", path, "JSON Schema node must be an object"))
        return

    schema_type = schema.get("type")
    if schema_type not in SUPPORTED_SCHEMA_TYPES:
        errors.append(_error("unsupported_schema_type", f"{path}.type", f"Unsupported schema type: {schema_type}"))

    if "enum" in schema:
        enum_values = schema.get("enum")
        if not isinstance(enum_values, list):
            errors.append(_error("enum_not_list", f"{path}.enum", "Enum must be a list"))
        elif len(enum_values) == 0:
            errors.append(_error("empty_enum", f"{path}.enum", "Enum must include at least one option"))

    if schema_type == "object":
        properties = schema.get("properties", {})
        if not isinstance(properties, dict):
            errors.append(_error("properties_not_object", f"{path}.properties", "Object schema properties must be an object"))
            properties = {}
        required = schema.get("required", [])
        if required is None:
            required = []
        if not isinstance(required, list):
            errors.append(_error("required_not_list", f"{path}.required", "Object schema required must be a list"))
            required = []
        for index, field_name in enumerate(required):
            if not isinstance(field_name, str):
                errors.append(_error("required_field_not_string", f"{path}.required[{index}]", "Required field name must be a string"))
            elif field_name not in properties:
                errors.append(_error("unknown_required_field", f"{path}.required[{index}]", f"Required field is not defined in properties: {field_name}"))
        for field_name, child_schema in properties.items():
            _validate_schema_node(child_schema, f"{path}.properties.{field_name}", errors)

    if schema_type == "array":
        if "items" not in schema:
            errors.append(_error("array_items_required", f"{path}.items", "Array schema must define items"))
        else:
            _validate_schema_node(schema.get("items"), f"{path}.items", errors)


def _validate_value_node(schema: dict[str, Any], value: Any, path: str, errors: list[dict[str, object]]) -> None:
    schema_type = schema.get("type")
    if schema_type == "object":
        if not isinstance(value, dict):
            errors.append(_error("type_mismatch", path, "Expected object"))
            return
        properties = schema.get("properties", {})
        required = schema.get("required", []) or []
        for field_name in required:
            if field_name not in value:
                errors.append(_error("required_value_missing", f"{path}.{field_name}", f"Required value is missing: {field_name}"))
        for field_name, child_schema in properties.items():
            if field_name in value:
                _validate_value_node(child_schema, value[field_name], f"{path}.{field_name}", errors)
        return
    if schema_type == "array":
        if not isinstance(value, list):
            errors.append(_error("type_mismatch", path, "Expected array"))
            return
        for index, item in enumerate(value):
            _validate_value_node(schema["items"], item, f"{path}[{index}]", errors)
        return

    if not _matches_type(schema_type, value):
        errors.append(_error("type_mismatch", path, f"Expected {schema_type}"))
        return
    if "enum" in schema and value not in schema["enum"]:
        errors.append(_error("enum_value_not_allowed", path, "Value is not included in enum options"))


def _matches_type(schema_type: Any, value: Any) -> bool:
    if schema_type == "string":
        return isinstance(value, str)
    if schema_type == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if schema_type == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if schema_type == "boolean":
        return isinstance(value, bool)
    return True


def _error(code: str, path: str, message: str) -> dict[str, object]:
    return {"code": code, "path": path, "message": message}
