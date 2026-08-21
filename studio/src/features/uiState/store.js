const defaultViewport = { x: 0, y: 0, zoom: 1 };

export function createUiStateStore() {
  const state = {
    selectedMessageId: null,
    currentPanel: "chat",
    graphViewport: { ...defaultViewport },
  };

  return {
    getState() {
      return {
        selectedMessageId: state.selectedMessageId,
        currentPanel: state.currentPanel,
        graphViewport: { ...state.graphViewport },
      };
    },
    selectMessage(messageId) {
      state.selectedMessageId = messageId;
    },
    setCurrentPanel(panel) {
      state.currentPanel = panel;
    },
    setGraphViewport(viewport) {
      state.graphViewport = { ...viewport };
    },
  };
}
