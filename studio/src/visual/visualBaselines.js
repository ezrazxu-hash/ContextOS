const DESKTOP_1280 = { width: 1280, height: 800 };

export const visualBaselines = {
  reviewPolicy: {
    autoAccept: false,
    reviewer: "human",
  },
  pages: [
    {
      id: "chat-default",
      kind: "golden-screenshot",
      page: "Chat",
      state: "default",
      viewport: DESKTOP_1280,
      regions: ["session-list", "conversation", "composer", "context-panel"],
      reviewRequired: true,
    },
    {
      id: "workflow-default",
      kind: "golden-screenshot",
      page: "Workflow",
      state: "default",
      viewport: DESKTOP_1280,
      regions: ["node-library", "canvas", "config-panel"],
      reviewRequired: true,
    },
    {
      id: "debug-default",
      kind: "golden-screenshot",
      page: "Debug",
      state: "default",
      viewport: DESKTOP_1280,
      regions: ["timeline", "conversation-trace", "inspector-stack"],
      reviewRequired: true,
    },
  ],
  riskModal: {
    id: "replay-danger-modal",
    kind: "golden-screenshot",
    state: "risk-modal",
    reviewRequired: true,
  },
  workflowSelectedNode: {
    id: "workflow-selected-node-config",
    kind: "golden-screenshot",
    state: "selected-node-config-panel",
    reviewRequired: true,
  },
};
