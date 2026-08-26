import { createGraphView } from "../../features/trace/GraphView.js";
import { createStateInspector } from "../../features/trace/StateInspector.js";
import { createToolTracePanel } from "../../features/trace/ToolTracePanel.js";
import { createContextTracePanel } from "../../features/trace/ContextTracePanel.js";
import { createPromptInputsPanel } from "../../features/trace/PromptInputsPanel.js";
import { createTimelineView } from "../../features/timeline/TimelineView.js";
import { createWorkbenchLayout } from "../../design-system/layout/workbenchLayout.js";

const FALLBACK_PLATFORM = {
  readUiState() {
    return null;
  },
  writeUiState() {},
};

export const DebugPage = {
  kind: "studio-page",
  name: "Debug",
};

export function createDebugPage(apiClient, sessionId, routeParams = {}, options = {}) {
  const layout = createWorkbenchLayout(options.platform ?? FALLBACK_PLATFORM, {
    layoutId: "debug",
    viewportWidth: options.viewportWidth ?? 1280,
  });
  const state = {
    index: null,
    sessionId,
    selectedTimelineId: null,
    selectedCheckpointId: null,
    selectedTraceId: routeParams.trace_id ?? null,
    selectedMessageId: routeParams.message_id ?? null,
    selectedToolId: null,
    selectedContextId: null,
    selectionRelation: "direct",
    selectionHistory: [],
    selectionCursor: -1,
    traceHeight: 280,
    timelineFilter: {},
    timelineFit: false,
  };

  return {
    async rehydrate() {
      await refreshDebugIndex(state, apiClient, routeParams);
      applyInitialSelection(state);
      rememberSelection(state);
      return view(state, layout, createGraphView, createTimelineView, createStateInspector);
    },
    async pauseRuntime() {
      if (!hasRuntimeCapability(state, "pause")) {
        return { status: "unsupported", reason: "pause is not supported by this runtime" };
      }
      await apiClient.pauseRuntime?.(sessionId);
      await refreshDebugIndex(state, apiClient, routeParams);
      return view(state, layout, createGraphView, createTimelineView, createStateInspector);
    },
    async stopRuntime({ confirmed = false } = {}) {
      if (!hasRuntimeCapability(state, "stop")) {
        return { status: "unsupported", reason: "stop is not supported by this runtime" };
      }
      if (!confirmed) {
        return { status: "confirmation_required", action: "stop" };
      }
      await apiClient.stopRuntime?.(sessionId);
      await refreshDebugIndex(state, apiClient, routeParams);
      applyInitialSelection(state);
      return view(state, layout, createGraphView, createTimelineView, createStateInspector);
    },
    async refreshRuntime() {
      await refreshDebugIndex(state, apiClient, routeParams);
      applyInitialSelection(state);
      return view(state, layout, createGraphView, createTimelineView, createStateInspector);
    },
    selectTimeline(timelineId) {
      state.selectedTimelineId = timelineId;
      state.selectedCheckpointId = firstCheckpointForTimeline(state.index, timelineId)?.id ?? null;
      state.selectedMessageId = selectedMessageIdForCheckpoint(conversationForTimeline(state.index, timelineId), state.selectedCheckpointId);
      state.selectedTraceId = traceIdForMessage(state.index, state.selectedMessageId);
      state.selectedToolId = null;
      state.selectedContextId = null;
      state.selectionRelation = state.selectedMessageId ? "direct" : "none";
      rememberSelection(state);
      return view(state, layout, createGraphView, createTimelineView, createStateInspector);
    },
    selectCheckpoint(checkpointId) {
      const checkpoint = findCheckpoint(state.index, checkpointId);
      state.selectedCheckpointId = checkpoint?.id ?? null;
      state.selectedTimelineId = checkpoint?.timeline_id ?? state.selectedTimelineId;
      state.selectedMessageId = selectedMessageIdForCheckpoint(conversationForTimeline(state.index, state.selectedTimelineId), state.selectedCheckpointId);
      state.selectedTraceId = traceIdForMessage(state.index, state.selectedMessageId);
      state.selectedToolId = null;
      state.selectedContextId = null;
      state.selectionRelation = state.selectedMessageId ? "direct" : "none";
      rememberSelection(state);
      return view(state, layout, createGraphView, createTimelineView, createStateInspector);
    },
    selectMessage(messageId) {
      applyMessageSelection(state, messageId);
      rememberSelection(state);
      return view(state, layout, createGraphView, createTimelineView, createStateInspector);
    },
    selectTrace(traceId) {
      applyTraceSelection(state, traceId);
      rememberSelection(state);
      return view(state, layout, createGraphView, createTimelineView, createStateInspector);
    },
    selectTool(toolId) {
      const trace = findTraceForTool(state.index, toolId);
      if (trace) {
        applyTraceSelection(state, trace.trace_id);
      } else {
        state.selectedToolId = toolId;
        state.selectedTraceId = null;
        state.selectedMessageId = null;
        state.selectionRelation = "none";
      }
      rememberSelection(state);
      return view(state, layout, createGraphView, createTimelineView, createStateInspector);
    },
    selectContext(contextId) {
      const trace = findTraceForContext(state.index, contextId);
      if (trace) {
        applyTraceSelection(state, trace.trace_id);
      } else {
        state.selectedContextId = contextId;
        state.selectedTraceId = null;
        state.selectedMessageId = null;
        state.selectionRelation = "none";
      }
      rememberSelection(state);
      return view(state, layout, createGraphView, createTimelineView, createStateInspector);
    },
    backSelection() {
      if (state.selectionCursor > 0) {
        state.selectionCursor -= 1;
        restoreSelection(state, state.selectionHistory[state.selectionCursor]);
      }
      return view(state, layout, createGraphView, createTimelineView, createStateInspector);
    },
    resizePanel(panel, size) {
      layout.resizePanel(panel, size);
      return view(state, layout, createGraphView, createTimelineView, createStateInspector);
    },
    resizeTracePanel(height) {
      layout.resizePanel("bottom", height);
      state.traceHeight = layout.view().panels.bottom.height;
      return view(state, layout, createGraphView, createTimelineView, createStateInspector);
    },
    filterTimeline(filter) {
      state.timelineFilter = { ...filter };
      return view(state, layout, createGraphView, createTimelineView, createStateInspector);
    },
    fitTimeline() {
      state.timelineFit = true;
      return view(state, layout, createGraphView, createTimelineView, createStateInspector);
    },
  };
}

function applyInitialSelection(state) {
  const traceCheckpointId = checkpointIdForTrace(state.index, state.selectedTraceId);
  const traceCheckpoint = findCheckpoint(state.index, traceCheckpointId);
  const messageCheckpoint = findMessage(state.index, state.selectedMessageId)?.checkpoint_id ?? null;
  const messageCheckpointRecord = findCheckpoint(state.index, messageCheckpoint);
  const timelineId = traceCheckpoint?.timeline_id ?? messageCheckpointRecord?.timeline_id ?? state.index?.session?.current_timeline_id ?? firstTimeline(state.index)?.id ?? null;
  state.selectedTimelineId = timelineId;
  state.selectedCheckpointId = traceCheckpoint?.id ?? messageCheckpointRecord?.id ?? firstCheckpointForTimeline(state.index, timelineId)?.id ?? null;
  state.selectedMessageId = messageIdForTrace(state.index, state.selectedTraceId) ?? state.selectedMessageId ?? selectedMessageIdForCheckpoint(conversationForTimeline(state.index, timelineId), state.selectedCheckpointId);
  state.selectedTraceId = state.selectedTraceId ?? traceIdForMessage(state.index, state.selectedMessageId);
  const trace = findTrace(state.index, state.selectedTraceId);
  state.selectedToolId = trace?.tool_result_id ?? trace?.tool_call_id ?? null;
  state.selectedContextId = trace?.context_group_id ?? trace?.context_revision ?? null;
  state.selectionRelation = state.selectedMessageId || state.selectedTraceId ? "direct" : "none";
}

function view(state, layout, createGraphView, createTimelineView, createStateInspector) {
  const layoutView = layout.view();
  const checkpoint = findCheckpoint(state.index, state.selectedCheckpointId);
  const conversation = conversationForTimeline(state.index, state.selectedTimelineId).map((message) => ({
    ...message,
    selected: message.id === state.selectedMessageId,
  }));
  const filteredTraceIds = state.selectedTraceId ? [state.selectedTraceId] : [];
  return {
    kind: "debug-workbench",
    selectedTraceId: state.selectedTraceId,
    selectedTimelineId: state.selectedTimelineId,
    selectedCheckpointId: state.selectedCheckpointId,
    selectedMessageId: state.selectedMessageId,
    runtimeControls: createRuntimeControls(state.index),
    debugSelection: createDebugSelection(state),
    urlSelection: createUrlSelection(state),
    selectionNotice: state.selectionRelation === "none" ? "无直接关联" : null,
    columns: [
      { id: "timeline", role: "navigation", width: layoutView.panels.left.width },
      {
        id: "conversation-trace",
        role: "main",
        width: layoutView.panels.main.width,
        minWidth: layoutView.panels.main.minWidth,
      },
      {
        id: "inspector",
        role: "complementary",
        width: layoutView.panels.right.width,
        mode: layoutView.panels.right.mode,
      },
    ],
    tracePanel: {
      height: state.traceHeight,
      tableWidth: layoutView.panels.main.width,
      resizable: true,
      filteredTraceIds,
    },
    graph: createGraphView(state.index, state.selectedTimelineId),
    timeline: createTimelineView(state.index, state.selectedTimelineId, {
      selectedCheckpointId: state.selectedCheckpointId,
      filter: state.timelineFilter,
      fit: state.timelineFit,
    }),
    conversation,
    stateInspector: createStateInspector(checkpoint),
    inspectorStack: createInspectorStack(state.index, checkpoint),
  };
}

function createInspectorStack(debugIndex, checkpoint) {
  return {
    kind: "inspector-stack",
    sections: {
      state: createStateInspector(checkpoint),
      tool: createToolTracePanel(debugIndex),
      context: createContextTracePanel(debugIndex),
      prompt: createPromptInputsPanel(debugIndex),
    },
  };
}

async function refreshDebugIndex(state, apiClient, routeParams) {
  state.index = await apiClient.fetchDebugIndex(state.sessionId, routeParams);
}

function createRuntimeControls(debugIndex) {
  const runtime = debugIndex?.runtime ?? {};
  const capabilities = new Set(runtime.capabilities ?? []);
  return {
    status: runtime.status ?? "unknown",
    actions: ["continue", "pause", "stop", "refresh"].map((id) => runtimeAction(id, capabilities, runtime.status)),
  };
}

function runtimeAction(id, capabilities, status) {
  const enabled = id === "refresh" || capabilities.has(id);
  return {
    id,
    enabled,
    dangerous: id === "stop",
    status,
    reason: enabled ? null : `${id} is not supported by this runtime`,
  };
}

function hasRuntimeCapability(state, capability) {
  return (state.index?.runtime?.capabilities ?? []).includes(capability);
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

function applyMessageSelection(state, messageId) {
  const message = findMessage(state.index, messageId);
  if (!message) {
    state.selectedMessageId = messageId;
    state.selectedTraceId = null;
    state.selectionRelation = "none";
    return;
  }
  const checkpoint = findCheckpoint(state.index, message.checkpoint_id);
  const trace = findTrace(state.index, traceIdForMessage(state.index, message.id));
  state.selectedMessageId = message.id;
  state.selectedCheckpointId = checkpoint?.id ?? state.selectedCheckpointId;
  state.selectedTimelineId = checkpoint?.timeline_id ?? state.selectedTimelineId;
  state.selectedTraceId = trace?.trace_id ?? null;
  state.selectedToolId = trace?.tool_result_id ?? trace?.tool_call_id ?? null;
  state.selectedContextId = trace?.context_group_id ?? trace?.context_revision ?? null;
  state.selectionRelation = state.selectedTraceId ? "direct" : "none";
}

function applyTraceSelection(state, traceId) {
  const trace = findTrace(state.index, traceId);
  if (!trace) {
    state.selectedTraceId = traceId;
    state.selectedMessageId = null;
    state.selectionRelation = "none";
    return;
  }
  const checkpoint = findCheckpoint(state.index, trace.checkpoint_id);
  state.selectedTraceId = trace.trace_id;
  state.selectedCheckpointId = checkpoint?.id ?? state.selectedCheckpointId;
  state.selectedTimelineId = checkpoint?.timeline_id ?? state.selectedTimelineId;
  state.selectedMessageId = messageIdForTrace(state.index, trace.trace_id) ?? selectedMessageIdForCheckpoint(conversationForTimeline(state.index, state.selectedTimelineId), state.selectedCheckpointId);
  state.selectedToolId = trace.tool_result_id ?? trace.tool_call_id ?? null;
  state.selectedContextId = trace.context_group_id ?? trace.context_revision ?? null;
  state.selectionRelation = state.selectedMessageId ? "direct" : "none";
}

function restoreSelection(state, selection) {
  state.selectedTimelineId = selection.timelineId;
  state.selectedCheckpointId = selection.checkpointId;
  state.selectedMessageId = selection.messageId;
  state.selectedTraceId = selection.traceId;
  state.selectedToolId = selection.toolId;
  state.selectedContextId = selection.contextId;
  state.selectionRelation = selection.relation;
}

function rememberSelection(state) {
  const selection = createDebugSelection(state);
  const current = state.selectionHistory[state.selectionCursor];
  if (current && sameSelection(current, selection)) {
    return;
  }
  state.selectionHistory.splice(state.selectionCursor + 1);
  state.selectionHistory.push(selection);
  state.selectionCursor = state.selectionHistory.length - 1;
}

function createDebugSelection(state) {
  return {
    kind: "debug-selection",
    messageId: state.selectedMessageId,
    traceId: state.selectedTraceId,
    toolId: state.selectedToolId,
    contextId: state.selectedContextId,
    checkpointId: state.selectedCheckpointId,
    timelineId: state.selectedTimelineId,
    relation: state.selectionRelation,
  };
}

function createUrlSelection(state) {
  return {
    sessionId: state.sessionId,
    timelineId: state.selectedTimelineId,
    checkpointId: state.selectedCheckpointId,
    messageId: state.selectedMessageId,
    traceId: state.selectedTraceId,
    toolId: state.selectedToolId,
    contextGroupId: state.selectedContextId,
  };
}

function sameSelection(left, right) {
  return left.messageId === right.messageId && left.traceId === right.traceId && left.toolId === right.toolId && left.contextId === right.contextId && left.checkpointId === right.checkpointId && left.timelineId === right.timelineId && left.relation === right.relation;
}

function findTrace(debugIndex, traceId) {
  return (debugIndex?.traces?.items ?? []).find((trace) => trace.trace_id === traceId) ?? null;
}

function findTraceForTool(debugIndex, toolId) {
  return (debugIndex?.traces?.items ?? []).find((trace) => trace.tool_result_id === toolId || trace.tool_call_id === toolId) ?? null;
}

function findTraceForContext(debugIndex, contextId) {
  return (debugIndex?.traces?.items ?? []).find((trace) => trace.context_group_id === contextId || trace.context_revision === contextId) ?? null;
}

function traceIdForMessage(debugIndex, messageId) {
  if (!messageId) {
    return null;
  }
  const message = findMessage(debugIndex, messageId);
  return message?.trace_id ?? message?.traceId ?? (debugIndex?.traces?.items ?? []).find((trace) => trace.message_id === messageId || trace.messageId === messageId)?.trace_id ?? null;
}

function messageIdForTrace(debugIndex, traceId) {
  const trace = findTrace(debugIndex, traceId);
  if (!trace) {
    return null;
  }
  if (trace.message_id || trace.messageId) {
    return trace.message_id ?? trace.messageId;
  }
  return (debugIndex?.messages ?? []).find((message) => (message.trace_id ?? message.traceId) === traceId)?.id ?? null;
}

function findMessage(debugIndex, messageId) {
  return (debugIndex?.messages ?? []).find((message) => message.id === messageId) ?? null;
}

function selectedMessageIdForCheckpoint(conversation, checkpointId) {
  return conversation.find((message) => message.checkpoint_id === checkpointId)?.id ?? null;
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
