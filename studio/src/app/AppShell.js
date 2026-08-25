const appRoutes = new Map([
  ["/chat", "Chat"],
  ["/workflow", "Workflow"],
  ["/template", "Template"],
  ["/debug", "Debug"],
]);

const sessionScopedParams = ["timelineId", "messageId", "traceId", "contextGroupId", "checkpointId"];

export function createAppShell({ initialUrl = "/chat", navigate = () => {}, onSelectionChange = () => {} } = {}) {
  const state = {
    url: normalizeUrl(initialUrl),
    developerMode: false,
  };

  return {
    view() {
      return createView(state);
    },
    navigateTo(path) {
      const nextUrl = withPath(state.url, path);
      state.url = nextUrl;
      navigate(nextUrl, { replace: false });
      return createView(state);
    },
    selectTemplate(templateId) {
      state.url = withParams(state.url, { templateId });
      const view = createView(state);
      navigate(view.url, { replace: false });
      onSelectionChange(view.selection);
      return view;
    },
    selectSession(sessionId) {
      const cleared = Object.fromEntries(sessionScopedParams.map((key) => [key, null]));
      state.url = withParams(state.url, { ...cleared, sessionId });
      const view = createView(state);
      navigate(view.url, { replace: false });
      onSelectionChange(view.selection);
      return view;
    },
    setDeveloperMode(enabled) {
      state.developerMode = Boolean(enabled);
      return createView(state);
    },
  };
}

function createView(state) {
  const parsed = parseStudioUrl(state.url);
  return {
    url: serializeStudioUrl(parsed),
    reloadRequired: false,
    selection: parsed.selection,
    header: {
      brand: "ContextOS",
      currentTemplateId: parsed.selection.templateId,
      currentSessionId: parsed.selection.sessionId,
      pageTitle: appRoutes.get(parsed.path) ?? "Studio",
      developerMode: state.developerMode,
      actions: [
        { id: "help", label: "Help" },
        { id: "user", label: "User" },
      ],
    },
  };
}

function parseStudioUrl(url) {
  const parsed = new URL(url, "http://contextos.local");
  return {
    path: appRoutes.has(parsed.pathname) ? parsed.pathname : "/chat",
    selection: {
      templateId: parsed.searchParams.get("templateId"),
      sessionId: parsed.searchParams.get("sessionId"),
      timelineId: parsed.searchParams.get("timelineId"),
      messageId: parsed.searchParams.get("messageId"),
      traceId: parsed.searchParams.get("traceId"),
      contextGroupId: parsed.searchParams.get("contextGroupId"),
      checkpointId: parsed.searchParams.get("checkpointId"),
    },
  };
}

function serializeStudioUrl(parsed) {
  const search = new URLSearchParams();
  for (const key of ["templateId", "sessionId", "timelineId", "messageId", "traceId", "contextGroupId", "checkpointId"]) {
    const value = parsed.selection[key];
    if (value) {
      search.set(key, value);
    }
  }
  const query = search.toString();
  return query ? `${parsed.path}?${query}` : parsed.path;
}

function withParams(url, updates) {
  const parsed = parseStudioUrl(url);
  return serializeStudioUrl({
    path: parsed.path,
    selection: {
      ...parsed.selection,
      ...updates,
    },
  });
}

function withPath(url, path) {
  const parsed = parseStudioUrl(url);
  return serializeStudioUrl({
    path: appRoutes.has(path) ? path : parsed.path,
    selection: parsed.selection,
  });
}

function normalizeUrl(url) {
  return serializeStudioUrl(parseStudioUrl(url));
}
