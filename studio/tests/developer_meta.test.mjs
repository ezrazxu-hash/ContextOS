import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\tests$/, "");

function moduleUrl(relativePath) {
  return pathToFileURL(join(studioRoot, relativePath)).href;
}

test("developer meta is hidden in normal mode and visible in developer mode", async () => {
  const { createDeveloperMeta } = await import(moduleUrl("src/features/conversation/DeveloperMeta.js"));

  const message = {
    id: "message-1",
    checkpointId: "checkpoint-1",
    contextGroupIds: ["group-1"],
    traceId: "trace-1",
  };

  assert.deepEqual(createDeveloperMeta(message, { developerMode: false }), { visible: false, fields: [] });

  const visible = createDeveloperMeta(message, { developerMode: true });
  assert.equal(visible.visible, true);
  assert.deepEqual(visible.fields, [
    ["message_id", "message-1"],
    ["checkpoint_id", "checkpoint-1"],
    ["context_group_id", "group-1"],
    ["trace_id", "trace-1"],
  ]);
});

test("trace id click navigates to Debug filtered view", async () => {
  const { createDeveloperMeta } = await import(moduleUrl("src/features/conversation/DeveloperMeta.js"));

  const navigations = [];
  const meta = createDeveloperMeta(
    { id: "message-1", checkpoint_id: "checkpoint-1", context_group_ids: ["group-1"], trace_id: "trace-1" },
    { developerMode: true, navigate: (path, params) => navigations.push({ path, params }) },
  );

  meta.goToTrace();

  assert.deepEqual(navigations, [{ path: "/debug", params: { trace_id: "trace-1" } }]);
});
