export const runtimeApiContract = Object.freeze({
  factsSource: "backend-runtime-api",
  endpoints: Object.freeze([
    "GET /api/sessions",
    "POST /api/sessions",
    "GET /api/sessions/{sessionId}",
    "GET /api/sessions/{sessionId}/messages",
    "GET /api/sessions/{sessionId}/context",
    "GET /api/debug/sessions/{sessionId}",
    "POST /api/templates/{templateId}/run",
  ]),
  events: Object.freeze(["token", "tool_call", "tool_result", "done", "heartbeat", "error"]),
});
