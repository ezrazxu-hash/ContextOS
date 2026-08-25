export function createTimelineView(debugIndex, selectedTimelineId, options = {}) {
  const selectedCheckpointId = options.selectedCheckpointId ?? null;
  const filter = options.filter ?? {};
  const checkpoints = filteredCheckpoints(debugIndex, filter).map((checkpoint) => ({
    ...checkpoint,
    current: checkpoint.id === selectedCheckpointId,
    messageIds: messagesForCheckpoint(debugIndex, checkpoint.id).map((message) => message.id),
  }));
  return {
    selectedTimelineId,
    tree: (debugIndex.timelines ?? []).map((timeline) => ({
      ...timeline,
      forkCheckpointId: timeline.fork_checkpoint_id ?? firstCheckpointForTimeline(debugIndex, timeline.parent_timeline_id)?.id ?? null,
      current: timeline.id === selectedTimelineId,
      selected: timeline.id === selectedTimelineId,
    })),
    items: (debugIndex.timelines ?? []).map((timeline) => ({
      ...timeline,
      selected: timeline.id === selectedTimelineId,
    })),
    checkpoints,
    miniMap: {
      enabled: (debugIndex.checkpoints ?? []).length > 100 || Boolean(options.fit),
      totalCheckpoints: (debugIndex.checkpoints ?? []).length,
      mode: options.fit ? "fit" : "auto",
    },
  };
}

function filteredCheckpoints(debugIndex, filter) {
  const checkpointQuery = String(filter.checkpoint ?? "").trim().toLowerCase();
  const messageQuery = String(filter.message ?? "").trim().toLowerCase();
  return (debugIndex.checkpoints ?? []).filter((checkpoint) => {
    const checkpointMatches = !checkpointQuery || checkpoint.id.toLowerCase().includes(checkpointQuery);
    const messageMatches =
      !messageQuery ||
      messagesForCheckpoint(debugIndex, checkpoint.id).some((message) => {
        return `${message.id} ${message.content ?? ""}`.toLowerCase().includes(messageQuery);
      });
    return checkpointMatches && messageMatches;
  });
}

function messagesForCheckpoint(debugIndex, checkpointId) {
  return (debugIndex.messages ?? []).filter((message) => message.checkpoint_id === checkpointId);
}

function firstCheckpointForTimeline(debugIndex, timelineId) {
  if (!timelineId) {
    return null;
  }
  return (debugIndex.checkpoints ?? []).find((checkpoint) => checkpoint.timeline_id === timelineId) ?? null;
}
