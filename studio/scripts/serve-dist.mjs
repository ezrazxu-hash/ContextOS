import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist");
const port = Number(process.env.CONTEXTOS_STUDIO_PORT ?? 4173);
const config = {
  apiBaseUrl: process.env.CONTEXTOS_STUDIO_API_BASE_URL ?? "http://localhost:8000",
  sseBaseUrl: process.env.CONTEXTOS_STUDIO_SSE_BASE_URL ?? "http://localhost:8000",
  wsBaseUrl: process.env.CONTEXTOS_STUDIO_WS_BASE_URL ?? "",
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (url.pathname === "/__contextos/config.json") {
    sendJson(response, config);
    return;
  }
  await sendStaticOrFallback(response, url.pathname);
});

server.listen(port, () => {
  console.log(`ContextOS Studio production preview listening on http://localhost:${port}`);
});

async function sendStaticOrFallback(response, pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  const target = normalize(join(dist, relative));
  const safeTarget = target.startsWith(dist) ? target : join(dist, "index.html");
  try {
    const content = await readFile(safeTarget);
    response.writeHead(200, { "content-type": contentType(safeTarget) });
    response.end(content);
  } catch {
    const index = await readFile(join(dist, "index.html"));
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(index);
  }
}

function sendJson(response, payload) {
  response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function contentType(path) {
  if (extname(path) === ".html") {
    return "text/html; charset=utf-8";
  }
  if (extname(path) === ".js") {
    return "text/javascript; charset=utf-8";
  }
  return "application/octet-stream";
}
