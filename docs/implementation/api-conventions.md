# ContextOS V1 API Conventions

This document records the M00-T04 API boundary decisions. It defines transport and request metadata conventions only; endpoint behavior is implemented by later tasks.

## Transport Rules

| Operation | Transport | Rule |
|---|---|---|
| CRUD / state operations use REST | REST | Create, read, update, and state-changing operations use REST endpoints. |
| LLM streaming uses SSE | SSE | Model token streaming is sent as server-sent events. |
| WebSocket is reserved for Interrupt/debug control | WebSocket | Bidirectional transport is introduced only for Interrupt or debug control flows that need it. |

## Request Metadata

Every externally initiated operation has a `request_id`. Agent execution and API handling attach that `request_id` to Trace metadata through `RequestContext.trace_attributes()`.

Replay, Restore, and Checkpoint writes require idempotency_key. Repeating the same write with the same `idempotency_key` must return the first result instead of performing a second write.

## Error Shape

REST and SSE expose the same logical error payload:

```json
{
  "error": {
    "code": "context.missing",
    "message": "Context group not found",
    "request_id": "req-1",
    "status": 404
  }
}
```

For SSE, the payload is carried in an `error` event so clients can parse REST and SSE failures with one contract.
