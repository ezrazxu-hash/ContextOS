export function createContextTracePanel(debugIndex) {
  return {
    currentRevision: debugIndex.context?.revision ?? null,
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
