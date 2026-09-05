const FIELD_TYPES = ["string", "number", "integer", "boolean", "enum", "object", "array"];

export function createWorkflowV2SchemaBuilder(initialSchema = null) {
  const state = {
    fields: schemaToFields(initialSchema),
  };

  return {
    addField(field) {
      state.fields.push(normalizeField(field));
      return this.view();
    },
    removeField(name) {
      state.fields = state.fields.filter((field) => field.name !== name);
      return this.view();
    },
    updateArrayItem(name, item) {
      const field = state.fields.find((candidate) => candidate.name === name);
      if (!field) {
        throw new Error(`Unknown schema field: ${name}`);
      }
      if (field.type !== "array") {
        throw new Error(`Schema field is not an array: ${name}`);
      }
      field.item = normalizeArrayItem(item);
      return this.view();
    },
    validate() {
      const errors = [];
      const seen = new Set();
      state.fields.forEach((field, index) => {
        const name = String(field.name ?? "").trim();
        if (!name) {
          errors.push({ code: "field_name_required", field: `fields[${index}].name`, message: "Field name is required" });
          return;
        }
        if (seen.has(name)) {
          errors.push({ code: "duplicate_field_name", field: `fields[${index}].name`, message: `Duplicate field name: ${name}` });
        }
        seen.add(name);
        if (!FIELD_TYPES.includes(field.type)) {
          errors.push({ code: "unsupported_field_type", field: `fields[${index}].type`, message: `Unsupported field type: ${field.type}` });
        }
        if (field.type === "enum" && field.enumOptions.length === 0) {
          errors.push({ code: "enum_options_required", field: `fields[${index}].enumOptions`, message: "Enum fields require at least one option" });
        }
      });
      return { valid: errors.length === 0, errors };
    },
    toJsonSchema() {
      const properties = {};
      const required = [];
      state.fields.forEach((field) => {
        const name = String(field.name ?? "").trim();
        if (!name) {
          return;
        }
        properties[name] = fieldToSchema(field);
        if (field.required) {
          required.push(name);
        }
      });
      return {
        type: "object",
        ...(required.length ? { required } : {}),
        properties,
      };
    },
    view() {
      const validation = this.validate();
      return {
        fields: deepClone(state.fields),
        jsonSchema: this.toJsonSchema(),
        validation,
      };
    },
  };
}

function schemaToFields(schema) {
  if (!schema?.properties || typeof schema.properties !== "object") {
    return [];
  }
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  return Object.entries(schema.properties).map(([name, propertySchema]) => schemaToField(name, propertySchema, required.has(name)));
}

function schemaToField(name, schema, required) {
  const fieldType = Array.isArray(schema?.enum) ? "enum" : schema?.type ?? "string";
  return normalizeField({
    name,
    type: FIELD_TYPES.includes(fieldType) ? fieldType : "string",
    required,
    description: schema?.description ?? "",
    enumOptions: Array.isArray(schema?.enum) ? schema.enum : [],
    fields: schemaToFields(schema),
    item: schema?.type === "array" ? schemaToArrayItem(schema.items) : null,
  });
}

function schemaToArrayItem(schema) {
  if (Array.isArray(schema?.enum)) {
    return { type: "enum", enumOptions: [...schema.enum] };
  }
  return { type: FIELD_TYPES.includes(schema?.type) ? schema.type : "string" };
}

function normalizeField(field) {
  return {
    name: String(field?.name ?? ""),
    type: FIELD_TYPES.includes(field?.type) ? field.type : "string",
    required: Boolean(field?.required),
    description: String(field?.description ?? ""),
    enumOptions: Array.isArray(field?.enumOptions) ? field.enumOptions.map(String).filter(Boolean) : [],
    fields: Array.isArray(field?.fields) ? field.fields.map(normalizeField) : [],
    item: field?.type === "array" ? normalizeArrayItem(field.item) : null,
  };
}

function normalizeArrayItem(item) {
  return {
    type: FIELD_TYPES.includes(item?.type) && item.type !== "array" ? item.type : "string",
    enumOptions: Array.isArray(item?.enumOptions) ? item.enumOptions.map(String).filter(Boolean) : [],
  };
}

function fieldToSchema(field) {
  if (field.type === "enum") {
    return withDescription({ type: "string", enum: [...field.enumOptions] }, field.description);
  }
  if (field.type === "object") {
    const nested = createWorkflowV2SchemaBuilder({ type: "object", properties: {} });
    field.fields.forEach((child) => nested.addField(child));
    return withDescription(nested.toJsonSchema(), field.description);
  }
  if (field.type === "array") {
    return withDescription({ type: "array", items: arrayItemToSchema(field.item) }, field.description);
  }
  return withDescription({ type: field.type }, field.description);
}

function arrayItemToSchema(item) {
  if (item?.type === "enum") {
    return { type: "string", enum: [...item.enumOptions] };
  }
  return { type: item?.type ?? "string" };
}

function withDescription(schema, description) {
  return description ? { ...schema, description } : schema;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}
