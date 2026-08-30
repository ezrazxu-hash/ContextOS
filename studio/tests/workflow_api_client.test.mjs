import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\tests$/, "");

function moduleUrl(relativePath) {
  return pathToFileURL(join(studioRoot, relativePath)).href;
}

test("T70 Workflow API client maps agent draft validate publish version and test-run routes", async () => {
  const { createWorkflowApiClient } = await import(moduleUrl("src/api/agents.js"));
  const calls = [];
  const api = createWorkflowApiClient({
    request: async (method, path, options = {}) => {
      calls.push({ method, path, options });
      return { ok: true, method, path };
    },
    streamSse: async function* (path) {
      calls.push({ method: "SSE", path, options: {} });
      yield { type: "done", data: {} };
    },
  });

  await api.fetchAgentDraft("research-agent");
  await api.listAgents();
  await api.saveAgentDraft("research-agent", { schema_version: "1.0" });
  await api.validateAgentDraft("research-agent", { schema_version: "1.0" });
  await api.previewAgentGraph("research-agent", { schema_version: "1.0" });
  await api.publishAgent("research-agent");
  await api.listAgentVersions("research-agent");
  await api.fetchAgentVersion("research-agent_v1");
  await api.startAgentTestRun("research-agent_v1", { input: "hello" });
  await api.fetchAgentTestRun("test_run_1");
  await collect(api.streamAgentTestRunEvents("test_run_1"));

  assert.deepEqual(
    calls.map((call) => [call.method, call.path]),
    [
      ["GET", "/agents/research-agent/draft"],
      ["GET", "/agents"],
      ["PUT", "/agents/research-agent/draft"],
      ["POST", "/agents/research-agent/validate"],
      ["POST", "/agents/research-agent/graph-preview"],
      ["POST", "/agents/research-agent/publish"],
      ["GET", "/agents/research-agent/versions"],
      ["GET", "/agent-versions/research-agent_v1"],
      ["POST", "/agent-versions/research-agent_v1/test-runs"],
      ["GET", "/agent-test-runs/test_run_1"],
      ["SSE", "/sse/agent-test-runs/test_run_1"],
    ],
  );
  assert.deepEqual(calls[2].options.body, { schema_version: "1.0" });
  assert.deepEqual(calls.find((call) => call.path === "/agent-versions/research-agent_v1/test-runs").options.body, { input: "hello" });
});

async function collect(iterable) {
  const events = [];
  for await (const event of iterable) {
    events.push(event);
  }
  return events;
}

test("T70 Workflow API client preserves validation ClientError", async () => {
  const { ClientError } = await import(moduleUrl("src/client/http.js"));
  const { createWorkflowApiClient } = await import(moduleUrl("src/api/agents.js"));
  const api = createWorkflowApiClient({
    request: async () => {
      throw new ClientError({ code: "manifest.invalid", message: "invalid", status: 422 });
    },
  });

  await assert.rejects(
    () => api.validateAgentDraft("research-agent", {}),
    (error) => {
      assert.equal(error.code, "manifest.invalid");
      assert.equal(error.status, 422);
      return true;
    },
  );
});

test("T70 Workflow API client preserves network errors", async () => {
  const { createWorkflowApiClient } = await import(moduleUrl("src/api/agents.js"));
  const api = createWorkflowApiClient({
    request: async () => {
      throw new TypeError("fetch failed");
    },
  });

  await assert.rejects(() => api.fetchAgentDraft("research-agent"), /fetch failed/);
});
