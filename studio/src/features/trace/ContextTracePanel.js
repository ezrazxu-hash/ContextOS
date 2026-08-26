export function createContextTracePanel(debugIndex) {
  return {
    currentRevision: debugIndex.context?.revision ?? null,
    stats: contextStats(debugIndex.context?.items ?? debugIndex.context_items ?? []),
    operations: (debugIndex.traces?.items ?? []).filter(isContextEvent).map((event) => ({
      id: event.id,
      operation: event.step_type,
      groupId: event.context_group_id ?? null,
      contextRevision: event.context_revision ?? debugIndex.context?.revision ?? null,
      status: event.status,
    })),
  };
}

function isContextEvent(event) {
  return event.step_type?.startsWith("context_");
}

function contextStats(items) {
  return {
    raw: countState(items, "RAW"),
    abstract: countState(items, "ABSTRACT"),
    evicted: countState(items, "EVICTED"),
    pinned: items.filter((item) => Boolean(item.pinned)).length,
  };
}

function countState(items, state) {
  return items.filter((item) => item.state === state).length;
}
