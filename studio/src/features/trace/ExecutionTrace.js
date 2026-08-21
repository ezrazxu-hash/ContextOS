export function createExecutionTrace(debugIndex) {
  return {
    items: (debugIndex.traces?.items ?? []).map((event) => ({
      id: event.id,
      traceId: event.trace_id,
      stepType: event.step_type,
      component: event.component,
      inputSummary: event.input_summary,
      outputSummary: event.output_summary,
      duration: event.duration,
      status: event.status,
      rawLoaded: false,
    })),
    loadRaw(eventId, rawLoader) {
      return rawLoader(eventId);
    },
  };
}
