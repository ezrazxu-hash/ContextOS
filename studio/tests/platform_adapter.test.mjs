import { existsSync, readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\tests$/, "");
const srcRoot = join(studioRoot, "src");

function moduleUrl(relativePath) {
  return pathToFileURL(join(studioRoot, relativePath)).href;
}

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(fullPath) : [fullPath];
  });
}

test("UI10-T01-TC01: testPlatform can replace clipboard storage external navigation and notifications", async () => {
  const { createTestPlatform } = await import(moduleUrl("src/platform/testPlatform.js"));

  const platform = createTestPlatform({
    uiState: { "layout.width": { left: 280 } },
  });

  assert.deepEqual(platform.readUiState("layout.width"), { left: 280 });
  platform.writeUiState("layout.width", { left: 320 });
  await platform.writeClipboardText("trace-1");
  await platform.openExternal("https://example.test/debug");
  await platform.notify({ title: "Saved", body: "Template saved" });

  assert.deepEqual(platform.readUiState("layout.width"), { left: 320 });
  assert.equal(await platform.readClipboardText(), "trace-1");
  assert.deepEqual(platform.openedExternalUrls(), ["https://example.test/debug"]);
  assert.deepEqual(platform.notifications(), [{ title: "Saved", body: "Template saved" }]);
});

test("UI10-T01-TC02: feature and page modules do not directly call browser-only platform APIs", () => {
  const scopedFiles = ["features", "pages"]
    .flatMap((scope) => listFiles(join(srcRoot, scope)))
    .filter((file) => file.endsWith(".js"));

  assert.ok(scopedFiles.length > 0, "expected feature and page source files");
  for (const file of scopedFiles) {
    const source = readFileSync(file, "utf-8");
    assert.doesNotMatch(source, /\b(?:window|globalThis)\.(?:localStorage|sessionStorage|open)\b/, file);
    assert.doesNotMatch(source, /\bnavigator\.clipboard\b/, file);
    assert.doesNotMatch(source, /\bNotification\b/, file);
    assert.doesNotMatch(source, /\bshow(?:Open|Save)FilePicker\b/, file);
  }
});

test("UI10-T01-TC03: platform modules can load in a non-browser test environment", async () => {
  assert.ok(existsSync(join(srcRoot, "platform/PlatformAdapter.js")), "missing PlatformAdapter contract");
  const { createWebPlatform } = await import(moduleUrl("src/platform/webPlatform.js"));

  const platform = createWebPlatform({ storage: null, clipboard: null, opener: null, notifier: null });

  assert.equal(platform.readUiState("missing"), null);
  await platform.writeClipboardText("safe in node");
  assert.equal(await platform.readClipboardText(), "safe in node");
});
