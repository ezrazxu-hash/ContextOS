# ContextOS Studio Multi-client Boundary

ContextOS Studio is Web first, but reusable UI and client code must stay host independent. Runtime facts still come from the backend Runtime API. Host-specific browser capabilities are available only through `PlatformAdapter`.

## Capability Ownership

| Capability | Owner | Notes |
|---|---|---|
| clipboard | PlatformAdapter | Copy and paste text through the active host adapter. |
| storage | PlatformAdapter | UI-only preferences may persist here; Runtime facts must not. |
| openExternal | PlatformAdapter | External navigation is a host action, not Feature logic. |
| fileDialog | PlatformAdapter | File selection is owned by the active host. |
| notification | PlatformAdapter | User notifications are host capabilities. |

## Reusable UI Boundary

Reusable:

- Chat, Context, Workflow, Template, and Debug feature view models.
- `client-core` contracts, query keys, stream event normalization, and projection helpers.
- API clients that receive `baseUrl` from host configuration.

Web-only:

- Browser route/history integration.
- Development and production static servers.
- Browser implementations of `PlatformAdapter`.

## Host Configuration

The Web host injects Runtime API URLs through `CONTEXTOS_STUDIO_API_BASE_URL` and `CONTEXTOS_STUDIO_SSE_BASE_URL`, then exposes the resolved values via `/__contextos/config.json`. Business source must not hard-code `http://localhost` or a specific Runtime origin.

## Desktop Host

V1 does not require a Desktop build. V1 only requires this boundary document and automated checks that preserve future host reuse.

A future Desktop Host must provide:

- `readUiState` and `writeUiState`
- `readClipboardText` and `writeClipboardText`
- `openExternal`
- `selectFile`
- `notify`

Desktop must reuse the same Runtime API and `client-core` contracts. It must not copy or embed LangGraph Runtime business logic unless a later design explicitly introduces a local Runtime.
