from datetime import UTC, datetime, timedelta
from uuid import uuid4

import httpx
import pytest

from agent_service.context_client import ContextClient
from agent_service.errors import AgentServiceError
from agent_service.generated.internal_agent_v2 import ExecuteRequest


def request() -> ExecuteRequest:
    return ExecuteRequest.model_validate(
        {
            "contractVersion": "2.0",
            "requestId": str(uuid4()),
            "capabilityCode": "agent.standardTurn",
            "deadlineAt": (datetime.now(UTC) + timedelta(seconds=30)).isoformat(),
            "locale": "zh-CN",
            "timezone": "Asia/Shanghai",
            "allowedResultTypes": ["REPLY"],
        }
    )


async def test_reads_fixed_authenticated_address_without_algorithm_cap() -> None:
    descriptor = request()

    def handle(req: httpx.Request) -> httpx.Response:
        assert str(req.url) == "http://business/internal/v2/agent/context/read"
        assert req.headers["authorization"] == "Bearer context-token"
        assert b'"limit":100' in req.content
        return httpx.Response(
            200,
            json={
                "requestId": str(descriptor.request_id),
                "resource": "TASKS",
                "source": None,
                "messages": [],
                "candidates": [],
                "nextCursor": "opaque",
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as http:
        page = await ContextClient(http, "http://business", "context-token").read(
            descriptor, "TASKS", 100
        )
    assert page.next_cursor == "opaque"


@pytest.mark.parametrize("status", [401, 409, 500])
async def test_context_failure_is_stable_and_not_retried(status: int) -> None:
    calls = 0

    def handle(_: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(status, text="private body")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as http:
        with pytest.raises(AgentServiceError, match="Context read failed") as error:
            await ContextClient(http, "http://business", "context-token").read(
                request(), "SOURCE", 1
            )
    assert error.value.code == "CONTEXT_UNAVAILABLE"
    assert calls == 1


async def test_expired_budget_does_not_read() -> None:
    descriptor = request().model_copy(
        update={"deadline_at": datetime.now(UTC) - timedelta(seconds=1)}
    )
    async with httpx.AsyncClient() as http:
        with pytest.raises(AgentServiceError) as error:
            await ContextClient(http, "http://business", "context-token").read(
                descriptor, "SOURCE", 1
            )
    assert error.value.code == "CONTEXT_TIMEOUT"
