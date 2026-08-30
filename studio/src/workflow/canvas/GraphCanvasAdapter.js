const DEFAULT_VIEWPORT = {
  pan: { x: 0, y: 0 },
  zoom: 1,
};

export function createGraphCanvasAdapter({ width = 0, height = 0, nodes = [], viewport = DEFAULT_VIEWPORT } = {}) {
  const state = {
    width: Number(width),
    height: Number(height),
    nodes: nodes.map(cloneNode),
    viewport: normalizeViewport(viewport),
  };

  function viewportSnapshot() {
    return {
      pan: { ...state.viewport.pan },
      zoom: state.viewport.zoom,
    };
  }

  return {
    panBy(delta = {}) {
      state.viewport.pan = {
        x: state.viewport.pan.x + Number(delta.x ?? 0),
        y: state.viewport.pan.y + Number(delta.y ?? 0),
      };
      return viewportSnapshot();
    },

    zoomBy(delta = 0, limits = {}) {
      const min = Number(limits.min ?? 0.25);
      const max = Number(limits.max ?? 2);
      state.viewport.zoom = clamp(state.viewport.zoom + Number(delta), min, max);
      return viewportSnapshot();
    },

    fitView(options = {}) {
      const padding = Number(options.padding ?? 48);
      const bounds = boundsFor(state.nodes);
      const usableWidth = Math.max(1, state.width - padding * 2);
      const usableHeight = Math.max(1, state.height - padding * 2);
      const contentWidth = Math.max(1, bounds.maxX - bounds.minX);
      const contentHeight = Math.max(1, bounds.maxY - bounds.minY);
      const zoom = Math.min(1, usableWidth / contentWidth, usableHeight / contentHeight);

      state.viewport.zoom = zoom;

      return {
        viewport: viewportSnapshot(),
        bounds,
        zoom,
      };
    },

    minimap() {
      return {
        bounds: boundsFor(state.nodes),
        nodes: state.nodes.map(cloneNode),
      };
    },

    viewport() {
      return viewportSnapshot();
    },
  };
}

function normalizeViewport(viewport = DEFAULT_VIEWPORT) {
  return {
    pan: {
      x: Number(viewport.pan?.x ?? 0),
      y: Number(viewport.pan?.y ?? 0),
    },
    zoom: Number(viewport.zoom ?? 1),
  };
}

function cloneNode(node) {
  return {
    ...node,
    position: {
      x: Number(node.position?.x ?? 0),
      y: Number(node.position?.y ?? 0),
    },
  };
}

function boundsFor(nodes) {
  if (nodes.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  return nodes.reduce(
    (bounds, node) => ({
      minX: Math.min(bounds.minX, node.position.x),
      minY: Math.min(bounds.minY, node.position.y),
      maxX: Math.max(bounds.maxX, node.position.x),
      maxY: Math.max(bounds.maxY, node.position.y),
    }),
    {
      minX: nodes[0].position.x,
      minY: nodes[0].position.y,
      maxX: nodes[0].position.x,
      maxY: nodes[0].position.y,
    },
  );
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
