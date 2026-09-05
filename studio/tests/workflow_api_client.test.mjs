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
  await api.createWorkflow({ id: "support-flow", name: "Support Flow" });
  await api.fetchWorkflow("support-flow");
  await api.saveWorkflowDraft("support-flow", { schemaVersion: 2, revision: 1 });
  await api.validateWorkflow("support-flow", { schemaVersion: 2 });
  await api.listWorkflowTools();
  await api.publishWorkflow("support-flow");
  await api.listWorkflowVersions("support-flow");
  await api.fetchWorkflowVersion("support-flow", 1);
  await api.startWorkflowRun("support-flow", { version: 1, input: { message: "hello" } });
  await api.fetchWorkflowRun("workflow_run_1");
  await api.listWorkflowRunArtifacts("workflow_run_1");
  await api.downloadWorkflowArtifactContent("artifact_1");
  await api.listAgents();
  await api.listTools();
  await api.saveAgentDraft("research-agent", { schema_version: "1.0" });
  await api.validateAgentDraft("research-agent", { schema_version: "1.0" });
  await api.previewAgentGraph("research-agent", { schema_version: "1.0" });
  await api.publishAgent("research-agent");
  await api.listAgentVersions("research-agent");
  await api.fetchAgentVersion("research-agent_v1");
  await api.startAgentTestRun("research-agent_v1", { input: "hello" });
  await api.fetchAgentTestRun("test_run_1");
  await api.createSessionForWorkflow({ agent_template_id: "research-agent", agent_version_id: "research-agent_v1", title: "Research Agent" });
  await api.renameTemplate("research-agent", "Renamed Workflow");
  await api.deleteTemplateNode("research-agent", "tool-1");
  await api.deleteTemplate("research-agent");
  await collect(api.streamAgentTestRunEvents("test_run_1"));

  assert.deepEqual(
    calls.map((call) => [call.method, call.path]),
    [
      ["GET", "/agents/research-agent/draft"],
      ["POST", "/workflows"],
      ["GET", "/workflows/support-flow"],
      ["PUT", "/workflows/support-flow/draft"],
      ["POST", "/workflows/support-flow/validate"],
      ["GET", "/workflow-tools"],
      ["POST", "/workflows/support-flow/publish"],
      ["GET", "/workflows/support-flow/versions"],
      ["GET", "/workflows/support-flow/versions/1"],
      ["POST", "/workflows/support-flow/runs"],
      ["GET", "/workflow-runs/workflow_run_1"],
      ["GET", "/workflow-runs/workflow_run_1/artifacts"],
      ["GET", "/workflow-artifacts/artifact_1/content"],
      ["GET", "/agents"],
      ["GET", "/tools"],
      ["PUT", "/agents/research-agent/draft"],
      ["POST", "/agents/research-agent/validate"],
      ["POST", "/agents/research-agent/graph-preview"],
      ["POST", "/agents/research-agent/publish"],
      ["GET", "/agents/research-agent/versions"],
      ["GET", "/agent-versions/research-agent_v1"],
      ["POST", "/agent-versions/research-agent_v1/test-runs"],
      ["GET", "/agent-test-runs/test_run_1"],
      ["POST", "/sessions"],
      ["PATCH", "/templates/research-agent"],
      ["DELETE", "/templates/research-agent/nodes/tool-1"],
      ["DELETE", "/templates/research-agent"],
      ["SSE", "/sse/agent-test-runs/test_run_1"],
    ],
  );
  assert.deepEqual(calls.find((call) => call.path === "/workflows").options.body, { id: "support-flow", name: "Support Flow" });
  assert.deepEqual(calls.find((call) => call.path === "/workflows/support-flow/draft").options.body, { schemaVersion: 2, revision: 1 });
  assert.deepEqual(calls.find((call) => call.path === "/workflows/support-flow/validate").options.body, { schemaVersion: 2 });
  assert.deepEqual(calls.find((call) => call.path === "/workflows/support-flow/runs").options.body, { version: 1, input: { message: "hello" } });
  assert.deepEqual(calls.find((call) => call.path === "/agents/research-agent/draft" && call.method === "PUT").options.body, { schema_version: "1.0" });
  assert.deepEqual(calls.find((call) => call.path === "/templates/research-agent" && call.method === "PATCH").options.body, { name: "Renamed Workflow" });
  assert.deepEqual(calls.find((call) => call.path === "/agent-versions/research-agent_v1/test-runs").options.body, { input: "hello" });
  assert.deepEqual(calls.find((call) => call.path === "/sessions").options.body, {
    agent_template_id: "research-agent",
    agent_version_id: "research-agent_v1",
    title: "Research Agent",
  });
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
