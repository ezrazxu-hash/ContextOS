export function createChatTimelineView(debugIndex, { developerMode = false } = {}) {
  const state = {
    selectedTimelineId: debugIndex.session?.current_timeline_id ?? debugIndex.timelines?.[0]?.id ?? null,
  };

  return {
    view() {
      return view(debugIndex, state.selectedTimelineId, developerMode);
    },
    selectTimeline(timelineId) {
      if (debugIndex.timelines.some((timeline) => timeline.id === timelineId)) {
        state.selectedTimelineId = timelineId;
      }
      return view(debugIndex, state.selectedTimelineId, developerMode);
    },
    navigateToForkSource(timelineId) {
      const timeline = findTimeline(debugIndex, timelineId);
      if (timeline?.parent_timeline_id) {
        state.selectedTimelineId = timeline.parent_timeline_id;
      }
      return view(debugIndex, state.selectedTimelineId, developerMode);
    },
  };
}

function view(debugIndex, selectedTimelineId, developerMode) {
  return {
    copy: {
      title: "Conversation Versions",
      continueLabel: "Continue from here",
    },
    selectedTimelineId,
    items: (debugIndex.timelines ?? []).map((timeline) => timelineItem(debugIndex, timeline, selectedTimelineId, developerMode)),
    binding: bindingFor(debugIndex, selectedTimelineId),
  };
}

function timelineItem(debugIndex, timeline, selectedTimelineId, developerMode) {
  const item = {
    id: timeline.id,
    label: timeline.parent_timeline_id ? "Conversation Version" : "Current Conversation",
    selected: timeline.id === selectedTimelineId,
    createdAt: timeline.created_at ?? null,
    status: timeline.status ?? "active",
    forkSource: timeline.parent_timeline_id
      ? {
          label: "Back to origin",
          timelineId: timeline.parent_timeline_id,
          checkpointId: timeline.fork_checkpoint_id ?? null,
          messageId: timeline.fork_message_id ?? null,
        }
      : null,
  };
  if (developerMode) {
    item.technical = { timelineId: timeline.id };
  }
  return item;
}

function bindingFor(debugIndex, timelineId) {
  const checkpointIds = new Set((debugIndex.checkpoints ?? []).filter((checkpoint) => checkpoint.timeline_id === timelineId).map((checkpoint) => checkpoint.id));
  const latestCheckpoint = [...(debugIndex.checkpoints ?? [])].reverse().find((checkpoint) => checkpoint.timeline_id === timelineId) ?? null;
  return {
    messages: (debugIndex.messages ?? []).filter((message) => checkpointIds.has(message.checkpoint_id)),
    contextRevision: latestCheckpoint?.context_revision ?? null,
    impactAnchorMessageId: null,
  };
}

function findTimeline(debugIndex, timelineId) {
  return (debugIndex.timelines ?? []).find((timeline) => timeline.id === timelineId) ?? null;
}
