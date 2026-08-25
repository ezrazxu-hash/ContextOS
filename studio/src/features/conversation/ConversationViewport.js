const DEFAULT_ITEM_HEIGHT = 32;
const DEFAULT_VIEWPORT_HEIGHT = 480;
const DEFAULT_OVERSCAN = 4;
const BOTTOM_THRESHOLD = 24;

export function createConversationViewport(options = {}) {
  const state = {
    messages: [...(options.messages ?? [])],
    itemHeight: options.itemHeight ?? DEFAULT_ITEM_HEIGHT,
    viewportHeight: options.viewportHeight ?? DEFAULT_VIEWPORT_HEIGHT,
    overscan: options.overscan ?? DEFAULT_OVERSCAN,
    scrollTop: 0,
  };

  return {
    view() {
      return view(state);
    },
    scrollTo(scrollTop) {
      state.scrollTop = clampScrollTop(state, scrollTop);
      return view(state);
    },
    scrollToIndex(index) {
      state.scrollTop = clampScrollTop(state, index * state.itemHeight);
      return view(state);
    },
    scrollToBottom() {
      state.scrollTop = maxScrollTop(state);
      return view(state);
    },
    prependPrevious(messages) {
      const anchor = firstVisibleAnchor(state);
      state.messages = [...messages, ...state.messages];
      const nextIndex = state.messages.findIndex((message) => message.id === anchor.messageId);
      state.scrollTop = Math.max(0, nextIndex * state.itemHeight + anchor.offsetTop);
      return view(state);
    },
    appendStreaming(messageDelta) {
      const shouldFollow = isAtBottom(state);
      const existing = state.messages.find((message) => message.id === messageDelta.id);
      if (existing) {
        existing.content = `${existing.content ?? ""}${messageDelta.content ?? ""}`;
      } else {
        state.messages.push({ ...messageDelta });
      }
      if (shouldFollow) {
        state.scrollTop = maxScrollTop(state);
      }
      return view(state);
    },
  };
}

function view(state) {
  const renderedRange = visibleRange(state);
  const rendered = state.messages.slice(renderedRange.start, renderedRange.end).map((message, offset) => ({
    index: renderedRange.start + offset,
    top: (renderedRange.start + offset) * state.itemHeight,
    height: state.itemHeight,
    message,
  }));
  return {
    totalCount: state.messages.length,
    totalHeight: state.messages.length * state.itemHeight,
    scrollTop: state.scrollTop,
    isAtBottom: isAtBottom(state),
    returnToBottomVisible: !isAtBottom(state),
    anchor: firstVisibleAnchor(state),
    rendered,
  };
}

function visibleRange(state) {
  const firstVisible = Math.floor(state.scrollTop / state.itemHeight);
  const visibleCount = Math.ceil(state.viewportHeight / state.itemHeight);
  const start = Math.max(0, firstVisible - state.overscan);
  const end = Math.min(state.messages.length, firstVisible + visibleCount + state.overscan);
  return { start, end };
}

function firstVisibleAnchor(state) {
  const index = Math.min(state.messages.length - 1, Math.floor(state.scrollTop / state.itemHeight));
  const message = state.messages[Math.max(0, index)] ?? null;
  return {
    messageId: message?.id ?? null,
    offsetTop: state.scrollTop - Math.max(0, index) * state.itemHeight,
  };
}

function isAtBottom(state) {
  return maxScrollTop(state) - state.scrollTop <= BOTTOM_THRESHOLD;
}

function maxScrollTop(state) {
  return Math.max(0, state.messages.length * state.itemHeight - state.viewportHeight);
}

function clampScrollTop(state, scrollTop) {
  return Math.min(Math.max(0, scrollTop), maxScrollTop(state));
}
