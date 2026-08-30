const NODE_DEFINITIONS = [
  definition("START", "Start", []),
  definition("END", "End", []),
  definition("llm", "LLM", ["model", "prompt_template", "input_mapping", "output_key"]),
  definition("agent", "Agent", ["model", "instruction", "input", "context_policy", "tools", "max_steps", "output_key"]),
  definition("tool", "Tool", ["tool_name", "args", "output_key"]),
  definition("condition", "Condition", ["source", "operator", "value", "state_key"]),
  definition("router", "Router", ["source", "routes", "default_route", "state_key"]),
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
  if (path === "tools") return "multi-select";
  if (path === "max_steps") return "number";
  if (path === "input_mapping" || path === "args" || path === "routes") return "json";
  return "text";
}
