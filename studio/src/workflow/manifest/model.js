export function serializeGraph({ template, nodes, edges, viewport = {} }) {
  const runtimeNodes = nodes.map((node) => ({
    id: node.id,
    type: node.type,
    ...(node.name ? { name: node.name } : {}),
    config: clone(node.config ?? {}),
    ...(node.extension ? { extension: node.extension } : {}),
  }));
  const uiNodes = Object.fromEntries(nodes.map((node) => [node.id, { position: clone(node.position ?? { x: 0, y: 0 }) }]));

  return {
    schema_version: "1.0",
    template: clone(template),
    runtime: {
      state_schema: "default_chat_state",
      nodes: runtimeNodes,
      edges: edges.map(serializeEdge),
    },
    ui: {
      nodes: uiNodes,
      viewport: clone(viewport),
    },
  };
}

export function deserializeGraph(manifest) {
  if (manifest.runtime) {
    return {
      template: clone(manifest.template ?? { id: "", name: "", version: "" }),
      nodes: (manifest.runtime.nodes ?? []).map((node) => ({
        id: node.id,
        type: node.type,
        ...(node.name ? { name: node.name } : {}),
        config: clone(node.config ?? {}),
        ...uiNodeFields(manifest.ui?.nodes?.[node.id]),
        ...(node.extension ? { extension: node.extension } : {}),
        ...legacyUnsupportedFields(node.type),
      })),
      edges: (manifest.runtime.edges ?? []).map(deserializeRuntimeEdge),
      viewport: clone(manifest.ui?.viewport ?? {}),
    };
  }

  return {
    template: clone(manifest.template ?? { id: "", name: "", version: "" }),
      nodes: (manifest.graph?.nodes ?? []).map((node) => ({
        id: node.id,
        type: node.type,
        config: clone(node.config ?? {}),
        ...(node.position ? { position: clone(node.position) } : {}),
        ...(node.extension ? { extension: node.extension } : {}),
        ...legacyUnsupportedFields(node.type),
      })),
    edges: (manifest.graph?.edges ?? []).map((edge) => ({
      source: edge.source ?? edge.from,
      target: edge.target ?? edge.to,
      ...(edge.route ?? edge.condition ? { route: edge.route ?? edge.condition } : {}),
    })),
    viewport: {},
  };
}

function serializeEdge(edge) {
  return {
    ...(edge.id ? { id: edge.id } : {}),
    source: edge.source ?? edge.from,
    target: edge.target ?? edge.to,
    ...(edge.route ?? edge.condition ? { route: edge.route ?? edge.condition } : {}),
    ...(edge.source_handle ? { source_handle: edge.source_handle } : {}),
    ...(edge.target_handle ? { target_handle: edge.target_handle } : {}),
  };
}

function deserializeRuntimeEdge(edge) {
  return {
    ...(edge.id ? { id: edge.id } : {}),
    source: edge.source,
    target: edge.target,
    ...(edge.route ? { route: edge.route } : {}),
    ...(edge.source_handle ? { source_handle: edge.source_handle } : {}),
    ...(edge.target_handle ? { target_handle: edge.target_handle } : {}),
  };
}

function uiNodeFields(uiNode) {
  return uiNode?.position ? { position: clone(uiNode.position) } : {};
}

function legacyUnsupportedFields(type) {
  return ["agent", "router"].includes(type) ? { legacy: true, unsupported: true } : {};
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
