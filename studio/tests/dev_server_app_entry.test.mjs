import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import assert from "node:assert/strict";

test("dev server serves the browser Studio app entry instead of a placeholder shell", async () => {
  const studio = await startStudio();
  try {
    const response = await fetch(`${studio.url}/chat`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /<div id="app"/);
    assert.match(html, /src="\/src\/main\.js"/);
    assert.doesNotMatch(html, /ContextOS Studio Chat<\/h1>/);
  } finally {
    await studio.close();
  }
});

async function startStudio() {
  const port = await freePort();
  const child = spawn(process.execPath, ["scripts/dev-server.mjs", "--mock"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
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
  throw new Error(`Studio dev server did not start at ${url}`);
}
