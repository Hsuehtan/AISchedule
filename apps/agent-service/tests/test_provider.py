from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest

from agent_service.config import ProviderProfile
from agent_service.errors import AgentServiceError
from agent_service.generated.internal_agent_v1 import ExecuteRequest
from agent_service.provider import DeepSeekProvider


def request(capability_code: str = "agent.standardTurn") -> ExecuteRequest:
    return ExecuteRequest.model_validate(
        {
            "contractVersion": "1.0",
            "requestId": "b52e72d5-bb52-48c4-b511-fd7dc8c0f166",
            "capabilityCode": capability_code,
            "deadlineAt": "2099-07-17T12:00:00Z",
            "locale": "zh-CN",
            "timezone": "Asia/Shanghai",
            "allowedResultTypes": ["REPLY" if capability_code.endswith("standardTurn") else "PLAN"],
            "messages": [{"role": "USER", "content": "帮我安排任务"}],
            "candidates": [],
        }
    )


STANDARD = ProviderProfile(
    model="deepseek-v4-flash",
    timeout_seconds=30,
    prompt_version="p0-v1",
    schema_version="p0-v1",
    thinking_enabled=False,
    reasoning_effort=None,
    temperature=0.2,
    max_tokens=2048,
)
PLAN = ProviderProfile(
    model="deepseek-v4-pro",
    timeout_seconds=60,
    prompt_version="p0-plan-v1",
    schema_version="p0-plan-v1",
    thinking_enabled=True,
    reasoning_effort="high",
    temperature=0.2,
    max_tokens=4096,
)


def deepseek_response(content: str, status_code: int = 200) -> httpx.Response:
    return httpx.Response(
        status_code,
        json={"choices": [{"message": {"content": content}}]},
    )


@pytest.mark.asyncio
async def test_standard_profile_uses_json_output_and_disabled_thinking() -> None:
    bodies: list[dict[str, Any]] = []

    def handler(provider_request: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(provider_request.content))
        return deepseek_response('{"type":"REPLY","text":"已收到","offerPlan":false}')

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = DeepSeekProvider(
            client=client,
            api_key="test-key",
            base_url="https://api.deepseek.invalid",
            standard_profile=STANDARD,
            plan_profile=PLAN,
        )
        result = await provider.execute(request())

    assert result.result.type == "REPLY"
    assert result.resolved.repair_attempts == 0
    assert len(bodies) == 1
    assert bodies[0]["model"] == "deepseek-v4-flash"
    assert bodies[0]["response_format"] == {"type": "json_object"}
    assert bodies[0]["thinking"] == {"type": "disabled"}
    assert bodies[0]["temperature"] == 0.2
    assert bodies[0]["max_tokens"] == 2048


@pytest.mark.asyncio
async def test_plan_profile_enables_thinking_and_high_reasoning_effort() -> None:
    captured: dict[str, Any] = {}

    def handler(provider_request: httpx.Request) -> httpx.Response:
        captured.update(json.loads(provider_request.content))
        return deepseek_response(
            '{"type":"PLAN","title":"面试准备","project":{"type":"NEW","name":"面试"},'
            '"tasks":[{"clientRef":"draft_0123456789abcdef","title":"梳理经历",'
            '"description":null,"priority":"MEDIUM","scheduledAt":null,'
            '"deadlineAt":null,"reminderAt":null}]}'
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = DeepSeekProvider(
            client=client,
            api_key="test-key",
            base_url="https://api.deepseek.invalid",
            standard_profile=STANDARD,
            plan_profile=PLAN,
        )
        result = await provider.execute(request("agent.planGeneration"))

    assert result.result.type == "PLAN"
    assert captured["model"] == "deepseek-v4-pro"
    assert captured["thinking"] == {"type": "enabled"}
    assert captured["reasoning_effort"] == "high"
    assert captured["max_tokens"] == 4096


@pytest.mark.asyncio
async def test_nonempty_invalid_output_gets_exactly_one_structure_repair() -> None:
    calls = 0

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if calls == 1:
            return deepseek_response('{"type":"REPLY","text":42}')
        return deepseek_response('{"type":"REPLY","text":"已修复","offerPlan":false}')

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = DeepSeekProvider(
            client=client,
            api_key="test-key",
            base_url="https://api.deepseek.invalid",
            standard_profile=STANDARD,
            plan_profile=PLAN,
        )
        result = await provider.execute(request())

    assert calls == 2
    assert result.resolved.repair_attempts == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("response", "expected_code"),
    [
        (deepseek_response(""), "PROVIDER_OUTPUT_INVALID"),
        (httpx.Response(429, text="provider-private-body"), "PROVIDER_RATE_LIMITED"),
        (httpx.Response(503, text="provider-private-body"), "PROVIDER_UNAVAILABLE"),
    ],
)
async def test_empty_or_http_failures_are_not_retried(
    response: httpx.Response, expected_code: str
) -> None:
    calls = 0

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return response

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = DeepSeekProvider(
            client=client,
            api_key="test-key",
            base_url="https://api.deepseek.invalid",
            standard_profile=STANDARD,
            plan_profile=PLAN,
        )
        with pytest.raises(AgentServiceError) as error:
            await provider.execute(request())

    assert calls == 1
    assert error.value.code == expected_code
    assert "provider-private-body" not in str(error.value)


@pytest.mark.asyncio
async def test_network_timeout_is_not_retried() -> None:
    calls = 0

    def handler(provider_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        raise httpx.ReadTimeout("private", request=provider_request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = DeepSeekProvider(
            client=client,
            api_key="test-key",
            base_url="https://api.deepseek.invalid",
            standard_profile=STANDARD,
            plan_profile=PLAN,
        )
        with pytest.raises(AgentServiceError) as error:
            await provider.execute(request())

    assert calls == 1
    assert error.value.code == "PROVIDER_TIMEOUT"


@pytest.mark.asyncio
async def test_expired_request_deadline_never_calls_the_provider() -> None:
    calls = 0

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return deepseek_response('{"type":"REPLY","text":"late","offerPlan":false}')

    expired_payload = request().model_dump(mode="json", by_alias=True)
    expired_payload["deadlineAt"] = "2020-01-01T00:00:00Z"
    expired = ExecuteRequest.model_validate(expired_payload)
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = DeepSeekProvider(
            client=client,
            api_key="test-key",
            base_url="https://api.deepseek.invalid",
            standard_profile=STANDARD,
            plan_profile=PLAN,
        )
        with pytest.raises(AgentServiceError) as error:
            await provider.execute(expired)

    assert calls == 0
    assert error.value.code == "PROVIDER_TIMEOUT"


class ChunkedResponseStream(httpx.AsyncByteStream):
    def __init__(self, chunks: list[bytes]) -> None:
        self.chunks = chunks
        self.consumed = 0

    async def __aiter__(self) -> AsyncIterator[bytes]:
        for chunk in self.chunks:
            self.consumed += 1
            yield chunk


@pytest.mark.asyncio
async def test_oversized_chunked_provider_response_is_stopped_and_rejected() -> None:
    chunk = b"x" * 8192
    stream = ChunkedResponseStream([chunk] * 10)

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, stream=stream)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = DeepSeekProvider(
            client=client,
            api_key="test-key",
            base_url="https://api.deepseek.invalid",
            standard_profile=STANDARD,
            plan_profile=PLAN,
        )
        with pytest.raises(AgentServiceError) as error:
            await provider.execute(request())

    assert error.value.code == "PROVIDER_OUTPUT_INVALID"
    assert stream.consumed < len(stream.chunks)
