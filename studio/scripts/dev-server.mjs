import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const port = Number(process.env.CONTEXTOS_STUDIO_PORT ?? 5173);
const runtimeModeArg = process.argv.includes("--real") ? "real" : process.argv.includes("--mock") ? "mock" : null;
const config = {
  apiBaseUrl: process.env.CONTEXTOS_STUDIO_API_BASE_URL ?? "http://localhost:18000",
  sseBaseUrl: process.env.CONTEXTOS_STUDIO_SSE_BASE_URL ?? "http://localhost:18000",
  wsBaseUrl: process.env.CONTEXTOS_STUDIO_WS_BASE_URL ?? "",
  mockRuntime: runtimeModeArg ? runtimeModeArg === "mock" : process.env.CONTEXTOS_STUDIO_MOCK_RUNTIME !== "false",
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (url.pathname.startsWith("/api/")) {
    await proxyHttp(request, response, config.apiBaseUrl, `${url.pathname}${url.search}`);
    return;
  }
  if (url.pathname.startsWith("/sse/")) {
    await proxyHttp(request, response, config.sseBaseUrl, `${url.pathname}${url.search}`, { sse: true });
    return;
  }
  if (url.pathname.startsWith("/ws/")) {
    response.writeHead(501, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "ws_proxy_not_enabled" }));
    return;
  }
  if (url.pathname === "/__contextos/config.json") {
    sendJson(response, config);
    return;
  }
  if (url.pathname.startsWith("/src/")) {
    await sendStatic(response, url.pathname.slice(1));
    return;
  }
  if (["/", "/chat", "/workflow", "/template", "/debug"].includes(url.pathname)) {
    sendHtml(response, renderShell(url.pathname));
    return;
  }
  response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  response.end("Not found");
});

server.listen(port, () => {
  console.log(`ContextOS Studio dev server listening on http://localhost:${port}`);
  console.log(`Runtime mode: ${config.mockRuntime ? "mock" : "real"}`);
});

async function proxyHttp(request, response, baseUrl, path, options = {}) {
  const target = new URL(path, ensureTrailingSlash(baseUrl));
  let upstream;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers: forwardedHeaders(request),
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request,
      duplex: request.method === "GET" || request.method === "HEAD" ? undefined : "half",
    });
  } catch (error) {
    sendProxyUnavailable(response, target, error, options);
    return;
  }
  const headers = responseHeaders(upstream.headers, options);
  response.writeHead(upstream.status, headers);
  if (!upstream.body) {
    response.end();
    return;
  }
  for await (const chunk of upstream.body) {
    response.write(chunk);
  }
  response.end();
}

function sendProxyUnavailable(response, target, error, options) {
  const payload = {
    error: "runtime_proxy_unavailable",
    message: `Runtime request failed for ${target.href}`,
    cause: error?.cause?.code ?? error?.code ?? error?.message ?? "unknown",
  };
  if (options.sse) {
    response.writeHead(502, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "x-accel-buffering": "no",
    });
    response.end(`event: error\ndata: ${JSON.stringify(payload)}\n\n`);
    return;
  }
  response.writeHead(502, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

async function sendStatic(response, relativePath) {
  const target = normalize(join(root, relativePath));
  if (!target.startsWith(root)) {
    response.writeHead(403);
    response.end();
    return;
  }
  try {
    const content = await readFile(target);
    response.writeHead(200, { "content-type": contentType(target) });
    response.end(content);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

function sendJson(response, payload) {
  response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function sendHtml(response, body) {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(body);
}

function forwardedHeaders(request) {
  const headers = { ...request.headers };
  delete headers.host;
  return headers;
}

function responseHeaders(upstreamHeaders, options) {
  const headers = {};
  upstreamHeaders.forEach((value, key) => {
    headers[key] = value;
  });
  if (options.sse) {
    headers["content-type"] = "text/event-stream";
    headers["cache-control"] = "no-cache";
    headers["x-accel-buffering"] = "no";
  }
  return headers;
}

function ensureTrailingSlash(url) {
  return url.endsWith("/") ? url : `${url}/`;
}

function renderShell(pathname) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ContextOS Studio</title>
    <style>
      :root { color-scheme: light; font-family: Inter, "Segoe UI", Arial, sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; color: #172033; background: #f4f6f8; }
      button, input { font: inherit; }
    </style>
  </head>
  <body>
    <div id="app" data-initial-path="${pathname}"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>`;
}

function contentType(path) {
  if (extname(path) === ".js") {
    return "text/javascript; charset=utf-8";
  }
  return "text/plain; charset=utf-8";
}
