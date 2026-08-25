import assert from "node:assert/strict";
import test from "node:test";

import { createAppShell } from "../src/app/AppShell.js";
import { createChatHeaderController } from "../src/pages/Chat/ChatHeaderController.js";

test("UI03-T05-TC01 unsaved message edit blocks session switch with a prompt", async () => {
  const appShell = createAppShell({ initialUrl: "/chat?sessionId=session-a" });
  const header = createChatHeaderController({ appShell });

  header.setUnsavedMessageEdit(true);
  const result = await header.switchSession("session-b");

  assert.equal(result.status, "blocked");
  assert.equal(result.prompt.reason, "unsaved_message_edit");
  assert.equal(appShell.view().selection.sessionId, "session-a");
});

test("UI03-T05-TC02 switching template does not mutate current session template fact", async () => {
  const appShell = createAppShell({ initialUrl: "/chat?sessionId=session-a&templateId=template-a" });
  const sessionFact = { id: "session-a", agent_template_id: "template-a" };
  const header = createChatHeaderController({ appShell, sessionFact });

  const result = await header.switchTemplate("template-b");

  assert.equal(result.status, "switched");
  assert.equal(appShell.view().selection.templateId, "template-b");
  assert.equal(sessionFact.agent_template_id, "template-a");
});

test("UI03-T05-TC03 cancelling a guarded switch preserves the current draft", async () => {
  const appShell = createAppShell({ initialUrl: "/chat?sessionId=session-a" });
  const header = createChatHeaderController({
    appShell,
    confirmSwitch: async () => false,
  });

  header.setComposerDraft("stay here");
  const result = await header.switchSession("session-b");

  assert.equal(result.status, "cancelled");
  assert.equal(header.view().draft, "stay here");
  assert.equal(appShell.view().selection.sessionId, "session-a");
});
