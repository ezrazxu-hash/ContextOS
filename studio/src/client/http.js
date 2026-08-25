export class ClientError extends Error {
  constructor({ code, message, requestId, traceId, status }) {
    super(message);
    this.name = "ClientError";
    this.code = code;
    this.requestId = requestId;
    this.traceId = traceId;
    this.status = status;
  }
}

export class ClientAbortError extends Error {
  constructor(message = "Request aborted") {
    super(message);
    this.name = "ClientAbortError";
  }
}

export function createHttpClient({ baseUrl, fetchImpl = globalThis.fetch } = {}) {
  if (!baseUrl) {
    throw new Error("baseUrl is required");
  }

  return {
    async request(method, path, { body, signal, requestId, idempotencyKey, headers = {} } = {}) {
      try {
        const response = await fetchImpl(joinUrl(baseUrl, path), {
          method,
          signal,
          headers: requestHeaders({ body, headers, requestId, idempotencyKey }),
          body: body == null ? undefined : JSON.stringify(body),
        });
        const payload = await readJson(response);
        if (!response.ok) {
          throw toClientError(payload, response);
        }
        return payload;
      } catch (error) {
        if (error instanceof ClientError) {
          throw error;
        }
        if (error?.name === "AbortError" || signal?.aborted) {
          throw new ClientAbortError();
        }
        throw error;
      }
    },
  };
}

function requestHeaders({ body, headers, requestId, idempotencyKey }) {
  const nextHeaders = { ...headers };
  if (body != null) {
    nextHeaders["content-type"] = "application/json";
  }
  if (requestId) {
    nextHeaders["x-request-id"] = requestId;
  }
  if (idempotencyKey) {
    nextHeaders["idempotency-key"] = idempotencyKey;
  }
  return nextHeaders;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function toClientError(payload, response) {
  const error = payload?.error ?? {};
  return new ClientError({
    code: error.code ?? `http.${response.status}`,
    message: error.message ?? "Runtime request failed",
    requestId: error.request_id ?? error.requestId ?? null,
    traceId: error.trace_id ?? error.traceId ?? header(response, "x-contextos-trace-id") ?? null,
    status: error.status ?? response.status,
  });
}

function header(response, name) {
  return response.headers?.get?.(name) ?? null;
}

function joinUrl(baseUrl, path) {
  return `${baseUrl.replace(/\/$/, "")}/${String(path).replace(/^\//, "")}`;
}
