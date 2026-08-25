const SUPPORTED_NODE_TYPES = new Set(["agent", "tool", "condition", "subgraph"]);

export function createXyflowSpike() {
  const nodes = [];
  const edges = [];

  return {
    addNode(node) {
      if (!SUPPORTED_NODE_TYPES.has(node.type)) {
        throw new Error(`unsupported spike node type: ${node.type}`);
      }
      nodes.push({ id: node.id, type: node.type, label: node.label });
    },
    connect(source, target) {
      edges.push({ id: `${source}->${target}`, source, target });
    },
    toViewModel() {
      return {
        provider: "xyflow-wrapper-spike",
        nodes: [...nodes],
        edges: [...edges],
        capabilities: {
          customNodes: true,
          customEdges: true,
          selection: true,
          minimap: true,
          subgraphContainer: true,
        },
      };
    },
  };
}
