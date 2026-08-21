export function createGraphView(debugIndex, selectedTimelineId) {
  return {
    selectedTimelineId,
    currentTimelineId: debugIndex.graph?.current_timeline_id ?? debugIndex.session?.current_timeline_id ?? null,
    timelineIds: (debugIndex.timelines ?? []).map((timeline) => timeline.id),
  };
}
