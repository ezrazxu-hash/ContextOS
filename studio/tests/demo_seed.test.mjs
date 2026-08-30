import { test } from "node:test";
import assert from "node:assert/strict";

import { demoFixtures, demoSeedCatalog } from "../src/test/fixtures/demoRuntime.js";
import { createDebugPage } from "../src/pages/Debug/index.js";
import { createMockRuntimeClient } from "../src/test/msw/mockRuntime.js";

test("UI09-T04-TC01: four demos have fixed page entry routes", () => {
  assert.deepEqual(
    demoSeedCatalog.entries.map((entry) => [entry.id, entry.page, entry.route]),
    [
      ["demo-chat-prd-review", "chat", "/chat?sessionId=demo-session&timelineId=demo-timeline"],
      ["demo-workflow-sales-report", "workflow", "/workflow?templateId=demo-template"],
      ["demo-template-context-policy", "template", "/template?templateId=demo-template"],
      ["demo-debug-replay-risk", "debug", "/debug?sessionId=demo-session&traceId=trace-send-report-email"],
    ],
  );
});

test("UI09-T04-TC02: demo ids and workflow graph are stable for reusable screenshots", () => {
  assert.equal(demoSeedCatalog.seedId, "contextos-v1-studio-demo-seed");
  assert.deepEqual(
    demoFixtures.templateManifest.graph.nodes.map((node) => [node.id, node.type]),
    [
      ["planner", "agent"],
      ["sales_search", "tool"],
      ["region_condition", "condition"],
      ["region_router", "router"],
      ["writer", "output"],
    ],
  );
  assert.deepEqual(demoFixtures.templateManifest.template.id, "demo-template");
});

test("UI09-T04-TC03: demo covers chat impact template policy and does not allow real external writes", () => {
  assert.match(demoFixtures.messages[0].content, /PRD/);
  assert.equal(demoFixtures.messages[1].editable, true);
  assert.equal(demoFixtures.impact.issues[0].issue_type, "message_context_drift");
  assert.equal(demoFixtures.templateManifest.context.policy, "balanced");
  assert.ok(demoFixtures.templateManifest.graph.nodes.find((node) => node.id === "sales_search").config.tool_name === "sales.search");

  const toolCall = demoFixtures.replay.sideEffectToolCall;
  assert.equal(toolCall.tool_id, "send_report_email");
  assert.equal(toolCall.replay_policy, "ASK");
  assert.equal(toolCall.external_write_allowed, false);
  assert.equal(toolCall.mock_only, true);
});

test("UI09-T04-TC04: fixed Debug demo route restores the send_report_email trace", async () => {
  const apiClient = createMockRuntimeClient();
  const page = createDebugPage(apiClient, demoFixtures.session.id, { trace_id: "trace-send-report-email" });
  const view = await page.rehydrate();
  const tool = view.inspectorStack.sections.tool.calls.find((call) => call.component === "send_report_email");

  assert.equal(view.selectedTraceId, "trace-send-report-email");
  assert.equal(view.selectedMessageId, "demo-assistant-message");
  assert.equal(tool.risk.replayPolicy, "ASK");
});
