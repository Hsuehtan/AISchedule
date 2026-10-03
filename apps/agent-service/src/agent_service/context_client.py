"""Authenticated, deadline-bound reads from the fixed business service address."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

import httpx
from pydantic import ValidationError

from agent_service.errors import AgentServiceError
from agent_service.generated.internal_agent_v2 import (
    ContextReadRequest,
    ContextReadResponse,
    ContextResource,
    ExecuteRequest,
)


class ContextClient:
    def __init__(self, client: httpx.AsyncClient, base_url: str, service_token: str) -> None:
        self._client = client
        self._url = base_url.rstrip("/") + "/internal/v2/agent/context/read"
        self._token = service_token

    async def read(
        self,
        request: ExecuteRequest,
        resource: ContextResource,
        limit: int,
        cursor: str | None = None,
    ) -> ContextReadResponse:
        remaining = (request.deadline_at - datetime.now(UTC)).total_seconds()
        if remaining <= 0:
            raise AgentServiceError("CONTEXT_TIMEOUT", 504, "Context deadline expired")
        body = ContextReadRequest(
            requestId=request.request_id,
            resource=resource,
            limit=limit,
            cursor=cursor,
        )
        try:
            async with asyncio.timeout(remaining):
                async with self._client.stream(
                    "POST",
                    self._url,
                    json=body.model_dump(mode="json", by_alias=True),
                    headers={"authorization": f"Bearer {self._token}"},
                    timeout=remaining,
                ) as response:
                    response.raise_for_status()
                    data = bytearray()
                    async for chunk in response.aiter_bytes():
                        data.extend(chunk)
                        if len(data) > 262_144:
                            raise ValueError("Context page exceeds transport limit")
                    page = ContextReadResponse.model_validate_json(data)
                    if page.request_id != request.request_id or page.resource != resource:
                        raise ValueError("Mismatched context page")
                    if resource != "SOURCE" and len(page.messages) + len(page.candidates) > limit:
                        raise ValueError("Oversized context page")
                    return page
        except (TimeoutError, httpx.TimeoutException):
            raise AgentServiceError("CONTEXT_TIMEOUT", 504, "Context read timed out") from None
        except (httpx.HTTPError, ValidationError, ValueError):
            raise AgentServiceError("CONTEXT_UNAVAILABLE", 503, "Context read failed") from None
