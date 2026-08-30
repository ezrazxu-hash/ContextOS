import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const studioRoot = fileURLToPath(new URL("..", import.meta.url));

test("UI09-T03-TC01: production build exits 0 and emits static assets without Runtime code", async () => {
  await runNpm("run", "build");
  const index = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");

  assert.match(index, /ContextOS Studio/);
  assert.doesNotMatch(index, /contextos-runtime|LangGraph Runtime/);
});

test("UI09-T03-TC02: direct /debug deep link is served by production history fallback", async () => {
  await runNpm("run", "build");
  const server = await startPreview();
  try {
    const response = await fetch(`${server.url}/debug?sessionId=session-1&traceId=trace-1`);
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(body, /ContextOS Studio/);
  } finally {
    await server.close();
  }
});

test("UI09-T03-TC03: refreshing deep links can rehydrate from Runtime config", async () => {
  await runNpm("run", "build");
  const server = await startPreview({
    CONTEXTOS_STUDIO_API_BASE_URL: "http://runtime.example.test",
    CONTEXTOS_STUDIO_SSE_BASE_URL: "http://runtime.example.test/sse",
  });
  try {
    const config = await (await fetch(`${server.url}/__contextos/config.json`)).json();
    const response = await fetch(`${server.url}/workflow?templateId=template-1`);

    assert.equal(response.status, 200);
    assert.deepEqual(config, {
      apiBaseUrl: "http://runtime.example.test",
      sseBaseUrl: "http://runtime.example.test/sse",
      wsBaseUrl: "",
    });
  } finally {
    await server.close();
  }
});

async function runNpm(...args) {
  const command = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npm";
  const commandArgs = process.platform === "win32"
    ? ["/d", "/s", "/c", "npm", "--prefix", "studio", ...args]
    : ["--prefix", "studio", ...args];
  const child = spawn(command, commandArgs, {
    cwd: repoRoot,
    stdio: "ignore",
  });
  const [code] = await once(child, "exit");
  assert.equal(code, 0);
}

async function startPreview(env = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, ["scripts/serve-dist.mjs"], {
    cwd: studioRoot,
    env: {
      ...process.env,
      ...env,
      CONTEXTOS_STUDIO_PORT: String(port),
    },
    stdio: "ignore",
  });
  const url = `http://127.0.0.1:${port}`;
  await waitForServer(url);
  return {
    url,
    close() {
      child.kill();
      return once(child, "exit").catch(() => {});
    },
  };
}

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForServer(url) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/__contextos/config.json`);
      if (response.ok) {
        return;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`Production preview did not start at ${url}`);
}
