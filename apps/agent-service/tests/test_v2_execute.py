import json
from typing import Any

import httpx
import pytest
from test_context_client import request
from test_provider import PLAN, STANDARD, deepseek_response

from agent_service.context_client import ContextClient
from agent_service.orchestrator import ContextAgentOrchestrator
from agent_service.provider import DeepSeekProvider


@pytest.mark.parametrize("repair", [False, True])
async def test_v2_reads_context_and_shares_provider_repair_budget(repair: bool) -> None:
    descriptor = request()
    provider_calls = 0
    context_calls = 0
    observed: list[dict[str, Any]] = []

    def handle(req: httpx.Request) -> httpx.Response:
        nonlocal provider_calls, context_calls
        body = json.loads(req.content)
        if req.url.host == "business":
            context_calls += 1
            resource = body["resource"]
            return httpx.Response(
                200,
                json={
                    "requestId": str(descriptor.request_id),
                    "resource": resource,
                    "source": {"kind": "PLAN", "instruction": None, "previousDraft": None}
                    if resource == "SOURCE"
                    else None,
                    "messages": [{"role": "USER", "content": "合成测试消息😀"}]
                    if resource == "MESSAGES"
                    else [],
                    "candidates": [],
                    "nextCursor": None,
                },
            )
        provider_calls += 1
        observed.append(body)
        if repair and provider_calls == 1:
            return deepseek_response('{"type":"REPLY","unexpected":true}')
        return deepseek_response('{"type":"REPLY","text":"合成响应","offerPlan":false}')

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as http:
        provider = DeepSeekProvider(
            client=http,
            api_key="synthetic",
            base_url="https://model.invalid",
            standard_profile=STANDARD,
            plan_profile=PLAN,
        )
        response = await ContextAgentOrchestrator(
            provider, ContextClient(http, "http://business", "context-token")
        ).execute(descriptor)
    assert response.contract_version == "2.0"
    assert response.resolved.repair_attempts == int(repair)
    assert provider_calls == 1 + int(repair)
    assert context_calls == 4
    assert "请基于上文生成可执行计划" in observed[0]["messages"][0]["content"]
    assert "合成测试消息😀" in observed[0]["messages"][1]["content"]
