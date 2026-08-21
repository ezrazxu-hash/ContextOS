from enum import Enum


class ContextItemType(Enum):
    MESSAGE = "MESSAGE"
    TOOL_CALL = "TOOL_CALL"
    TOOL_RESULT = "TOOL_RESULT"
    SUMMARY = "SUMMARY"
    MEMORY = "MEMORY"
    RESOURCE = "RESOURCE"
    SYSTEM = "SYSTEM"
    PLACEHOLDER = "PLACEHOLDER"


class ContextItemState(Enum):
    RAW = "RAW"
    ABSTRACT = "ABSTRACT"
    REFERENCE = "REFERENCE"
    EVICTED = "EVICTED"
    PINNED = "PINNED"

