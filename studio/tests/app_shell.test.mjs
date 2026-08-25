import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\tests$/, "");

function moduleUrl(relativePath) {
  return pathToFileURL(join(studioRoot, relativePath)).href;
}

test("UI01-T01 switching template synchronizes URL selection and query without page reload", async () => {
  const { createAppShell } = await import(moduleUrl("src/app/AppShell.js"));

  const navigation = [];
  const shell = createAppShell({
    initialUrl: "/chat?templateId=template-a&sessionId=session-a",
    navigate(url, options) {
      navigation.push({ url, options });
    },
  });

  const view = shell.selectTemplate("template-b");

  assert.equal(view.header.brand, "ContextOS");
  assert.equal(view.header.currentTemplateId, "template-b");
  assert.equal(view.url, "/chat?templateId=template-b&sessionId=session-a");
  assert.deepEqual(navigation, [{ url: "/chat?templateId=template-b&sessionId=session-a", options: { replace: false } }]);
  assert.equal(view.reloadRequired, false);
});

test("UI01-T01 switching session clears previous session scoped context and trace selections", async () => {
  const { createAppShell } = await import(moduleUrl("src/app/AppShell.js"));

  const refreshes = [];
  const shell = createAppShell({
    initialUrl: "/debug?templateId=template-a&sessionId=session-a&traceId=trace-a&contextGroupId=group-a",
    onSelectionChange(selection) {
      refreshes.push(selection);
    },
  });

  const view = shell.selectSession("session-b");

  assert.equal(view.header.currentSessionId, "session-b");
  assert.equal(view.selection.sessionId, "session-b");
  assert.equal(view.selection.traceId, null);
  assert.equal(view.selection.contextGroupId, null);
  assert.equal(view.url, "/debug?templateId=template-a&sessionId=session-b");
  assert.deepEqual(refreshes.map((selection) => selection.sessionId), ["session-b"]);
});

test("UI01-T01 developer mode is a global UI preference across Studio pages", async () => {
  const { createAppShell } = await import(moduleUrl("src/app/AppShell.js"));

  const shell = createAppShell({ initialUrl: "/chat?sessionId=session-a" });

  const enabled = shell.setDeveloperMode(true);
  const workflow = shell.navigateTo("/workflow");
  const debug = shell.navigateTo("/debug");

  assert.equal(enabled.header.developerMode, true);
  assert.equal(workflow.header.developerMode, true);
  assert.equal(debug.header.developerMode, true);
  assert.deepEqual(debug.header.actions.map((action) => action.id), ["help", "user"]);
});
