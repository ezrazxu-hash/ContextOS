export function createWorkflowApiClient(httpClient) {
  if (!httpClient?.request) {
    throw new Error("httpClient.request is required");
  }

  return {
    createWorkflow(payload, options = {}) {
      return httpClient.request("POST", "/workflows", { ...options, body: payload });
    },

    fetchWorkflow(workflowId, options = {}) {
      return httpClient.request("GET", `/workflows/${encodeURIComponent(workflowId)}`, options);
    },

    saveWorkflowDraft(workflowId, definition, options = {}) {
      return httpClient.request("PUT", `/workflows/${encodeURIComponent(workflowId)}/draft`, { ...options, body: definition });
    },

    validateWorkflow(workflowId, definition = {}, options = {}) {
      return httpClient.request("POST", `/workflows/${encodeURIComponent(workflowId)}/validate`, { ...options, body: definition });
    },

    listWorkflowTools(options = {}) {
      return httpClient.request("GET", "/workflow-tools", options);
    },

    publishWorkflow(workflowId, options = {}) {
      return httpClient.request("POST", `/workflows/${encodeURIComponent(workflowId)}/publish`, options);
    },

    listWorkflowVersions(workflowId, options = {}) {
      return httpClient.request("GET", `/workflows/${encodeURIComponent(workflowId)}/versions`, options);
    },

    fetchWorkflowVersion(workflowId, version, options = {}) {
      return httpClient.request("GET", `/workflows/${encodeURIComponent(workflowId)}/versions/${encodeURIComponent(version)}`, options);
    },

    startWorkflowRun(workflowId, payload, options = {}) {
      return httpClient.request("POST", `/workflows/${encodeURIComponent(workflowId)}/runs`, { ...options, body: payload });
    },

    fetchWorkflowRun(runId, options = {}) {
      return httpClient.request("GET", `/workflow-runs/${encodeURIComponent(runId)}`, options);
    },

    listWorkflowRunArtifacts(runId, options = {}) {
      return httpClient.request("GET", `/workflow-runs/${encodeURIComponent(runId)}/artifacts`, options);
    },

    downloadWorkflowArtifactContent(artifactId, options = {}) {
      const path = `/workflow-artifacts/${encodeURIComponent(artifactId)}/content`;
      if (httpClient.download) {
        return httpClient.download(path, options);
      }
      return httpClient.request("GET", path, options);
    },

    listAgents(options = {}) {
      return httpClient.request("GET", "/agents", options);
    },

    listTools(options = {}) {
      return httpClient.request("GET", "/tools", options);
    },

    fetchAgentDraft(agentId, options = {}) {
      return httpClient.request("GET", `/agents/${encodeURIComponent(agentId)}/draft`, options);
    },

    renameTemplate(templateId, name, options = {}) {
      return httpClient.request("PATCH", `/templates/${encodeURIComponent(templateId)}`, { ...options, body: { name } });
    },

    deleteTemplate(templateId, options = {}) {
      return httpClient.request("DELETE", `/templates/${encodeURIComponent(templateId)}`, options);
    },

    deleteTemplateNode(templateId, nodeId, options = {}) {
      return httpClient.request("DELETE", `/templates/${encodeURIComponent(templateId)}/nodes/${encodeURIComponent(nodeId)}`, options);
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

    createSessionForWorkflow(payload, options = {}) {
      return httpClient.request("POST", "/sessions", { ...options, body: payload });
    },

    streamAgentTestRunEvents(runId, options = {}) {
      if (!httpClient.streamSse) {
        throw new Error("httpClient.streamSse is required for agent test run events");
      }
      return httpClient.streamSse(`/sse/agent-test-runs/${encodeURIComponent(runId)}`, options);
    },
  };
}
