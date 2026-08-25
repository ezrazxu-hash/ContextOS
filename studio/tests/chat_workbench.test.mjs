import assert from "node:assert/strict";
import test from "node:test";

import { createChatWorkbench } from "../src/pages/Chat/ChatWorkbench.js";
import { createMockRuntimeClient, demoFixtures } from "../src/test/msw/mockRuntime.js";

function memoryPlatform() {
  const values = new Map();
  return {
    readUiState(key) {
      return values.get(key) ?? null;
    },
    writeUiState(key, value) {
      values.set(key, value);
    },
  };
}

test("UI03-T01-TC01 collapsing right sections preserves conversation scroll position", async () => {
  const workbench = createChatWorkbench({
    apiClient: createMockRuntimeClient(),
    sessionId: demoFixtures.session.id,
    platform: memoryPlatform(),
    viewportWidth: 1280,
  });

  await workbench.rehydrate();
  workbench.setConversationScroll(420);
  const view = workbench.toggleRightSection("context");

  assert.equal(view.conversation.scrollTop, 420);
  assert.equal(view.right.sections.context.collapsed, true);
  assert.equal(view.layout.panels.main.role, "main");
});

test("UI03-T01-TC02 selecting a message shows impact without stealing composer focus", async () => {
  const workbench = createChatWorkbench({
    apiClient: createMockRuntimeClient(),
    sessionId: demoFixtures.session.id,
    platform: memoryPlatform(),
  });

  await workbench.rehydrate();
  const view = workbench.selectMessage("demo-assistant-message");

  assert.equal(view.conversation.selectedMessageId, "demo-assistant-message");
  assert.equal(view.right.sections.impact.anchorMessageId, "demo-assistant-message");
  assert.equal(view.focus.activeElement, "composer");
});

test("UI03-T01-TC03 chat narrow width presents the right rail as a drawer", async () => {
  const workbench = createChatWorkbench({
    apiClient: createMockRuntimeClient(),
    sessionId: demoFixtures.session.id,
    platform: memoryPlatform(),
    viewportWidth: 720,
  });

  const view = await workbench.rehydrate();

  assert.equal(view.layout.panels.right.mode, "drawer");
  assert.equal(view.right.mode, "drawer");
  assert.equal(view.layout.panels.main.primaryActionVisible, true);
});
