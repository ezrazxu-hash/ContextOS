const LEGACY_AGENT_OPTION = {
  id: "legacy",
  label: "Legacy / Default",
  agentVersionId: null,
  agentTemplateId: null,
};

export async function fetchPublishedAgentOptions(apiClient) {
  if (!apiClient?.listAgents) {
    throw new Error("apiClient.listAgents is required");
  }

  const response = await apiClient.listAgents();
  const published = (response.agents ?? [])
    .filter((agent) => agent.active_version?.status === "published")
    .map((agent) => ({
      id: agent.active_version.id,
      label: `${agent.name ?? agent.id} v${agent.active_version.version}`,
      agentVersionId: agent.active_version.id,
      agentTemplateId: agent.id,
    }));

  return [LEGACY_AGENT_OPTION, ...published];
}

export async function createSessionWithSelectedAgent(
  apiClient,
  { workspaceId, title, defaultAgentTemplateId, selectedAgent } = {},
) {
  if (!apiClient?.createSession) {
    throw new Error("apiClient.createSession is required");
  }
  const agentTemplateId = selectedAgent?.agentTemplateId ?? defaultAgentTemplateId;
  const payload = {
    ...(workspaceId ? { workspace_id: workspaceId } : {}),
    ...(title ? { title } : {}),
    agent_template_id: agentTemplateId,
    ...(selectedAgent?.agentVersionId ? { agent_version_id: selectedAgent.agentVersionId } : {}),
  };
  return apiClient.createSession(payload);
}

export function sessionAgentLabel(session, options = []) {
  const agentVersionId = session?.agent_version_id ?? session?.agentVersionId ?? null;
  if (!agentVersionId) {
    return LEGACY_AGENT_OPTION.label;
  }
  const option = options.find((item) => item.agentVersionId === agentVersionId || item.id === agentVersionId);
  return option?.label ?? `Agent ${agentVersionId}`;
}

export async function switchSessionAgent(apiClient, { sessionId, selectedAgent } = {}) {
  if (!apiClient?.patchSessionAgent) {
    throw new Error("apiClient.patchSessionAgent is required");
  }
  return apiClient.patchSessionAgent(sessionId, {
    agent_version_id: selectedAgent?.agentVersionId ?? null,
  });
}
