export function createWorkflowApiClient(httpClient) {
  if (!httpClient?.request) {
    throw new Error("httpClient.request is required");
  }

  return {
    listAgents(options = {}) {
      return httpClient.request("GET", "/agents", options);
    },

    fetchAgentDraft(agentId, options = {}) {
      return httpClient.request("GET", `/agents/${encodeURIComponent(agentId)}/draft`, options);
    },

    saveAgentDraft(agentId, manifest, options = {}) {
      return httpClient.request("PUT", `/agents/${encodeURIComponent(agentId)}/draft`, { ...options, body: manifest });
    },

    validateAgentDraft(agentId, manifest = {}, options = {}) {
      return httpClient.request("POST", `/agents/${encodeURIComponent(agentId)}/validate`, { ...options, body: manifest });
    },

    previewAgentGraph(agentId, manifest = {}, options = {}) {
      return httpClient.request("POST", `/agents/${encodeURIComponent(agentId)}/graph-preview`, { ...options, body: manifest });
    },

    publishAgent(agentId, options = {}) {
      return httpClient.request("POST", `/agents/${encodeURIComponent(agentId)}/publish`, options);
    },

    listAgentVersions(agentId, options = {}) {
      return httpClient.request("GET", `/agents/${encodeURIComponent(agentId)}/versions`, options);
    },

    fetchAgentVersion(agentVersionId, options = {}) {
      return httpClient.request("GET", `/agent-versions/${encodeURIComponent(agentVersionId)}`, options);
    },

    startAgentTestRun(agentVersionId, payload, options = {}) {
      return httpClient.request("POST", `/agent-versions/${encodeURIComponent(agentVersionId)}/test-runs`, { ...options, body: payload });
    },

    fetchAgentTestRun(runId, options = {}) {
      return httpClient.request("GET", `/agent-test-runs/${encodeURIComponent(runId)}`, options);
    },

    streamAgentTestRunEvents(runId, options = {}) {
      if (!httpClient.streamSse) {
        throw new Error("httpClient.streamSse is required for agent test run events");
      }
      return httpClient.streamSse(`/sse/agent-test-runs/${encodeURIComponent(runId)}`, options);
    },
  };
}
