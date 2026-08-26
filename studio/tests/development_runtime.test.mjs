import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("UI09-T01-TC01: development runtime exposes one command with mock and real modes", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

  assert.match(packageJson.scripts.dev, /scripts\/dev-server\.mjs/);
  assert.match(packageJson.scripts["dev:mock"], /scripts\/dev-server\.mjs --mock/);
  assert.match(packageJson.scripts["dev:real"], /scripts\/dev-server\.mjs --real/);
});

test("UI09-T01-TC02: env example defines API, SSE, and mock Runtime settings without requiring an LLM key", async () => {
  const envExample = await readFile(new URL("../.env.example", import.meta.url), "utf8");

  assert.match(envExample, /CONTEXTOS_STUDIO_API_BASE_URL=/);
  assert.match(envExample, /CONTEXTOS_STUDIO_SSE_BASE_URL=/);
  assert.match(envExample, /CONTEXTOS_STUDIO_MOCK_RUNTIME=true/);
  assert.doesNotMatch(envExample, /OPENAI_API_KEY|ANTHROPIC_API_KEY|LLM_API_KEY/);
});

test("UI09-T01-TC03: README documents mock and real Runtime startup for all four routes", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");

  assert.match(readme, /npm run dev:mock/);
  assert.match(readme, /npm run dev:real/);
  assert.match(readme, /\/chat/);
  assert.match(readme, /\/workflow/);
  assert.match(readme, /\/template/);
  assert.match(readme, /\/debug/);
});
