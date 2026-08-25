export const demoTemplateManifest = {
  template: { id: "demo-template", name: "ContextOS Demo Agent", version: "1.0.0" },
  graph: {
    state_schema: "default_chat_state",
    nodes: [
      { id: "planner", type: "agent", config: { model: "demo-model" } },
      { id: "sales_tool", type: "tool", config: { tool_id: "sales.search" } },
      { id: "writer", type: "output", config: { output_key: "answer" } },
    ],
    edges: [
      { from: "START", to: "planner" },
      { from: "planner", to: "sales_tool" },
      { from: "sales_tool", to: "writer" },
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
      content: "Summarize Q3 sales",
      status: "completed",
      token_count: 4,
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
      content: "Q3 sales are up 18%.",
      status: "completed",
      token_count: 6,
      context_group_ids: ["demo-context-group"],
      checkpoint_id: "demo-checkpoint",
      trace_id: "demo-trace",
      tool_call_ids: ["tool-call-sales"],
      tool_result_ids: ["tool-call-sales"],
      created_at: "2026-08-24T00:00:01+00:00",
    },
  ],
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
      tool_call_id: "tool-call-send-email",
      tool_id: "send_email",
      side_effect: "EXTERNAL_WRITE",
      args: { to: "finance@example.com", subject: "Q3 sales summary" },
    },
  },
};
