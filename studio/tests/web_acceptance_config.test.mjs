import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("UI09-T05-TC01/TC03: web acceptance uses Playwright mock mode with failure artifacts", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const config = await readFile(new URL("../playwright.config.mjs", import.meta.url), "utf8");
  const spec = await readFile(new URL("../e2e/web-acceptance.spec.mjs", import.meta.url), "utf8");

  assert.match(packageJson.scripts["test:web-acceptance"], /web-acceptance\.spec\.mjs/);
  assert.match(config, /trace:\s*"retain-on-failure"/);
  assert.match(config, /video:\s*"retain-on-failure"/);
  assert.match(spec, /E2E-01/);
  assert.match(spec, /E2E-08/);
  assert.match(spec, /CONTEXTOS_STUDIO_REAL_RUNTIME_URL/);
});
