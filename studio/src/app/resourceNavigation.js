export function createResourceNavigation({ resources = {}, openUrl = () => {} } = {}) {
  const state = {
    resources: normalizeResources(resources),
    sessionQuery: "",
    selectedSessionId: null,
    selectedTimelineId: null,
  };

  return {
    view() {
      return createView(state);
    },
    searchSessions(query) {
      state.sessionQuery = String(query ?? "");
      return createView(state);
    },
    selectTimeline(timelineId) {
      const timeline = state.resources.timelines.find((item) => item.id === timelineId);
      if (!timeline) {
        return createView(state);
      }
      state.selectedTimelineId = timeline.id;
      state.selectedSessionId = timeline.session_id;
      openUrl(`/chat?sessionId=${encodeURIComponent(timeline.session_id)}&timelineId=${encodeURIComponent(timeline.id)}`);
      return createView(state);
    },
  };
}

function createView(state) {
  const sessions = filterSessions(state.resources.sessions, state.sessionQuery);
  return {
    sessions,
    templates: state.resources.templates.map(toTemplateItem),
    timelines: state.resources.timelines.map(toTimelineItem),
    selectedSessionId: state.selectedSessionId,
    selectedTimelineId: state.selectedTimelineId,
    emptyState: isEmpty(sessions, state.resources.templates, state.resources.timelines)
      ? {
          kind: "empty",
          title: "No resources yet",
          action: { id: "create-session", label: "New Session" },
        }
      : null,
  };
}

function normalizeResources(resources) {
  return {
    sessions: [...(resources.sessions ?? [])],
    templates: [...(resources.templates ?? [])],
    timelines: [...(resources.timelines ?? [])],
  };
}

function filterSessions(sessions, query) {
  const normalizedQuery = query.trim().toLowerCase();
  const visible = normalizedQuery
    ? sessions.filter((session) => `${session.title ?? ""} ${session.id}`.toLowerCase().includes(normalizedQuery))
    : sessions;
  return visible.map(toSessionItem);
}

function toSessionItem(session) {
  return {
    id: session.id,
    title: session.title ?? session.id,
    agentTemplateId: session.agent_template_id ?? null,
    status: session.status ?? "unknown",
  };
}

function toTemplateItem(template) {
  return {
    id: template.id,
    name: template.name ?? template.id,
    version: template.version ?? null,
    status: template.status ?? "unknown",
  };
}

function toTimelineItem(timeline) {
  return {
    id: timeline.id,
    sessionId: timeline.session_id,
    status: timeline.status ?? "unknown",
    createdAt: timeline.created_at ?? null,
  };
}

function isEmpty(sessions, templates, timelines) {
  return sessions.length === 0 && templates.length === 0 && timelines.length === 0;
}
