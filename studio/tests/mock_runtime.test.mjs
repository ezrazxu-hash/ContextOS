import assert from "node:assert/strict";
import test from "node:test";

import { createChatPage } from "../src/pages/Chat/ChatPage.js";
import { createDebugPage } from "../src/pages/Debug/index.js";
import { createTemplatePage } from "../src/pages/Template/index.js";
import { createWorkflowPage } from "../src/pages/Workflow/index.js";
import { createReplayPlanDialog } from "../src/features/replay/ReplayPlanDialog.js";
import { createMockRuntimeClient, demoFixtures } from "../src/test/msw/mockRuntime.js";

test("UI02-T05-TC01 mock mode opens all four Studio pages", async () => {
  const apiClient = createMockRuntimeClient();

  const chat = await createChatPage(apiClient, demoFixtures.session.id).rehydrate();
  const debug = await createDebugPage(apiClient, demoFixtures.session.id).rehydrate();
  const workflow = await createWorkflowPage(apiClient);
  const template = await createTemplatePage(apiClient, demoFixtures.templateManifest);

  assert.equal(chat.sessionId, "demo-session");
  assert.ok(chat.cards.length > 0);
  assert.equal(debug.graph.selectedTimelineId, "demo-timeline");
  assert.deepEqual(workflow.nodeLibrary().map((node) => node.type), ["prompt", "llm", "tool", "condition", "output"]);
  assert.equal(template.view().manifest.template.id, "demo-template");
});

test("UI02-T05-TC02 chat mock streams text with ToolCall and ToolResult", async () => {
  const apiClient = createMockRuntimeClient();
  const chatPage = createChatPage(apiClient, demoFixtures.session.id);

  let cards = [];
  for await (const event of apiClient.streamChatEvents({
    session_id: demoFixtures.session.id,
    timeline_id: demoFixtures.timeline.id,
    content: "Summarize Q3 sales",
  })) {
    cards = chatPage.applyStreamEvent(event);
  }

  const assistant = cards.find((card) => card.key === "demo-assistant-stream");
  assert.equal(assistant.content, "Q3 sales are up 18%.");
  assert.deepEqual(assistant.toolRelation.toolCallIds, ["tool-call-sales"]);
  assert.deepEqual(assistant.toolRelation.toolResultIds, ["tool-call-sales"]);
});

test("UI02-T05-TC03 replay send_report_email fixture triggers high-risk confirmation UI", async () => {
  const apiClient = createMockRuntimeClient();
  const toolCall = demoFixtures.replay.sideEffectToolCall;
  const dialog = createReplayPlanDialog(apiClient, {
    parentTimelineId: demoFixtures.timeline.id,
    forkCheckpointId: demoFixtures.checkpoint.id,
    forkMessageId: demoFixtures.messages[1].id,
    idempotencyKey: "demo-replay-key",
    toolCall,
  });

  assert.equal(dialog.view().selectedAction, "USE_HISTORY");
  dialog.selectAction("REINVOKE");
  assert.equal(dialog.view().requiresConfirmation, true);
  assert.deepEqual(await dialog.submit(), { status: "blocked", reason: "confirmation_required" });

  dialog.setConfirmationToken("confirm-demo-send-report-email");
  const result = await dialog.submit();

  assert.equal(result.status, "planned");
  assert.equal(result.body.decisions[0].tool_call_id, "tool-call-send-report-email");
});
