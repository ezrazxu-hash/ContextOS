const V2_NODE_TYPES = ["agent", "condition", "workflow", "end"];

export function createWorkflowV2Builder(initialDefinition = null) {
  const state = {
    nodes: Array.isArray(initialDefinition?.nodes) ? initialDefinition.nodes.map(cloneNode) : [],
    edges: Array.isArray(initialDefinition?.edges) ? initialDefinition.edges.map(cloneEdge) : [],
  };

  return {
    nodeLibrary() {
      return V2_NODE_TYPES.map((type) => ({ type }));
    },
    addNode(node) {
      if (!V2_NODE_TYPES.includes(node.type)) {
        throw new Error(`Unsupported V2 workflow node type: ${node.type}`);
      }
      state.nodes.push({
        id: node.id,
        type: node.type,
        config: { ...(node.config ?? {}) },
        ...(node.position ? { position: { ...node.position } } : {}),
      });
      return this.view();
    },
    updateNodePosition(nodeId, position) {
      const node = state.nodes.find((item) => item.id === nodeId);
      if (!node) {
        throw new Error(`Unknown workflow node: ${nodeId}`);
      }
      node.position = { x: position.x, y: position.y };
      return this.view();
    },
    updateAgentNodeConfig(nodeId, patch) {
      const node = state.nodes.find((item) => item.id === nodeId);
      if (!node) {
        throw new Error(`Unknown workflow node: ${nodeId}`);
      }
      if (node.type !== "agent") {
        throw new Error(`Workflow node is not an Agent node: ${nodeId}`);
      }
      node.config = normalizeAgentConfig({ ...(node.config ?? {}), ...deepClone(patch) });
      return this.view();
    },
    updateConditionNodeConfig(nodeId, patch) {
      const node = state.nodes.find((item) => item.id === nodeId);
      if (!node) {
        throw new Error(`Unknown workflow node: ${nodeId}`);
      }
      if (node.type !== "condition") {
        throw new Error(`Workflow node is not a Condition node: ${nodeId}`);
      }
      node.config = { ...(node.config ?? {}), ...deepClone(patch) };
      return this.view();
    },
    updateEndNodeConfig(nodeId, patch) {
      const node = state.nodes.find((item) => item.id === nodeId);
      if (!node) {
        throw new Error(`Unknown workflow node: ${nodeId}`);
      }
      if (node.type !== "end") {
        throw new Error(`Workflow node is not an End node: ${nodeId}`);
      }
      node.config = { ...(node.config ?? {}), ...deepClone(patch) };
      return this.view();
    },
    connect(source, target, options = {}) {
      const issue = validateConnection(state, source, target);
      if (issue) {
        throw new Error(issue.message);
      }
      state.edges.push({
        source,
        target,
        ...(options.sourceHandle ? { sourceHandle: options.sourceHandle } : {}),
      });
      return this.view();
    },
    removeNode(nodeId) {
      state.nodes = state.nodes.filter((node) => node.id !== nodeId);
      state.edges = state.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId);
      return this.view();
    },
    validateConnection(source, target) {
      return validateConnection(state, source, target);
    },
    validate() {
      const errors = [];
      state.edges.forEach((edge, index) => {
        const issue = validateConnection(state, edge.source, edge.target);
        if (issue) {
          errors.push({ ...issue, field: `edges[${index}]` });
        }
      });
      if (!state.nodes.some((node) => node.type === "end")) {
        errors.push({ code: "missing_end_node", field: "nodes", message: "At least one End node is required" });
      }
      return { valid: errors.length === 0, errors };
    },
    view() {
      return {
        schemaVersion: 2,
        nodes: state.nodes.map(cloneNode),
        edges: state.edges.map(cloneEdge),
      };
    },
  };
}

function validateConnection(state, source, target) {
  const sourceNode = state.nodes.find((node) => node.id === source);
  const targetNode = state.nodes.find((node) => node.id === target);
  const validSources = new Set(["START", ...state.nodes.map((node) => node.id)]);
  const validTargets = new Set(["END", ...state.nodes.map((node) => node.id)]);
  if (target === "START") {
    return { code: "start_has_incoming_edge", message: "START cannot have incoming edges" };
  }
  if (!validSources.has(source) || !validTargets.has(target)) {
    return { code: "unknown_node", message: "Edge endpoints must reference existing workflow nodes" };
  }
  if (source === target) {
    return { code: "self_connection", message: "Workflow node cannot connect to itself" };
  }
  if (sourceNode?.type === "end") {
    return { code: "end_has_outgoing_edge", message: "End nodes cannot have outgoing edges" };
  }
  if (target !== "END" && !targetNode) {
    return { code: "unknown_node", message: "Edge endpoints must reference existing workflow nodes" };
  }
  return null;
}

function cloneNode(node) {
  return {
    id: node.id,
    type: node.type,
    config: deepClone(node.config ?? {}),
    ...(node.position ? { position: { ...node.position } } : {}),
  };
}

function cloneEdge(edge) {
  return { ...edge };
}

function normalizeAgentConfig(config) {
  const normalized = { ...config };
  if (!Object.prototype.hasOwnProperty.call(normalized, "outputSchema")) {
    normalized.outputSchema = null;
  }
  if (!Object.prototype.hasOwnProperty.call(normalized, "toolPolicy")) {
    normalized.toolPolicy = { mode: "disabled" };
  }
  return normalized;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}
