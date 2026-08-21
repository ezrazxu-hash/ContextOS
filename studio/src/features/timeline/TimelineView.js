export function createTimelineView(debugIndex, selectedTimelineId) {
  return {
    selectedTimelineId,
    items: (debugIndex.timelines ?? []).map((timeline) => ({
      ...timeline,
      selected: timeline.id === selectedTimelineId,
    })),
  };
}
