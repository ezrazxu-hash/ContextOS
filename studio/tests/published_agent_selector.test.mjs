import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\tests$/, "");

function moduleUrl(relativePath) {
  return pathToFileURL(join(studioRoot, relativePath)).href;
}

test("TA0 published agent selector includes Legacy and published active versions only", async () => {
  const { fetchPublishedAgentOptions } = await import(moduleUrl("src/session/agentSelector.js"));
  const apiClient = {
    async listAgents() {
      return {
        agents: [
          {
            id: "research-agent",
            name: "Research Agent",
            active_version: { id: "research-agent_v1", version: 1, status: "published" },
          },
          {
            id: "draft-agent",
            name: "Draft Agent",
            active_version: { id: "draft-agent_draft", version: 0, status: "draft" },
          },
        ],
      };
    },
  };

  const options = await fetchPublishedAgentOptions(apiClient);

  assert.deepEqual(options, [
    { id: "legacy", label: "Legacy / Default", agentVersionId: null, agentTemplateId: null },
    { id: "research-agent_v1", label: "Research Agent v1", agentVersionId: "research-agent_v1", agentTemplateId: "research-agent" },
  ]);
});

test("TA1 new session payload binds selected published AgentVersion", async () => {
  const { createSessionWithSelectedAgent } = await import(moduleUrl("src/session/agentSelector.js"));
  const calls = [];
  const apiClient = {
    async createSession(payload) {
      calls.push(payload);
      return { id: "session-1", ...payload };
    },
  };

  const session = await createSessionWithSelectedAgent(apiClient, {
    workspaceId: "studio",
    title: "Project Chat",
    defaultAgentTemplateId: "research-agent",
    selectedAgent: {
      id: "research-agent_v1",
      agentTemplateId: "research-agent",
      agentVersionId: "research-agent_v1",
    },
  });

  assert.deepEqual(calls[0], {
    workspace_id: "studio",
    title: "Project Chat",
    agent_template_id: "research-agent",
    agent_version_id: "research-agent_v1",
  });
  assert.equal(session.agent_version_id, "research-agent_v1");
});

test("TA1 legacy new session keeps version binding empty", async () => {
  const { createSessionWithSelectedAgent } = await import(moduleUrl("src/session/agentSelector.js"));
  const calls = [];
  const apiClient = {
    async createSession(payload) {
      calls.push(payload);
      return { id: "session-legacy", ...payload, agent_version_id: null };
    },
  };

  await createSessionWithSelectedAgent(apiClient, {
    workspaceId: "studio",
    defaultAgentTemplateId: "research-agent",
    selectedAgent: { id: "legacy", agentTemplateId: null, agentVersionId: null },
  });

  assert.deepEqual(calls[0], {
    workspace_id: "studio",
    agent_template_id: "research-agent",
  });
});

test("TA2 session agent label resolves Legacy and published version names", async () => {
  const { sessionAgentLabel } = await import(moduleUrl("src/session/agentSelector.js"));
  const options = [
    { id: "legacy", label: "Legacy / Default", agentVersionId: null, agentTemplateId: null },
    { id: "research-agent_v2", label: "Research Agent v2", agentVersionId: "research-agent_v2", agentTemplateId: "research-agent" },
  ];

  assert.equal(sessionAgentLabel({ agent_version_id: null }, options), "Legacy / Default");
  assert.equal(sessionAgentLabel({ agent_version_id: "research-agent_v2" }, options), "Research Agent v2");
  assert.equal(sessionAgentLabel({ agent_version_id: "missing-version" }, options), "Agent missing-version");
});

test("TA3 switching an existing session sends selected version and returns server truth", async () => {
  const { switchSessionAgent } = await import(moduleUrl("src/session/agentSelector.js"));
  const calls = [];
  const apiClient = {
    async patchSessionAgent(sessionId, payload) {
      calls.push({ sessionId, payload });
      return { id: sessionId, agent_version_id: payload.agent_version_id };
    },
  };

  const session = await switchSessionAgent(apiClient, {
    sessionId: "session-1",
    selectedAgent: { id: "research-agent_v2", agentVersionId: "research-agent_v2" },
  });

  assert.deepEqual(calls[0], { sessionId: "session-1", payload: { agent_version_id: "research-agent_v2" } });
  assert.equal(session.agent_version_id, "research-agent_v2");
});

test("TA3 switching to Legacy clears version binding", async () => {
  const { switchSessionAgent } = await import(moduleUrl("src/session/agentSelector.js"));
  const calls = [];
  const apiClient = {
    async patchSessionAgent(sessionId, payload) {
      calls.push({ sessionId, payload });
      return { id: sessionId, agent_version_id: null };
    },
  };

  await switchSessionAgent(apiClient, {
    sessionId: "session-1",
    selectedAgent: { id: "legacy", agentVersionId: null },
  });

  assert.deepEqual(calls[0], { sessionId: "session-1", payload: { agent_version_id: null } });
});
