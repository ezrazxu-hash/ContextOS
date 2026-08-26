# ContextOS Studio

## Development

Install dependencies from the `studio` directory or with `npm --prefix studio install`.

Start with the mock Runtime:

```powershell
npm run dev:mock
```

Start against a real Runtime:

```powershell
$env:CONTEXTOS_STUDIO_API_BASE_URL="http://localhost:8000"
$env:CONTEXTOS_STUDIO_SSE_BASE_URL="http://localhost:8000"
$env:CONTEXTOS_STUDIO_WS_BASE_URL=""
npm run dev:real
```

The default development command is:

```powershell
npm run dev
```

It starts the Studio web server in mock mode and does not require an LLM key.

Available routes:

- `/chat`
- `/workflow`
- `/template`
- `/debug`

Runtime mode is controlled only through environment variables. The web client talks to the Runtime through API and SSE base URLs; it does not import backend source code.

## Runtime Proxy

The dev server exposes same-origin proxy routes:

- `/api/*` forwards REST requests to `CONTEXTOS_STUDIO_API_BASE_URL`
- `/sse/*` forwards SSE requests to `CONTEXTOS_STUDIO_SSE_BASE_URL` with buffering disabled
- `/ws/*` is reserved for future debug WebSocket traffic and returns a clear disabled response when `CONTEXTOS_STUDIO_WS_BASE_URL` is empty

Production reverse proxy rules are documented in `deploy/nginx.conf`.

## Production Build

Create the static bundle:

```powershell
npm run build
```

Preview the built bundle with history fallback:

```powershell
npm run preview
```

The generated `dist` directory contains only static web assets. Runtime remains a separate deployment reached through REST, SSE, and optional WS proxy rules.
