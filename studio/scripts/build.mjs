import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await mkdir(join(dist, "assets"), { recursive: true });
await writeFile(join(dist, "index.html"), renderIndex(), "utf8");
await writeFile(join(dist, "assets", "app.js"), renderAppScript(), "utf8");

console.log(`Built ContextOS Studio static bundle at ${dist}`);

function renderIndex() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ContextOS Studio</title>
    <style>
      body { margin: 0; font: 14px Arial, sans-serif; color: #111827; background: #f8fafc; }
      nav { display: flex; gap: 16px; padding: 16px 24px; background: #111827; }
      a { color: white; text-decoration: none; }
      main { padding: 24px; }
      code { background: #e5e7eb; padding: 2px 4px; }
    </style>
  </head>
  <body>
    <nav>
      <a href="/chat">Chat</a>
      <a href="/workflow">Workflow</a>
      <a href="/template">Template</a>
      <a href="/debug">Debug</a>
    </nav>
    <main>
      <h1>ContextOS Studio</h1>
      <p data-testid="route"></p>
      <p data-testid="rehydrate-status">Rehydrating</p>
      <p>API: <code data-testid="api-base-url"></code></p>
      <p>SSE: <code data-testid="sse-base-url"></code></p>
    </main>
    <script type="module" src="/assets/app.js"></script>
  </body>
</html>`;
}

function renderAppScript() {
  return `const route = window.location.pathname + window.location.search;
document.querySelector("[data-testid='route']").textContent = route;
fetch("/__contextos/config.json")
  .then((response) => response.json())
  .then((config) => {
    document.querySelector("[data-testid='api-base-url']").textContent = config.apiBaseUrl;
    document.querySelector("[data-testid='sse-base-url']").textContent = config.sseBaseUrl;
    document.querySelector("[data-testid='rehydrate-status']").textContent = "Ready";
  })
  .catch(() => {
    document.querySelector("[data-testid='rehydrate-status']").textContent = "Runtime config unavailable";
  });
`;
}
