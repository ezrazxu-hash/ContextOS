import { existsSync, readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\tests$/, "");
const clientCoreRoot = join(studioRoot, "src/client-core");

function moduleUrl(relativePath) {
  return pathToFileURL(join(studioRoot, relativePath)).href;
}

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(fullPath) : [fullPath];
  });
}

test("UI10-T02-TC01: client-core modules run in pure Node without DOM globals", async () => {
  assert.ok(existsSync(clientCoreRoot), "missing reusable client-core boundary");
  const sourceFiles = listFiles(clientCoreRoot).filter((file) => file.endsWith(".js"));
  assert.ok(sourceFiles.length > 0, "expected client-core source files");

  for (const file of sourceFiles) {
    const source = readFileSync(file, "utf-8");
    assert.doesNotMatch(source, /\b(window|document|navigator|localStorage|sessionStorage|EventSource)\b/, file);
  }

  const core = await import(moduleUrl("src/client-core/index.js"));
  assert.deepEqual(core.queryKeys.messages("session-1", "timeline-1"), ["runtime", "messages", "session-1", "timeline-1"]);
  assert.deepEqual(core.normalizeRuntimeSnapshot({ session: { id: "session-1" } }), { session: { id: "session-1" } });
});

test("UI10-T02-TC02: SSE event normalization is shared and host independent", async () => {
  const { normalizeChatStreamEvent } = await import(moduleUrl("src/client-core/index.js"));

  assert.deepEqual(
    normalizeChatStreamEvent({ id: "event-1", event: "token", data: { message_id: "message-1", content: "Hello" } }),
    { id: "event-1", type: "token_delta", data: { message_id: "message-1", content: "Hello" } },
  );
  assert.deepEqual(
    normalizeChatStreamEvent({ id: "event-2", type: "tool_result", data: { call_id: "tool-1" } }),
    { id: "event-2", type: "tool_completed", data: { call_id: "tool-1" } },
  );
});

test("UI10-T02-TC03: web client and test host use the same client-core contract exports", async () => {
  const core = await import(moduleUrl("src/client-core/index.js"));
  const projectionCache = await import(moduleUrl("src/client/projectionCache.js"));
  const mockRuntime = await import(moduleUrl("src/test/msw/mockRuntime.js"));

  assert.equal(projectionCache.queryKeys, core.queryKeys);
  assert.equal(mockRuntime.runtimeApiContract, core.runtimeApiContract);
  assert.ok(core.runtimeApiContract.endpoints.includes("GET /api/sessions/{sessionId}/messages"));
  assert.ok(core.runtimeApiContract.events.includes("token"));
});
