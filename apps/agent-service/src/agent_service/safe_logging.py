from __future__ import annotations

import json
import sys
from collections.abc import Callable, Mapping
from typing import Any, TextIO

ALLOWED_FIELDS = frozenset(
    {
        "event",
        "requestId",
        "status",
        "resultType",
        "provider",
        "model",
        "durationMs",
        "repairAttempts",
        "errorCode",
    }
)


class SafeJsonLogger:
    def __init__(
        self,
        stream: TextIO = sys.stdout,
        serializer: Callable[[Mapping[str, Any]], str] = lambda value: json.dumps(
            value, ensure_ascii=False, separators=(",", ":")
        ),
    ) -> None:
        self._stream = stream
        self._serializer = serializer

    def emit(self, **fields: Any) -> None:
        try:
            safe = {key: value for key, value in fields.items() if key in ALLOWED_FIELDS}
            self._stream.write(self._serializer(safe) + "\n")
            self._stream.flush()
        except Exception:  # Logging is deliberately non-authoritative and fail-open.
            return
