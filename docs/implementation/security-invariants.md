# ContextOS V1 Security Invariants

This document records V1 safety gates that must stay true during implementation.

## Restore Source Metadata

Restored or externally sourced context must expose source metadata in backend DTOs:

- `source.ids`
- `source.type`
- `source.trust`

External sources are marked `type=external` and `trust=unverified`.

## Replay Safety

Unknown tools default to `WRITE` and require explicit confirmation before replay. High-risk replay rejection responses include a reason such as `confirmation_required`.

## Provider Boundary

Provider calls must pass through `ContextCompiler`. The provider gateway accepts only `CompileResult` and sends only compiler-produced `provider_payload`.

## No Physical Delete

V1 does not expose physical delete or purge business APIs. History changes are represented through revisions, timelines, state transitions, and placeholders.
