from dataclasses import dataclass
from enum import Enum


class Transport(Enum):
    REST = "rest"
    SSE = "sse"
    WEBSOCKET = "websocket"


class OperationKind(Enum):
    CRUD = "crud"
    STATE_WRITE = "state_write"
    LLM_STREAM = "llm_stream"
    INTERRUPT_DEBUG = "interrupt_debug"


def transport_for_operation(operation_kind: OperationKind) -> Transport:
    if operation_kind is OperationKind.LLM_STREAM:
        return Transport.SSE
    if operation_kind is OperationKind.INTERRUPT_DEBUG:
        return Transport.WEBSOCKET
    return Transport.REST


@dataclass(frozen=True)
class RequestContext:
    request_id: str
    trace_id: str
    idempotency_key: str | None = None

    def trace_attributes(self) -> dict[str, str]:
        attributes = {
            "request_id": self.request_id,
            "trace_id": self.trace_id,
        }
        if self.idempotency_key is not None:
            attributes["idempotency_key"] = self.idempotency_key
        return attributes

