import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\tests$/, "");

function moduleUrl(relativePath) {
  return pathToFileURL(join(studioRoot, relativePath)).href;
}

test("UI01-T02 session search filters the visible view without mutating backend resources", async () => {
  const { createResourceNavigation } = await import(moduleUrl("src/app/resourceNavigation.js"));
  const backendResources = {
    sessions: [
      { id: "session-a", title: "Refund support", agent_template_id: "template-a", status: "active" },
      { id: "session-b", title: "Shipping question", agent_template_id: "template-b", status: "idle" },
    ],
    templates: [],
    timelines: [],
  };
  const navigation = createResourceNavigation({ resources: backendResources });

  const view = navigation.searchSessions("refund");

  assert.deepEqual(view.sessions.map((session) => session.id), ["session-a"]);
  assert.deepEqual(backendResources.sessions.map((session) => session.id), ["session-a", "session-b"]);
  assert.equal(view.emptyState, null);
});

test("UI01-T02 selecting a backend timeline opens its owning session and timeline", async () => {
  const { createResourceNavigation } = await import(moduleUrl("src/app/resourceNavigation.js"));
  const opened = [];
  const navigation = createResourceNavigation({
    resources: {
      sessions: [{ id: "session-a", title: "Refund support", agent_template_id: "template-a", status: "active" }],
      templates: [],
      timelines: [
        { id: "timeline-a", session_id: "session-a", status: "active", created_at: "2026-08-20T00:00:00+00:00" },
      ],
    },
    openUrl(url) {
      opened.push(url);
    },
  });

  const view = navigation.selectTimeline("timeline-a");

  assert.equal(view.selectedTimelineId, "timeline-a");
  assert.equal(view.selectedSessionId, "session-a");
  assert.deepEqual(opened, ["/chat?sessionId=session-a&timelineId=timeline-a"]);
});

test("UI01-T02 empty resources render EmptyState instead of a blank panel", async () => {
  const { createResourceNavigation } = await import(moduleUrl("src/app/resourceNavigation.js"));

  const navigation = createResourceNavigation({ resources: { sessions: [], templates: [], timelines: [] } });
  const view = navigation.view();

  assert.equal(view.sessions.length, 0);
  assert.equal(view.templates.length, 0);
  assert.equal(view.timelines.length, 0);
  assert.deepEqual(view.emptyState, {
    kind: "empty",
    title: "No resources yet",
    action: { id: "create-session", label: "New Session" },
  });
});
