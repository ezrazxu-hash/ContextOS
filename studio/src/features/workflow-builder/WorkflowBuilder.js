const V1_NODE_TYPES = [
  "agent",
  "llm",
  "prompt",
  "tool",
  "condition",
  "router",
  "subgraph",
  "human_approval",
  "context_operator",
  "memory",
  "output",
  "custom",
];

const BOUNDARY_NODES = new Set(["START", "END"]);

export function createWorkflowBuilder(apiClient = {}, initialManifest = null) {
  const state = initialManifest ? stateFromManifest(initialManifest) : emptyState();
  state.selectedNodeId = null;

  return {
    nodeLibrary() {
      return V1_NODE_TYPES.map((type) => ({ type }));
    },
    addNode(node) {
      if (!V1_NODE_TYPES.includes(node.type)) {
        throw new Error(`Unsupported V1 workflow node type: ${node.type}`);
      }
      state.nodes.push({
        id: node.id,
        type: node.type,
        config: { ...(node.config ?? {}) },
        ...(node.position ? { position: { ...node.position } } : {}),
        ...(node.extension ? { extension: node.extension } : {}),
      });
      return this.view();
    },
    updateNodeConfig(nodeId, patch) {
      const node = state.nodes.find((item) => item.id === nodeId);
      if (!node) {
        throw new Error(`Unknown workflow node: ${nodeId}`);
      }
      node.config = { ...(node.config ?? {}), ...patch };
      return this.view();
    },
    connect(source, target, condition = null) {
      state.edges.push(condition ? { from: source, to: target, condition } : { from: source, to: target });
      return this.view();
    },
    removeEdge(edgeToRemove) {
      state.edges = state.edges.filter((edge) => {
        return !(
          edge.from === edgeToRemove.from &&
          edge.to === edgeToRemove.to &&
          (edge.condition ?? null) === (edgeToRemove.condition ?? null)
        );
      });
      return this.view();
    },
    removeNode(nodeId) {
      state.nodes = state.nodes.filter((node) => node.id !== nodeId);
      state.edges = state.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId);
      if (state.selectedNodeId === nodeId) {
        state.selectedNodeId = null;
      }
      return this.view();
    },
    handleCanvasKey({ key, nodeId = null } = {}) {
      if (key === "Enter" && nodeId) {
        state.selectedNodeId = nodeId;
      }
      if ((key === "Delete" || key === "Backspace") && state.selectedNodeId) {
        return this.removeNode(state.selectedNodeId);
      }
      return this.view();
    },
    view() {
      return {
        nodes: state.nodes.map(cloneNode),
        edges: state.edges.map(cloneEdge),
        selectedNodeId: state.selectedNodeId,
        canvas: {
          role: "application",
          tabIndex: 0,
          ariaLabel: "Workflow canvas",
          keyboardShortcuts: {
            select: "Enter",
            delete: "Delete",
          },
        },
      };
    },
    validate() {
      return validateWorkflow(state);
    },
    serializeManifest(template = state.template) {
      state.template = template;
      return {
        template: { ...template },
        graph: {
          state_schema: "default_chat_state",
          nodes: state.nodes.map(cloneNode),
          edges: state.edges.map(cloneEdge),
        },
        context: {
          policy: "balanced",
          budget: { high_watermark: 0.8, target_watermark: 0.65 },
          restore: { mode: "auto", max_tokens_per_restore: 12000, max_restore_per_turn: 3 },
        },
        checkpoint: { enabled: true },
        ui: { editable_messages: true, expose_context_panel: true },
      };
    },
    async save(template = state.template) {
      const manifest = this.serializeManifest(template);
      if (apiClient.validateTemplate) {
        const validation = await apiClient.validateTemplate(manifest);
        if (!validation.valid) {
          return { status: "rejected", authority: "backend", error: validation.error };
        }
      }
      if (apiClient.saveTemplate) {
        await apiClient.saveTemplate(manifest);
      }
      return { status: "saved", manifest };
    },
    async open(templateId) {
      const response = await apiClient.fetchTemplate(templateId);
      const loaded = stateFromManifest(response.manifest);
      state.template = loaded.template;
      state.nodes = loaded.nodes;
      state.edges = loaded.edges;
      return this;
    },
  };
}

function emptyState() {
  return {
    template: { id: "workflow", name: "Workflow", version: "1.0.0" },
    nodes: [],
    edges: [],
    selectedNodeId: null,
  };
}

function stateFromManifest(manifest) {
  return {
    template: { ...manifest.template },
    nodes: manifest.graph.nodes.map(cloneNode),
    edges: manifest.graph.edges.map(cloneEdge),
    selectedNodeId: null,
  };
}

function validateWorkflow(state) {
  const nodeIds = new Set(state.nodes.map((node) => node.id));
  const issues = [];

  state.edges.forEach((edge, index) => {
    if (!BOUNDARY_NODES.has(edge.from) && !nodeIds.has(edge.from)) {
      issues.push({ fieldPath: `graph.edges[${index}].from`, code: "unknown_node" });
    }
    if (!BOUNDARY_NODES.has(edge.to) && !nodeIds.has(edge.to)) {
      issues.push({ fieldPath: `graph.edges[${index}].to`, code: "unknown_node" });
    }
  });

  return { valid: issues.length === 0, issues };
}

function cloneNode(node) {
  return {
    id: node.id,
    type: node.type,
    config: { ...(node.config ?? {}) },
    ...(node.position ? { position: { ...node.position } } : {}),
    ...(node.extension ? { extension: node.extension } : {}),
  };
}

function cloneEdge(edge) {
  return edge.condition ? { from: edge.from, to: edge.to, condition: edge.condition } : { from: edge.from, to: edge.to };
}
