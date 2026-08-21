import { createGraphView } from "../../features/trace/GraphView.js";
import { createStateInspector } from "../../features/trace/StateInspector.js";
import { createTimelineView } from "../../features/timeline/TimelineView.js";

export const DebugPage = {
  kind: "studio-page",
  name: "Debug",
};

export function createDebugPage(apiClient, sessionId, routeParams = {}) {
  const state = {
    index: null,
    selectedTimelineId: null,
    selectedCheckpointId: null,
    selectedTraceId: routeParams.trace_id ?? null,
  };

  return {
    async rehydrate() {
      state.index = await apiClient.fetchDebugIndex(sessionId, routeParams);
      applyInitialSelection(state);
      return view(state, createGraphView, createTimelineView, createStateInspector);
    },
    selectTimeline(timelineId) {
      state.selectedTimelineId = timelineId;
      state.selectedCheckpointId = firstCheckpointForTimeline(state.index, timelineId)?.id ?? null;
      return view(state, createGraphView, createTimelineView, createStateInspector);
    },
    selectCheckpoint(checkpointId) {
      const checkpoint = findCheckpoint(state.index, checkpointId);
      state.selectedCheckpointId = checkpoint?.id ?? null;
      state.selectedTimelineId = checkpoint?.timeline_id ?? state.selectedTimelineId;
      return view(state, createGraphView, createTimelineView, createStateInspector);
    },
  };
}

function applyInitialSelection(state) {
  const traceCheckpointId = checkpointIdForTrace(state.index, state.selectedTraceId);
  const traceCheckpoint = findCheckpoint(state.index, traceCheckpointId);
  const timelineId = traceCheckpoint?.timeline_id ?? state.index?.session?.current_timeline_id ?? firstTimeline(state.index)?.id ?? null;
  state.selectedTimelineId = timelineId;
  state.selectedCheckpointId = traceCheckpoint?.id ?? firstCheckpointForTimeline(state.index, timelineId)?.id ?? null;
}

function view(state, createGraphView, createTimelineView, createStateInspector) {
  const checkpoint = findCheckpoint(state.index, state.selectedCheckpointId);
  return {
    selectedTraceId: state.selectedTraceId,
    selectedCheckpointId: state.selectedCheckpointId,
    graph: createGraphView(state.index, state.selectedTimelineId),
    timeline: createTimelineView(state.index, state.selectedTimelineId),
    conversation: conversationForTimeline(state.index, state.selectedTimelineId),
    stateInspector: createStateInspector(checkpoint),
  };
}

function conversationForTimeline(debugIndex, timelineId) {
  const checkpointIds = new Set((debugIndex?.checkpoints ?? []).filter((checkpoint) => checkpoint.timeline_id === timelineId).map((checkpoint) => checkpoint.id));
  return (debugIndex?.messages ?? []).filter((message) => checkpointIds.has(message.checkpoint_id));
}

function checkpointIdForTrace(debugIndex, traceId) {
  if (!traceId) {
    return null;
  }
  return (debugIndex?.traces?.items ?? []).find((trace) => trace.trace_id === traceId)?.checkpoint_id ?? null;
}

function firstTimeline(debugIndex) {
  return (debugIndex?.timelines ?? [])[0] ?? null;
}

function firstCheckpointForTimeline(debugIndex, timelineId) {
  return (debugIndex?.checkpoints ?? []).find((checkpoint) => checkpoint.timeline_id === timelineId) ?? null;
}

function findCheckpoint(debugIndex, checkpointId) {
  return (debugIndex?.checkpoints ?? []).find((checkpoint) => checkpoint.id === checkpointId) ?? null;
}
