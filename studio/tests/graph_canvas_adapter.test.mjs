import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\tests$/, "");

function moduleUrl(relativePath) {
  return pathToFileURL(join(studioRoot, relativePath)).href;
}

test("T80 canvas adapter supports pan zoom fit and minimap", async () => {
  const { createGraphCanvasAdapter } = await import(moduleUrl("src/workflow/canvas/GraphCanvasAdapter.js"));
  const canvas = createGraphCanvasAdapter({
    width: 800,
    height: 600,
    nodes: [
      { id: "a", position: { x: 100, y: 120 } },
      { id: "b", position: { x: 500, y: 420 } },
    ],
  });

  canvas.panBy({ x: 10, y: -20 });
  canvas.zoomBy(0.25);
  const fit = canvas.fitView();
  const minimap = canvas.minimap();

  assert.deepEqual(canvas.viewport().pan, { x: 10, y: -20 });
  assert.equal(canvas.viewport().zoom, fit.zoom);
  assert.deepEqual(fit.bounds, { minX: 100, minY: 120, maxX: 500, maxY: 420 });
  assert.deepEqual(minimap.nodes.map((node) => node.id), ["a", "b"]);
});

test("T80 canvas adapter handles 100+ nodes without changing node order", async () => {
  const { createGraphCanvasAdapter } = await import(moduleUrl("src/workflow/canvas/GraphCanvasAdapter.js"));
  const nodes = Array.from({ length: 120 }, (_, index) => ({ id: `node-${index}`, position: { x: index * 12, y: index * 4 } }));

  const canvas = createGraphCanvasAdapter({ width: 1280, height: 720, nodes });
  const fit = canvas.fitView();

  assert.equal(canvas.minimap().nodes.length, 120);
  assert.equal(canvas.minimap().nodes[119].id, "node-119");
  assert.ok(fit.zoom > 0);
});
