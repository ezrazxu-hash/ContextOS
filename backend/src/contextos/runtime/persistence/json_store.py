from __future__ import annotations

import json
import os
from copy import deepcopy
from pathlib import Path
from threading import RLock
from typing import Any


class JsonRuntimeStore:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self._lock = RLock()
        self.loaded_existing_state = self.path.exists()
        self._data = self._load()

    def list_records(self, collection: str) -> list[dict[str, Any]]:
        with self._lock:
            return [deepcopy(item) for item in self._data.setdefault(collection, {}).values()]

    def get_record(self, collection: str, record_id: str) -> dict[str, Any] | None:
        with self._lock:
            item = self._data.setdefault(collection, {}).get(record_id)
            return deepcopy(item) if item is not None else None

    def save_record(self, collection: str, record_id: str, record: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            self._data.setdefault(collection, {})[record_id] = deepcopy(record)
            self._flush()
            return deepcopy(record)

    def remove_record(self, collection: str, record_id: str) -> dict[str, Any] | None:
        with self._lock:
            removed = self._data.setdefault(collection, {}).pop(record_id, None)
            if removed is not None:
                self._flush()
            return deepcopy(removed) if removed is not None else None

    def remove_records_where(self, collection: str, predicate) -> int:
        with self._lock:
            records = self._data.setdefault(collection, {})
            record_ids = [record_id for record_id, record in records.items() if predicate(record)]
            for record_id in record_ids:
                records.pop(record_id, None)
            if record_ids:
                self._flush()
            return len(record_ids)

    def is_empty(self) -> bool:
        with self._lock:
            return all(not values for values in self._data.values())

    def _load(self) -> dict[str, dict[str, Any]]:
        if not self.path.exists():
            return _empty_state()
        with self.path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        state = _empty_state()
        for key in state:
            if isinstance(data.get(key), dict):
                state[key] = data[key]
        return state

    def _flush(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = self.path.with_suffix(f"{self.path.suffix}.tmp")
        with temp_path.open("w", encoding="utf-8") as handle:
            json.dump(self._data, handle, ensure_ascii=False, sort_keys=True, indent=2)
        os.replace(temp_path, self.path)


def _empty_state() -> dict[str, dict[str, Any]]:
    return {
        "sessions": {},
        "timelines": {},
        "messages": {},
        "conversation_groups": {},
        "checkpoints": {},
        "templates": {},
        "agent_versions": {},
    }
