const NODE_DEFINITIONS = [
  definition("START", "Start", []),
  definition("END", "End", []),
  definition("prompt", "PROMPT", ["role", "template", hiddenField("variables"), bindingField("input_mapping", "template_variables")]),
  definition("llm", "LLM", ["provider", "model", "max_tokens", "system_prompt", "prompt", "temperature", bindingField("input_mapping", "template_variables")]),
  definition("tool", "Tool", ["tool_name", bindingField("args", "tool_args")]),
  definition("condition", "Condition", [bindingField("source", "reference"), "operator", "value"]),
  definition("output", "Output", [bindingField("source", "reference")]),
];

export function createWorkflowNodeRegistry(definitions = NODE_DEFINITIONS) {
  const byType = new Map(definitions.map((item) => [item.type, item]));
  return {
    nodeTypes() {
      return definitions.map((item) => item.type);
    },
    get(type) {
      const definition = byType.get(type);
      if (!definition) {
        throw new Error(`Workflow node renderer is not registered: ${type}`);
      }
      return definition;
    },
  };
}

function definition(type, label, fields) {
  return {
    type,
    label,
    renderNode(node = {}) {
      return { type, label, id: node.id ?? type, config: { ...(node.config ?? {}) } };
    },
    renderConfig() {
      return {
        type,
        fields: fields.map(fieldView),
      };
    },
  };
}

function fieldView(field) {
  if (typeof field === "string") return { path: field, control: controlFor(field) };
  return { ...field, control: field.control ?? controlFor(field.path) };
}

function hiddenField(path) {
  return { path, control: "json", visibility: "hidden", editable: false };
}

function bindingField(path, binding) {
  return { path, control: "binding", binding };
}

function controlFor(path) {
  if (path === "temperature" || path === "max_tokens") return "number";
  if (path === "operator") return "select";
  if (path === "routes" || path === "variables") return "json";
  return "text";
}
