from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

ErrorCode = Literal[
    "UNAUTHORIZED",
    "REQUEST_TOO_LARGE",
    "VALIDATION_ERROR",
    "CONCURRENCY_LIMIT",
    "PROVIDER_UNAVAILABLE",
    "PROVIDER_TIMEOUT",
    "PROVIDER_RATE_LIMITED",
    "PROVIDER_OUTPUT_INVALID",
    "INTERNAL_ERROR",
]


@dataclass
class AgentServiceError(Exception):
    code: ErrorCode
    status_code: int
    message: str

    def __str__(self) -> str:
        return self.message
