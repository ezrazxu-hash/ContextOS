export const demoTemplateManifest = {
  template: { id: "demo-template", name: "ContextOS Demo Agent", version: "1.0.0" },
  graph: {
    state_schema: "default_chat_state",
    nodes: [
      { id: "planner", type: "agent", config: { model: "demo-model", instruction: "Plan the PRD review answer", output_key: "plan" } },
      { id: "sales_search", type: "tool", config: { tool_name: "sales.search", output_key: "sales" } },
      { id: "region_condition", type: "condition", config: { state_key: "region" } },
      { id: "region_router", type: "router", config: { state_key: "route", routes: { enterprise: "writer" } } },
      { id: "writer", type: "output", config: { source: "$state.plan" } },
    ],
    edges: [
      { from: "START", to: "planner" },
      { from: "planner", to: "sales_search" },
      { from: "sales_search", to: "region_condition" },
      { from: "region_condition", to: "region_router", condition: "yes" },
      { from: "region_condition", to: "writer", condition: "no" },
      { from: "region_router", to: "writer", condition: "enterprise" },
      { from: "writer", to: "END" },
    ],
  },
  context: {
    policy: "balanced",
    budget: { high_watermark: 0.8, target_watermark: 0.65 },
    restore: { mode: "auto", max_tokens_per_restore: 12000, max_restore_per_turn: 3 },
  },
  checkpoint: { enabled: true },
  ui: { editable_messages: true, expose_context_panel: true },
};

export const demoSeedCatalog = {
  seedId: "contextos-v1-studio-demo-seed",
  entries: [
    { id: "demo-chat-prd-review", page: "chat", route: "/chat?sessionId=demo-session&timelineId=demo-timeline" },
    { id: "demo-workflow-sales-report", page: "workflow", route: "/workflow?templateId=demo-template" },
    { id: "demo-template-context-policy", page: "template", route: "/template?templateId=demo-template" },
    { id: "demo-debug-replay-risk", page: "debug", route: "/debug?sessionId=demo-session&traceId=trace-send-report-email" },
  ],
};

export const demoFixtures = {
  session: {
    id: "demo-session",
    agent_template_id: "demo-template",
    workspace_id: "demo-workspace",
    current_timeline_id: "demo-timeline",
  },
  timeline: {
    id: "demo-timeline",
    parent_timeline_id: null,
  },
  checkpoint: {
    id: "demo-checkpoint",
    timeline_id: "demo-timeline",
    graph_state: { node: "writer", topic: "Q3 sales" },
    message_cursor: 2,
    context_revision: "demo-context-revision",
  },
  templateManifest: demoTemplateManifest,
  messages: [
    {
      id: "demo-user-message",
      role: "user",
      content: "梳理 ContextOS V1 PRD 中 Q3 sales demo 的关键结论。",
      status: "completed",
      token_count: 14,
      context_group_ids: ["demo-context-group"],
      checkpoint_id: null,
      trace_id: "demo-trace",
      tool_call_ids: [],
      tool_result_ids: [],
      created_at: "2026-08-24T00:00:00+00:00",
    },
    {
      id: "demo-assistant-message",
      role: "assistant",
      content: "PRD demo summary: Q3 sales are up 18%, with enterprise renewals leading.",
      status: "completed",
      editable: true,
      revision_id: "demo-message-revision",
      token_count: 12,
      context_group_ids: ["demo-context-group"],
      checkpoint_id: "demo-checkpoint",
      trace_id: "demo-trace",
      tool_call_ids: ["tool-call-sales"],
      tool_result_ids: ["tool-call-sales"],
      created_at: "2026-08-24T00:00:01+00:00",
    },
  ],
  impact: {
    issues: [
      {
        issue_type: "message_context_drift",
        severity: "info",
        evidence: { message_id: "demo-assistant-message", context_group_id: "demo-context-group" },
        related_ids: ["demo-assistant-message", "demo-context-group"],
      },
    ],
  },
  context: [
    {
      id: "demo-context-item",
      group_id: "demo-context-group",
      session_id: "demo-session",
      state: "RAW",
      effective_content: "Q3 sales closed 18% above Q2.",
      raw_content: "Q3 sales closed 18% above Q2 with enterprise renewals leading.",
      generated_content: null,
      user_override: null,
      token_count_effective: 8,
      source: { type: "demo" },
    },
  ],
  replay: {
    sideEffectToolCall: {
      tool_call_id: "tool-call-send-report-email",
      tool_id: "send_report_email",
      side_effect: "EXTERNAL_WRITE",
      replay_policy: "ASK",
      external_write_allowed: false,
      mock_only: true,
      args: { to: "finance@example.com", subject: "Q3 sales summary" },
    },
  },
};
