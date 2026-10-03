import json

import httpx
import pytest
from test_context_client import request

from agent_service.context import ContextPolicy, build_context
from agent_service.context_client import ContextClient
from agent_service.errors import AgentServiceError
from agent_service.prompts import build_prompts


async def test_policy_alone_controls_paging_counts_and_utf8_history() -> None:
    descriptor = request()
    reads: list[tuple[str, int]] = []

    def handle(req: httpx.Request) -> httpx.Response:
        body = json.loads(req.content)
        resource, limit = body["resource"], body["limit"]
        reads.append((resource, limit))
        offset = int(body.get("cursor") or 0)
        count = min(limit, 7)
        page: dict[str, object] = {
            "requestId": str(descriptor.request_id),
            "resource": resource,
            "source": None,
            "messages": [],
            "candidates": [],
            "nextCursor": None,
        }
        if resource == "SOURCE":
            page["source"] = {"kind": "TURN", "instruction": "测试", "previousDraft": None}
        elif resource == "MESSAGES":
            page["messages"] = [
                {"role": "USER", "content": "中文😀" * 100 + str(i)}
                for i in range(offset, offset + count)
            ]
            page["nextCursor"] = str(offset + count)
        else:
            page["candidates"] = [
                {
                    "candidateRef": f"cand_{i:032x}",
                    "kind": "TASK" if resource == "TASKS" else "PROJECT",
                    "label": "合成候选",
                    "version": 1,
                }
                for i in range(offset, offset + count)
            ]
            page["nextCursor"] = str(offset + count)
        return httpx.Response(200, json=page)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as http:
        client = ContextClient(http, "http://business", "context-token")
        normal = await build_context(descriptor, client)
        assert len(normal.messages) == 12
        assert sum(len(m.content.encode()) for m in normal.messages) <= 12 * 1024
        assert len(normal.candidates) == 80
        expanded = await build_context(
            descriptor,
            client,
            ContextPolicy(
                history_messages=25, history_bytes=40_000, task_candidates=60, project_candidates=35
            ),
        )
        assert len(expanded.messages) == 25
        assert len(expanded.candidates) == 95
        assert ("MESSAGES", 25) in reads and ("TASKS", 60) in reads
        system, user = build_prompts(expanded)
        assert "current user message" in system
        assert "中文😀" in user


async def test_history_keeps_latest_twenty_whole_messages_and_rejects_oversized_latest() -> None:
    descriptor = request()
    latest = "新"

    def handle(req: httpx.Request) -> httpx.Response:
        body = json.loads(req.content)
        resource = body["resource"]
        return httpx.Response(
            200,
            json={
                "requestId": str(descriptor.request_id),
                "resource": resource,
                "source": {"kind": "TURN", "instruction": "测试", "previousDraft": None}
                if resource == "SOURCE"
                else None,
                "messages": [
                    {"role": "USER", "content": latest + str(i)}
                    for i in range(1 if len(latest) > 1000 else body["limit"])
                ]
                if resource == "MESSAGES"
                else [],
                "candidates": [],
                "nextCursor": None,
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as http:
        client = ContextClient(http, "http://business", "context-token")
        context = await build_context(descriptor, client)
        assert len(context.messages) == 20
        assert context.messages[0].content == "新19"
        assert context.messages[-1].content == "新0"
        latest = "😀" * 4000
        with pytest.raises(AgentServiceError, match="Latest message exceeds context budget"):
            await build_context(descriptor, client)


async def test_draft_injection_is_budgeted_only_in_python() -> None:
    descriptor = request()
    draft = {
        "actionCode": "CREATE_PROJECT_TASKS",
        "title": "旧计划",
        "summary": "参考草稿",
        "tasks": [
            {
                "title": "旧任务",
                "description": "x" * 2000,
                "priority": "MEDIUM",
                "scheduledAt": None,
                "deadlineAt": None,
                "reminderAt": None,
            }
            for _ in range(7)
        ],
    }

    def handle(req: httpx.Request) -> httpx.Response:
        resource = json.loads(req.content)["resource"]
        return httpx.Response(
            200,
            json={
                "requestId": str(descriptor.request_id),
                "resource": resource,
                "source": {"kind": "REGENERATE", "instruction": "精简", "previousDraft": draft}
                if resource == "SOURCE"
                else None,
                "messages": [{"role": "USER", "content": "重新生成计划"}]
                if resource == "MESSAGES"
                else [],
                "candidates": [],
                "nextCursor": None,
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as http:
        client = ContextClient(http, "http://business", "context-token")
        with pytest.raises(AgentServiceError, match="Latest message exceeds context budget"):
            await build_context(descriptor, client)
        expanded = await build_context(descriptor, client, ContextPolicy(history_bytes=40_000))
    assert "旧任务" in expanded.messages[-1].content
    assert "精简" in expanded.messages[-1].content
    assert "source" not in expanded.model_dump()
    assert len(expanded.messages) == 1
