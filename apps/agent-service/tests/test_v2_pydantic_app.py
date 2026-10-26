"""Exercise the production v2 FastAPI route with the Pydantic runtime."""

from __future__ import annotations

import base64
import json
from typing import Any

import httpx
import pytest
from pydantic_ai import ModelResponse, ToolCallPart, models
from pydantic_ai.models.function import AgentInfo, FunctionModel

from agent_service.app import create_app
from agent_service.config import Settings
from agent_service.context_client import ContextClient

models.ALLOW_MODEL_REQUESTS = False
TOKEN = base64.urlsafe_b64encode(b"s" * 32).rstrip(b"=").decode()
OTHER_TOKEN = base64.urlsafe_b64encode(b"t" * 32).rstrip(b"=").decode()
REQUEST_ID = "b52e72d5-bb52-48c4-b511-fd7dc8c0f166"


@pytest.mark.asyncio
async def test_v2_http_reads_authorized_context_and_returns_typed_result() -> None:
    resources: list[str] = []

    def context_response(req: httpx.Request) -> httpx.Response:
        assert req.headers["authorization"] == f"Bearer {OTHER_TOKEN}"
        body = json.loads(req.content)
        resource = body["resource"]
        resources.append(resource)
        return httpx.Response(
            200,
            json={
                "requestId": REQUEST_ID,
                "resource": resource,
                "source": {"kind": "TURN", "instruction": "帮我安排今天", "previousDraft": None}
                if resource == "SOURCE"
                else None,
                "messages": [{"role": "USER", "content": "帮我安排今天"}]
                if resource == "MESSAGES"
                else [],
                "candidates": [],
                "nextCursor": None,
            },
        )

    def model_response(_: Any, info: AgentInfo) -> ModelResponse:
        return ModelResponse(
            parts=[
                ToolCallPart(
                    info.output_tools[0].name,
                    {"type": "REPLY", "text": "先处理今天最重要的事", "offerPlan": False},
                )
            ]
        )

    settings = Settings(
        service_token=TOKEN,
        context_service_token=OTHER_TOKEN,
        context_url="http://business.internal",
        deepseek_api_key="synthetic-key",
        production=True,
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(context_response)) as business:
        app = create_app(
            settings,
            model=FunctionModel(model_response),
            context_client=ContextClient(business, settings.context_url, OTHER_TOKEN),
        )
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://agent.internal"
        ) as agent:
            result = await agent.post(
                "/internal/v2/agent/execute",
                headers={"authorization": f"Bearer {TOKEN}"},
                json={
                    "contractVersion": "2.0",
                    "requestId": REQUEST_ID,
                    "capabilityCode": "agent.standardTurn",
                    "deadlineAt": "2099-07-17T12:00:00Z",
                    "locale": "zh-CN",
                    "timezone": "Asia/Shanghai",
                    "allowedResultTypes": ["REPLY"],
                },
            )

    assert result.status_code == 200
    assert result.json()["result"] == {
        "type": "REPLY",
        "text": "先处理今天最重要的事",
        "offerPlan": False,
    }
    assert result.json()["resolved"]["model"] == "deepseek-v4-flash"
    assert result.json()["resolved"]["promptVersion"] == settings.standard_profile.prompt_version
    assert resources == ["SOURCE", "MESSAGES"]


@pytest.mark.asyncio
async def test_v1_compatibility_uses_same_runtime_without_context_tools() -> None:
    def model_response(_: Any, info: AgentInfo) -> ModelResponse:
        assert info.function_tools == []
        return ModelResponse(
            parts=[
                ToolCallPart(
                    info.output_tools[0].name,
                    {"type": "REPLY", "text": "兼容旧请求", "offerPlan": False},
                )
            ]
        )

    app = create_app(
        Settings(service_token=TOKEN, deepseek_api_key="synthetic-key", production=True),
        model=FunctionModel(model_response),
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://agent.internal"
    ) as agent:
        result = await agent.post(
            "/internal/v1/agent/execute",
            headers={"authorization": f"Bearer {TOKEN}"},
            json={
                "contractVersion": "1.0",
                "requestId": REQUEST_ID,
                "capabilityCode": "agent.standardTurn",
                "deadlineAt": "2099-07-17T12:00:00Z",
                "locale": "zh-CN",
                "timezone": "Asia/Shanghai",
                "allowedResultTypes": ["REPLY"],
                "messages": [{"role": "USER", "content": "给我一个建议"}],
                "candidates": [],
            },
        )

    assert result.status_code == 200
    assert result.json()["contractVersion"] == "1.0"
    assert result.json()["result"]["type"] == "REPLY"
