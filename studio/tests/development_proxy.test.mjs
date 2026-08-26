import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";

test("UI09-T02-TC01: SSE proxy streams tokens with no-buffer headers", async () => {
  const runtime = await startRuntime(async (request, response) => {
    if (request.url === "/events") {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });
      response.write("event: token\ndata: hello\n\n");
      response.end("event: done\ndata: {}\n\n");
      return;
    }
    response.writeHead(404).end();
  });
  const studio = await startStudio({ sseBaseUrl: runtime.url });
  try {
    const response = await fetch(`${studio.url}/sse/events`);
    const body = await response.text();

    assert.equal(response.headers.get("content-type"), "text/event-stream");
    assert.equal(response.headers.get("x-accel-buffering"), "no");
    assert.match(body, /event: token/);
    assert.match(body, /data: hello/);
  } finally {
    await studio.close();
    await runtime.close();
  }
});

test("UI09-T02-TC02: API proxy preserves Runtime trace headers on errors", async () => {
  const runtime = await startRuntime((request, response) => {
    if (request.url === "/fail") {
      response.writeHead(503, {
        "content-type": "application/json",
        "x-contextos-trace-id": "trace-proxy-1",
      });
      response.end(JSON.stringify({ error: "unavailable" }));
      return;
    }
    response.writeHead(404).end();
  });
  const studio = await startStudio({ apiBaseUrl: runtime.url });
  try {
    const response = await fetch(`${studio.url}/api/fail`);
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.equal(response.headers.get("x-contextos-trace-id"), "trace-proxy-1");
    assert.deepEqual(body, { error: "unavailable" });
  } finally {
    await studio.close();
    await runtime.close();
  }
});

test("UI09-T02-TC03: disabled WS endpoint does not affect REST and SSE proxies", async () => {
  const runtime = await startRuntime((request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    response.writeHead(404).end();
  });
  const studio = await startStudio({ apiBaseUrl: runtime.url, sseBaseUrl: runtime.url });
  try {
    const wsResponse = await fetch(`${studio.url}/ws/debug`);
    const apiResponse = await fetch(`${studio.url}/api/health`);

    assert.equal(wsResponse.status, 501);
    assert.equal(apiResponse.status, 200);
    assert.deepEqual(await apiResponse.json(), { ok: true });
  } finally {
    await studio.close();
    await runtime.close();
  }
});

test("UI09-T02-TC04: production reverse proxy documents REST, SSE, and WS routes", async () => {
  const nginx = await readFile(new URL("../deploy/nginx.conf", import.meta.url), "utf8");

  assert.match(nginx, /location \/api\//);
  assert.match(nginx, /location \/sse\//);
  assert.match(nginx, /proxy_buffering off/);
  assert.match(nginx, /location \/ws\//);
});

async function startRuntime(handler) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function startStudio({ apiBaseUrl = "http://127.0.0.1:1", sseBaseUrl = "http://127.0.0.1:1", wsBaseUrl = "" } = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, ["scripts/dev-server.mjs", "--real"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      CONTEXTOS_STUDIO_PORT: String(port),
      CONTEXTOS_STUDIO_API_BASE_URL: apiBaseUrl,
      CONTEXTOS_STUDIO_SSE_BASE_URL: sseBaseUrl,
      CONTEXTOS_STUDIO_WS_BASE_URL: wsBaseUrl,
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
  throw new Error(`Studio dev server did not start at ${url}`);
}
