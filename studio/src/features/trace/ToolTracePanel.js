export function createToolTracePanel(debugIndex) {
  return {
    runs: (debugIndex.traces?.items ?? []).filter(isToolEvent).map((event) => ({
      id: event.id,
      component: event.component,
      duration: event.duration,
      status: event.status,
    })),
  };
}

function isToolEvent(event) {
  return event.step_type === "tool_call" || event.step_type === "tool_result";
}
