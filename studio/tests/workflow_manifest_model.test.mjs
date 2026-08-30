import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\tests$/, "");

function moduleUrl(relativePath) {
  return pathToFileURL(join(studioRoot, relativePath)).href;
}

test("T71 nodes edges config position and viewport round-trip through runtime/ui manifest", async () => {
  const { deserializeGraph, serializeGraph } = await import(moduleUrl("src/workflow/manifest/model.js"));
  const graph = {
    template: { id: "research-agent", name: "Research Agent", version: "1.0.0" },
    nodes: [
      { id: "planner", type: "llm", config: { model: "default", output_key: "answer" }, position: { x: 100, y: 120 } },
      { id: "final", type: "output", config: { source: "$state.answer" }, position: { x: 420, y: 120 } },
    ],
    edges: [
      { id: "start-planner", source: "START", target: "planner" },
      { id: "planner-final", source: "planner", target: "final", route: "done" },
      { id: "final-end", source: "final", target: "END" },
    ],
    viewport: { x: 10, y: 20, zoom: 0.8 },
  };

  const manifest = serializeGraph(graph);
  const restored = deserializeGraph(manifest);

  assert.equal(manifest.schema_version, "1.0");
  assert.deepEqual(
    manifest.runtime.nodes.map((node) => node.position),
    [undefined, undefined],
  );
  assert.deepEqual(manifest.ui.nodes.planner.position, { x: 100, y: 120 });
  assert.deepEqual(restored, graph);
});

test("T71 legacy graph manifest can be deserialized without losing config", async () => {
  const { deserializeGraph } = await import(moduleUrl("src/workflow/manifest/model.js"));
  const restored = deserializeGraph({
    template: { id: "legacy", name: "Legacy", version: "1.0.0" },
    graph: {
      nodes: [{ id: "agent", type: "agent", config: { model: "default" }, position: { x: 1, y: 2 } }],
      edges: [{ from: "START", to: "agent" }],
    },
    ui: { editable_messages: true },
  });

  assert.deepEqual(restored.nodes[0], { id: "agent", type: "agent", config: { model: "default" }, position: { x: 1, y: 2 } });
  assert.deepEqual(restored.edges[0], { source: "START", target: "agent" });
});
