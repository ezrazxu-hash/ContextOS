const NODE_DEFINITIONS = [
  definition("START", "Start", []),
  definition("END", "End", []),
  definition("prompt", "PROMPT", ["role", "template", "variables", "input_mapping", "output_key"]),
  definition("llm", "LLM", ["provider", "model", "max_tokens", "system_prompt", "prompt", "temperature", "input_mapping", "output_key"]),
  definition("tool", "Tool", ["tool_name", "args", "output_key"]),
  definition("condition", "Condition", ["source", "operator", "value", "state_key"]),
  definition("output", "Output", ["source"]),
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
        fields: fields.map((path) => ({ path, control: controlFor(path) })),
      };
    },
  };
}

function controlFor(path) {
  if (path === "temperature" || path === "max_tokens") return "number";
  if (path === "operator") return "select";
  if (path === "input_mapping" || path === "args" || path === "routes" || path === "variables") return "json";
  return "text";
}
