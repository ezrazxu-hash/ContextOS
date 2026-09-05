import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\tests$/, "");

function moduleUrl(relativePath) {
  return pathToFileURL(join(studioRoot, relativePath)).href;
}

test("UI02-T01 ClientError distinguishes 401 409 422 and 500", async () => {
  const { createHttpClient, ClientError } = await import(moduleUrl("src/client/http.js"));
  const statuses = [401, 409, 422, 500];
  const seen = [];
  const client = createHttpClient({
    baseUrl: "http://runtime.test/api",
    fetchImpl: async () => fakeResponse({
      ok: false,
      status: statuses[seen.length],
      body: {
        error: {
          code: `error.${statuses[seen.length]}`,
          message: `failed ${statuses[seen.length]}`,
          request_id: `req-${statuses[seen.length]}`,
          status: statuses[seen.length],
        },
      },
    }),
  });

  for (const status of statuses) {
    await assert.rejects(
      async () => client.request("GET", `/sessions/session-${status}`),
      (error) => {
        seen.push(error.status);
        assert.ok(error instanceof ClientError);
        assert.equal(error.status, status);
        assert.equal(error.code, `error.${status}`);
        assert.equal(error.requestId, `req-${status}`);
        return true;
      },
    );
  }

  assert.deepEqual(seen, statuses);
});

test("UI02-T01 AbortController cancels a request that is obsolete after navigation", async () => {
  const { createHttpClient, ClientAbortError } = await import(moduleUrl("src/client/http.js"));
  const controller = new AbortController();
  const client = createHttpClient({
    baseUrl: "http://runtime.test/api",
    fetchImpl: async (_url, options) => {
      controller.abort();
      assert.equal(options.signal.aborted, true);
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    },
  });

  await assert.rejects(
    () => client.request("GET", "/sessions/session-a", { signal: controller.signal }),
    (error) => error instanceof ClientAbortError && error.name === "ClientAbortError",
  );
});

test("UI02-T01 errors retain server trace_id and request headers include ids", async () => {
  const { createHttpClient } = await import(moduleUrl("src/client/http.js"));
  const calls = [];
  const client = createHttpClient({
    baseUrl: "http://runtime.test/api",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return fakeResponse({
        ok: false,
        status: 500,
        body: {
          error: {
            code: "runtime.failed",
            message: "Runtime failed",
            request_id: "req-500",
            trace_id: "trace-500",
            status: 500,
          },
        },
      });
    },
  });

  await assert.rejects(
    () => client.request("POST", "/messages/message-a/replay", {
      body: { mode: "same_tools" },
      requestId: "req-client",
      idempotencyKey: "idem-replay",
    }),
    (error) => {
      assert.equal(error.traceId, "trace-500");
      return true;
    },
  );

  assert.equal(calls[0].url, "http://runtime.test/api/messages/message-a/replay");
  assert.equal(calls[0].options.headers["x-request-id"], "req-client");
  assert.equal(calls[0].options.headers["idempotency-key"], "idem-replay");
});

test("T11 HTTP client downloads workflow artifact bytes with mime type", async () => {
  const { createHttpClient } = await import(moduleUrl("src/client/http.js"));
  const client = createHttpClient({
    baseUrl: "http://runtime.test/api",
    fetchImpl: async (url, options) => {
      assert.equal(url, "http://runtime.test/api/workflow-artifacts/artifact_1/content");
      assert.equal(options.method, "GET");
      return fakeBinaryResponse({ ok: true, status: 200, body: "hello artifact", contentType: "text/plain" });
    },
  });

  const downloaded = await client.download("/workflow-artifacts/artifact_1/content");

  assert.equal(downloaded.mimeType, "text/plain");
  assert.deepEqual(Array.from(downloaded.body), Array.from(new TextEncoder().encode("hello artifact")));
}
);

test("UI02-T01 pages and feature components do not directly concatenate API URLs", () => {
  const roots = [join(studioRoot, "src/pages"), join(studioRoot, "src/features")];
  for (const file of roots.flatMap(listFiles).filter((path) => path.endsWith(".js"))) {
    const source = readFileSync(file, "utf-8");
    assert.doesNotMatch(source, /\/api\//);
    assert.doesNotMatch(source, /http:\/\/localhost/);
  }
});

function fakeResponse({ ok, status, body }) {
  return {
    ok,
    status,
    async json() {
      return body;
    },
  };
}

function fakeBinaryResponse({ ok, status, body, contentType }) {
  const bytes = new TextEncoder().encode(body);
  return {
    ok,
    status,
    headers: {
      get(name) {
        return name.toLowerCase() === "content-type" ? contentType : null;
      },
    },
    async json() {
      return null;
    },
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(fullPath) : [fullPath];
  });
}
