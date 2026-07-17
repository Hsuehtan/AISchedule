from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import httpx
import pytest

from agent_service.app import create_app
from agent_service.config import Settings
from agent_service.errors import AgentServiceError
from agent_service.generated.internal_agent_v1 import ExecuteResponse

VALID_TOKEN = "c3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3M"
REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
POLICY_BOUNDARIES: dict[str, Any] = json.loads(
    (
        REPOSITORY_ROOT
        / "packages/contracts/internal-agent/v1/fixtures/request-policy-boundaries.json"
    ).read_text(encoding="utf-8")
)
VALID_REQUEST: dict[str, Any] = {
    "contractVersion": "1.0",
    "requestId": "b52e72d5-bb52-48c4-b511-fd7dc8c0f166",
    "capabilityCode": "agent.standardTurn",
    "deadlineAt": "2026-07-17T12:00:00Z",
    "locale": "zh-CN",
    "timezone": "Asia/Shanghai",
    "allowedResultTypes": ["REPLY"],
    "messages": [{"role": "USER", "content": "你好"}],
    "candidates": [],
}


class StubOrchestrator:
    async def execute(self, request: Any) -> ExecuteResponse:
        return ExecuteResponse.model_validate(
            {
                "contractVersion": "1.0",
                "requestId": str(request.request_id),
                "resolved": {
                    "provider": "DEEPSEEK",
                    "model": "deepseek-v4-flash",
                    "promptVersion": "p0-v1",
                    "providerSchemaVersion": "p0-v1",
                    "repairAttempts": 0,
                },
                "result": {"type": "REPLY", "text": "已收到", "offerPlan": False},
            }
        )


def settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "service_token": VALID_TOKEN,
        "deepseek_api_key": "test-deepseek-key",
        "deepseek_base_url": "https://api.deepseek.invalid",
        "max_body_bytes": 262_144,
        "max_concurrency": 4,
        "production": True,
    }
    values.update(overrides)
    return Settings(**values)


@asynccontextmanager
async def client_for(app: Any) -> AsyncIterator[httpx.AsyncClient]:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://agent.internal"
    ) as client:
        yield client


@pytest.mark.asyncio
async def test_health_is_public_but_production_docs_are_disabled() -> None:
    app = create_app(settings(), StubOrchestrator())

    async with client_for(app) as client:
        assert (await client.get("/internal/health/live")).json() == {"status": "ok"}
        assert (await client.get("/docs")).status_code == 404
        assert (await client.get("/openapi.json")).status_code == 404


@pytest.mark.asyncio
async def test_default_provider_client_is_closed_by_application_lifespan() -> None:
    app = create_app(settings())
    provider_client: httpx.AsyncClient = app.state.provider_http_client

    async with app.router.lifespan_context(app):
        assert not provider_client.is_closed

    assert provider_client.is_closed


@pytest.mark.asyncio
async def test_execute_requires_exact_bearer_service_token() -> None:
    app = create_app(settings(), StubOrchestrator())

    async with client_for(app) as client:
        response = await client.post("/internal/v1/agent/execute", json=VALID_REQUEST)

    assert response.status_code == 401
    assert response.json() == {
        "error": {
            "code": "UNAUTHORIZED",
            "message": "Service authentication failed",
            "requestId": None,
        }
    }


@pytest.mark.asyncio
async def test_non_ascii_bearer_token_returns_unauthorized_without_crashing() -> None:
    app = create_app(settings(), StubOrchestrator())

    async with client_for(app) as client:
        response = await client.post(
            "/internal/v1/agent/execute",
            headers=[(b"authorization", "Bearer é".encode())],
            json=VALID_REQUEST,
        )

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_execute_rejects_bodies_larger_than_256_kib_before_validation() -> None:
    app = create_app(settings(), StubOrchestrator())
    headers = {"Authorization": f"Bearer {VALID_TOKEN}", "Content-Type": "application/json"}

    async with client_for(app) as client:
        response = await client.post(
            "/internal/v1/agent/execute",
            headers=headers,
            content=b'{"padding":"' + (b"x" * 262_144) + b'"}',
        )

    assert response.status_code == 413
    assert response.json()["error"]["code"] == "REQUEST_TOO_LARGE"


@pytest.mark.asyncio
async def test_validation_errors_use_stable_non_verbose_envelope() -> None:
    app = create_app(settings(), StubOrchestrator())
    headers = {"Authorization": f"Bearer {VALID_TOKEN}"}

    async with client_for(app) as client:
        response = await client.post(
            "/internal/v1/agent/execute", headers=headers, json={"requestId": "not-a-uuid"}
        )

    assert response.status_code == 422
    assert response.json() == {
        "error": {
            "code": "VALIDATION_ERROR",
            "message": "Request does not satisfy the internal contract",
            "requestId": None,
        }
    }


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "changes",
    [
        {
            "candidates": [
                {
                    "candidateRef": "cand_11111111111111111111111111111111",
                    "kind": "TASK",
                    "label": "任务一",
                    "version": 1,
                },
                {
                    "candidateRef": "cand_11111111111111111111111111111111",
                    "kind": "TASK",
                    "label": "任务二",
                    "version": 2,
                },
            ]
        },
    ],
    ids=["duplicate-candidate-ref"],
)
async def test_semantic_context_limits_are_rejected_before_inference(
    changes: dict[str, Any],
) -> None:
    called = False

    class RecordingOrchestrator(StubOrchestrator):
        async def execute(self, request: Any) -> ExecuteResponse:
            nonlocal called
            called = True
            return await super().execute(request)

    app = create_app(settings(), RecordingOrchestrator())
    headers = {"Authorization": f"Bearer {VALID_TOKEN}"}

    async with client_for(app) as client:
        response = await client.post(
            "/internal/v1/agent/execute",
            headers=headers,
            json={**VALID_REQUEST, **changes},
        )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert called is False


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "case",
    POLICY_BOUNDARIES["messageContentCases"],
    ids=lambda case: str(case["name"]),
)
async def test_message_content_byte_boundaries_use_shared_contract_corpus(
    case: dict[str, Any],
) -> None:
    messages = [
        {
            "role": chunk["role"],
            "content": (str(chunk["unit"]) * int(chunk["repeat"])) + str(chunk["suffix"]),
        }
        for chunk in case["messages"]
    ]
    assert sum(len(message["content"].encode()) for message in messages) == case["expectedBytes"]
    app = create_app(settings(), StubOrchestrator())
    headers = {"Authorization": f"Bearer {VALID_TOKEN}"}

    async with client_for(app) as client:
        response = await client.post(
            "/internal/v1/agent/execute",
            headers=headers,
            json={**VALID_REQUEST, "messages": messages},
        )

    assert response.status_code == (200 if case["accepted"] else 422)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "case",
    POLICY_BOUNDARIES["candidateKindCases"],
    ids=lambda case: str(case["name"]),
)
async def test_candidate_kind_boundaries_use_shared_contract_corpus(
    case: dict[str, Any],
) -> None:
    task_count = int(case["tasks"])
    project_count = int(case["projects"])
    candidates = [
        {
            "candidateRef": f"cand_{index:032x}",
            "kind": "TASK" if index < task_count else "PROJECT",
            "label": f"候选 {index}",
            "version": 1,
        }
        for index in range(task_count + project_count)
    ]
    app = create_app(settings(), StubOrchestrator())
    headers = {"Authorization": f"Bearer {VALID_TOKEN}"}

    async with client_for(app) as client:
        response = await client.post(
            "/internal/v1/agent/execute",
            headers=headers,
            json={**VALID_REQUEST, "candidates": candidates},
        )

    assert response.status_code == (200 if case["accepted"] else 422)


@pytest.mark.asyncio
async def test_provider_errors_are_mapped_without_leaking_provider_bodies() -> None:
    class FailingOrchestrator:
        async def execute(self, request: Any) -> ExecuteResponse:
            raise AgentServiceError(
                code="PROVIDER_RATE_LIMITED", status_code=502, message="safe message"
            )

    app = create_app(settings(), FailingOrchestrator())
    headers = {"Authorization": f"Bearer {VALID_TOKEN}"}

    async with client_for(app) as client:
        response = await client.post(
            "/internal/v1/agent/execute", headers=headers, json=VALID_REQUEST
        )

    assert response.status_code == 502
    assert response.json()["error"] == {
        "code": "PROVIDER_RATE_LIMITED",
        "message": "safe message",
        "requestId": VALID_REQUEST["requestId"],
    }


@pytest.mark.asyncio
async def test_http_response_preserves_sparse_update_task_changes() -> None:
    candidate_ref = "cand_0123456789abcdef0123456789abcdef"

    class SparseUpdateOrchestrator:
        async def execute(self, request: Any) -> ExecuteResponse:
            return ExecuteResponse.model_validate(
                {
                    "contractVersion": "1.0",
                    "requestId": str(request.request_id),
                    "resolved": {
                        "provider": "DEEPSEEK",
                        "model": "deepseek-v4-flash",
                        "promptVersion": "p0-v1",
                        "providerSchemaVersion": "p0-v1",
                        "repairAttempts": 0,
                    },
                    "result": {
                        "type": "ACTION_PROPOSAL",
                        "actionCode": "UPDATE_TASK",
                        "summary": "只修改截止时间",
                        "mutations": [
                            {
                                "operation": "UPDATE_TASK",
                                "targetRef": candidate_ref,
                                "expectedVersion": 3,
                                "changes": {"deadlineAt": "2026-07-20T12:00:00Z"},
                            }
                        ],
                    },
                }
            )

    app = create_app(settings(), SparseUpdateOrchestrator())
    headers = {"Authorization": f"Bearer {VALID_TOKEN}"}
    request = {
        **VALID_REQUEST,
        "allowedResultTypes": ["ACTION_PROPOSAL"],
        "candidates": [
            {
                "candidateRef": candidate_ref,
                "kind": "TASK",
                "label": "写周报",
                "version": 3,
            }
        ],
    }

    async with client_for(app) as client:
        response = await client.post("/internal/v1/agent/execute", headers=headers, json=request)

    assert response.status_code == 200
    changes = response.json()["result"]["mutations"][0]["changes"]
    assert changes == {"deadlineAt": "2026-07-20T12:00:00Z"}


@pytest.mark.asyncio
async def test_unexpected_errors_use_a_generic_non_leaking_envelope() -> None:
    class BrokenOrchestrator:
        async def execute(self, request: Any) -> ExecuteResponse:
            raise RuntimeError("private stack and prompt")

    app = create_app(settings(), BrokenOrchestrator())
    headers = {"Authorization": f"Bearer {VALID_TOKEN}"}

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://agent.internal",
    ) as client:
        response = await client.post(
            "/internal/v1/agent/execute", headers=headers, json=VALID_REQUEST
        )

    assert response.status_code == 500
    assert response.json()["error"] == {
        "code": "INTERNAL_ERROR",
        "message": "Agent service failed",
        "requestId": VALID_REQUEST["requestId"],
    }
    assert "private" not in response.text


@pytest.mark.asyncio
async def test_concurrency_limit_fails_fast_without_queueing_a_fifth_request() -> None:
    entered = asyncio.Event()
    release = asyncio.Event()
    active = 0

    class BlockingOrchestrator(StubOrchestrator):
        async def execute(self, request: Any) -> ExecuteResponse:
            nonlocal active
            active += 1
            if active == 4:
                entered.set()
            await release.wait()
            return await super().execute(request)

    app = create_app(settings(max_concurrency=4), BlockingOrchestrator())
    headers = {"Authorization": f"Bearer {VALID_TOKEN}"}

    async with client_for(app) as client:
        tasks = [
            asyncio.create_task(
                client.post(
                    "/internal/v1/agent/execute",
                    headers=headers,
                    json={**VALID_REQUEST, "requestId": f"00000000-0000-4000-8000-{index:012d}"},
                )
            )
            for index in range(4)
        ]
        await asyncio.wait_for(entered.wait(), timeout=1)
        overflow = await client.post(
            "/internal/v1/agent/execute",
            headers=headers,
            json={**VALID_REQUEST, "requestId": "00000000-0000-4000-8000-999999999999"},
        )
        release.set()
        completed = await asyncio.gather(*tasks)

    assert overflow.status_code == 429
    assert overflow.json()["error"]["code"] == "CONCURRENCY_LIMIT"
    assert [response.status_code for response in completed] == [200, 200, 200, 200]
