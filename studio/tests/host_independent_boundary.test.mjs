import { existsSync, readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\tests$/, "");
const repoRoot = dirname(studioRoot);
const srcRoot = join(studioRoot, "src");
const boundaryDocPath = join(repoRoot, "docs/ui/multi-client-boundary.md");

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(fullPath) : [fullPath];
  });
}

test("UI10-T03-TC01: multi-client boundary doc maps browser capabilities to PlatformAdapter", () => {
  assert.ok(existsSync(boundaryDocPath), "missing multi-client boundary document");
  const doc = readFileSync(boundaryDocPath, "utf-8");

  for (const capability of ["clipboard", "storage", "openExternal", "fileDialog", "notification"]) {
    assert.match(doc, new RegExp(`\\|\\s*${capability}\\s*\\|\\s*PlatformAdapter`, "i"));
  }
  assert.match(doc, /Desktop Host/i);
  assert.match(doc, /Runtime API/i);
});

test("UI10-T03-TC02: business source has no hard-coded localhost Runtime URLs", () => {
  const businessFiles = ["app", "client", "client-core", "features", "pages"]
    .flatMap((scope) => listFiles(join(srcRoot, scope)))
    .filter((file) => file.endsWith(".js"));

  for (const file of businessFiles) {
    const source = readFileSync(file, "utf-8");
    assert.doesNotMatch(source, /https?:\/\/(?:localhost|127\.0\.0\.1)/, file);
  }
});

test("UI10-T03-TC03: API base URL is injected by host configuration", () => {
  const devServer = readFileSync(join(studioRoot, "scripts/dev-server.mjs"), "utf-8");
  const previewServer = readFileSync(join(studioRoot, "scripts/serve-dist.mjs"), "utf-8");
  const httpClient = readFileSync(join(srcRoot, "client/http.js"), "utf-8");

  assert.match(devServer, /CONTEXTOS_STUDIO_API_BASE_URL/);
  assert.match(devServer, /__contextos\/config\.json/);
  assert.match(previewServer, /CONTEXTOS_STUDIO_API_BASE_URL/);
  assert.match(previewServer, /__contextos\/config\.json/);
  assert.match(httpClient, /baseUrl is required/);
});
