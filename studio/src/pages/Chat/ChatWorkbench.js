import { createWorkbenchLayout } from "../../design-system/layout/workbenchLayout.js";
import { createImpactPanel } from "../../features/impact-analyzer/ImpactPanel.js";
import { createContextPanel } from "../../features/context-panel/ContextPanel.js";
import { createTimelineView } from "../../features/timeline/TimelineView.js";
import { createChatPage } from "./ChatPage.js";

const RIGHT_SECTIONS = ["context", "timeline", "impact"];

export function createChatWorkbench({ apiClient, sessionId, platform, viewportWidth = 1280, maxTokens = 32000 }) {
  const layout = createWorkbenchLayout(platform, { layoutId: `chat.${sessionId}`, viewportWidth });
  const chatPage = createChatPage(apiClient, sessionId);
  const contextPanel = createContextPanel(adaptContextApi(apiClient), { sessionId, maxTokens });
  const state = {
    cards: [],
    debugIndex: null,
    selectedMessageId: null,
    conversationScrollTop: 0,
    focus: "composer",
    rightCollapsed: {
      context: false,
      timeline: false,
      impact: false,
    },
  };

  return {
    async rehydrate() {
      const [chat, context, debugIndex] = await Promise.all([
        chatPage.rehydrate(),
        contextPanel.refresh(),
        apiClient.fetchDebugIndex(sessionId),
      ]);
      state.cards = chat.cards;
      state.context = context;
      state.debugIndex = debugIndex;
      return view(layout, state);
    },
    setConversationScroll(scrollTop) {
      state.conversationScrollTop = scrollTop;
      return view(layout, state);
    },
    toggleRightSection(sectionId) {
      assertRightSection(sectionId);
      state.rightCollapsed[sectionId] = !state.rightCollapsed[sectionId];
      return view(layout, state);
    },
    selectMessage(messageId) {
      state.selectedMessageId = messageId;
      state.focus = "composer";
      return view(layout, state);
    },
    view() {
      return view(layout, state);
    },
  };
}

function view(layout, state) {
  const layoutView = layout.view();
  const selectedMessage = state.cards.find((card) => card.id === state.selectedMessageId) ?? null;
  return {
    layout: layoutView,
    conversation: {
      cards: state.cards,
      selectedMessageId: state.selectedMessageId,
      scrollTop: state.conversationScrollTop,
    },
    right: {
      mode: layoutView.panels.right.mode,
      sections: {
        context: {
          collapsed: state.rightCollapsed.context,
          view: state.context ?? null,
        },
        timeline: {
          collapsed: state.rightCollapsed.timeline,
          view: state.debugIndex ? createTimelineView(state.debugIndex, state.debugIndex.session.current_timeline_id) : null,
        },
        impact: {
          collapsed: state.rightCollapsed.impact,
          anchorMessageId: state.selectedMessageId,
          view: createImpactPanel(impactFor(selectedMessage)).view(),
        },
      },
    },
    focus: {
      activeElement: state.focus,
    },
  };
}

function impactFor(message) {
  if (!message || message.role !== "assistant") {
    return {};
  }
  return {
    issues: [
      {
        issue_type: "message_tool_result_conflict",
        severity: "info",
        evidence: {},
        related_ids: [message.id, ...message.toolRelation.toolResultIds],
      },
    ],
  };
}

function adaptContextApi(apiClient) {
  return {
    fetchSessionContext: apiClient.fetchSessionContext?.bind(apiClient),
    pinGroup: apiClient.pinGroup?.bind(apiClient) ?? apiClient.postContextGroupPin?.bind(apiClient),
    unpinGroup: apiClient.unpinGroup?.bind(apiClient) ?? apiClient.postContextGroupUnpin?.bind(apiClient),
    abstractGroup: apiClient.abstractGroup?.bind(apiClient) ?? apiClient.postContextGroupAbstract?.bind(apiClient),
    evictGroup: apiClient.evictGroup?.bind(apiClient) ?? apiClient.postContextGroupEvict?.bind(apiClient),
    restoreGroup: apiClient.restoreGroup?.bind(apiClient) ?? apiClient.postContextGroupRestore?.bind(apiClient),
    fetchRaw: apiClient.fetchRaw?.bind(apiClient) ?? apiClient.getContextItemRaw?.bind(apiClient),
    fetchRevisions: apiClient.fetchRevisions?.bind(apiClient) ?? apiClient.getContextItemRevisions?.bind(apiClient),
    restoreSystemVersion:
      apiClient.restoreSystemVersion?.bind(apiClient) ?? apiClient.postContextItemRestoreSystem?.bind(apiClient),
  };
}

function assertRightSection(sectionId) {
  if (!RIGHT_SECTIONS.includes(sectionId)) {
    throw new Error(`Unknown Chat right section: ${sectionId}`);
  }
}
