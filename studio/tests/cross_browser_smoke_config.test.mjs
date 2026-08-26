import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("UI08-T04-TC00: cross-browser smoke has Chromium plus one non-Chromium Playwright project", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const configSource = await readFile(new URL("../playwright.cross-browser.config.mjs", import.meta.url), "utf8");

  assert.match(packageJson.scripts["test:cross-browser"], /playwright.*cross-browser-smoke\.spec\.mjs/);
  assert.match(packageJson.scripts["test:cross-browser"], /playwright\.cross-browser\.config\.mjs/);
  assert.match(configSource, /name:\s*"chromium"/);
  assert.match(configSource, /name:\s*"firefox"/);
  assert.match(configSource, /cross-browser-smoke\.spec\.mjs/);
});
