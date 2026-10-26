from __future__ import annotations

import asyncio
from typing import Any

import pytest
from pydantic_ai import ModelResponse, ToolCallPart, models
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.deepseek import DeepSeekProvider

from agent_service.config import ProviderProfile
from agent_service.context import InferenceRequest
from agent_service.errors import AgentServiceError
from agent_service.generated.internal_agent_v1 import CandidateContext
from agent_service.generated.internal_agent_v2 import ContextReadResponse
from agent_service.pydantic_runtime import PydanticAgentRuntime

pytestmark = pytest.mark.asyncio
models.ALLOW_MODEL_REQUESTS = False


def context(allowed: list[str] | None = None) -> InferenceRequest:
    return InferenceRequest.model_validate(
        {
            "contractVersion": "2.0",
            "requestId": "b52e72d5-bb52-48c4-b511-fd7dc8c0f166",
            "capabilityCode": "agent.standardTurn",
            "deadlineAt": "2099-07-17T12:00:00Z",
            "locale": "zh-CN",
            "timezone": "Asia/Shanghai",
            "allowedResultTypes": allowed or ["REPLY"],
            "messages": [{"role": "USER", "content": "今天安排一下工作"}],
            "candidates": [],
            "source": {"kind": "TURN", "instruction": "今天安排一下工作", "previousDraft": None},
        }
    )


PROFILE = ProviderProfile(
    model="deepseek-v4-flash",
    timeout_seconds=30,
    prompt_version="pydantic-v1",
    schema_version="pydantic-v1",
    thinking_enabled=False,
    reasoning_effort=None,
    temperature=0.2,
    max_tokens=4096,
)
DEEPSEEK_MODEL_PROFILE = OpenAIChatModel(
    "deepseek-v4-flash", provider=DeepSeekProvider(api_key="test-only")
).profile


async def test_reply_uses_typed_output_and_v2_metadata() -> None:
    seen_tools: list[str] = []
    seen_settings: list[dict[str, Any]] = []
    seen_thinking: list[object] = []

    def respond(_: Any, info: AgentInfo) -> ModelResponse:
        seen_tools.extend(tool.name for tool in info.output_tools)
        seen_settings.append(dict(info.model_settings or {}))
        seen_thinking.append(info.model_request_parameters.thinking)
        return ModelResponse(
            parts=[
                ToolCallPart(
                    info.output_tools[0].name,
                    {"type": "REPLY", "text": "先处理最重要的一项", "offerPlan": False},
                )
            ]
        )

    result = await PydanticAgentRuntime(
        FunctionModel(respond, profile=DEEPSEEK_MODEL_PROFILE), PROFILE
    ).execute(context())

    assert result.contract_version == "2.0"
    assert result.result.type == "REPLY"
    assert result.resolved.model == "deepseek-v4-flash"
    assert seen_tools == ["emit_reply"]
    assert seen_thinking == [False]
    assert seen_settings[0]["max_retries"] == 0
    assert seen_settings[0]["max_tokens"] == 4096


async def test_plan_output_is_not_exposed_to_standard_turn() -> None:
    def respond(_: Any, info: AgentInfo) -> ModelResponse:
        return ModelResponse(
            parts=[
                ToolCallPart(
                    info.output_tools[0].name,
                    {"type": "REPLY", "text": "先列出三件事", "offerPlan": True},
                )
            ]
        )

    result = await PydanticAgentRuntime(FunctionModel(respond), PROFILE).execute(
        context(["REPLY", "ACTION_PROPOSAL"])
    )

    assert result.result.type == "REPLY"


async def test_read_task_tool_makes_only_current_run_reference_available() -> None:
    task_ref = "cand_" + "a" * 32
    reads: list[str] = []

    class ContextPages:
        async def read(
            self,
            request: Any,
            resource: str,
            limit: int,
            cursor: str | None = None,
            include_task_details: bool = False,
        ) -> ContextReadResponse:
            reads.append(resource)
            return ContextReadResponse.model_validate(
                {
                    "requestId": str(request.request_id),
                    "resource": resource,
                    "source": None,
                    "messages": [],
                    "candidates": [
                        {"candidateRef": task_ref, "kind": "TASK", "label": "买帐篷", "version": 2}
                    ],
                    "nextCursor": None,
                }
            )

    calls = 0

    def respond(_: Any, info: AgentInfo) -> ModelResponse:
        nonlocal calls
        calls += 1
        if calls == 1:
            return ModelResponse(parts=[ToolCallPart("read_tasks", {})])
        return ModelResponse(
            parts=[
                ToolCallPart(
                    info.output_tools[0].name,
                    {
                        "type": "ACTION_PROPOSAL",
                        "actionCode": "COMPLETE_TASK",
                        "summary": "完成买帐篷",
                        "mutations": [
                            {
                                "operation": "COMPLETE_TASK",
                                "targetRef": task_ref,
                                "expectedVersion": 2,
                            }
                        ],
                    },
                )
            ]
        )

    result = await PydanticAgentRuntime(FunctionModel(respond), PROFILE).execute(
        context(["ACTION_PROPOSAL"]), ContextPages()
    )

    assert result.result.type == "ACTION_PROPOSAL"
    assert reads == ["TASKS"]
    assert calls == 2


async def test_invalid_reference_gets_one_repair_then_succeeds() -> None:
    attempts = 0

    def respond(_: Any, info: AgentInfo) -> ModelResponse:
        nonlocal attempts
        attempts += 1
        return ModelResponse(
            parts=[
                ToolCallPart(
                    info.output_tools[0].name,
                    {
                        "type": "ACTION_PROPOSAL",
                        "actionCode": "COMPLETE_TASK",
                        "summary": "完成待办",
                        "mutations": [
                            {
                                "operation": "COMPLETE_TASK",
                                "targetRef": "cand_" + "a" * 32,
                                "expectedVersion": 2 if attempts == 1 else 1,
                            }
                        ],
                    },
                )
            ]
        )

    request = context(["ACTION_PROPOSAL"])
    request.candidates = [
        CandidateContext.model_validate(
            {"candidateRef": "cand_" + "a" * 32, "kind": "TASK", "label": "待办", "version": 1}
        )
    ]
    result = await PydanticAgentRuntime(FunctionModel(respond), PROFILE).execute(request)

    assert result.resolved.repair_attempts == 1
    assert attempts == 2


async def test_invalid_reference_stops_after_one_repair() -> None:
    attempts = 0

    def respond(_: Any, info: AgentInfo) -> ModelResponse:
        nonlocal attempts
        attempts += 1
        return ModelResponse(
            parts=[
                ToolCallPart(
                    info.output_tools[0].name,
                    {
                        "type": "ACTION_PROPOSAL",
                        "actionCode": "COMPLETE_TASK",
                        "summary": "完成待办",
                        "mutations": [
                            {
                                "operation": "COMPLETE_TASK",
                                "targetRef": "cand_" + "a" * 32,
                                "expectedVersion": 9,
                            }
                        ],
                    },
                )
            ]
        )

    request = context(["ACTION_PROPOSAL"])
    with pytest.raises(AgentServiceError) as error:
        await PydanticAgentRuntime(FunctionModel(respond), PROFILE).execute(request)

    assert error.value.code == "PROVIDER_OUTPUT_INVALID"
    assert attempts == 2


async def test_second_task_page_can_resolve_target_without_reusing_old_refs() -> None:
    target_ref = "cand_" + "b" * 32
    reads: list[tuple[int, str | None, bool]] = []

    class ContextPages:
        async def read(
            self,
            request: Any,
            resource: str,
            limit: int,
            cursor: str | None = None,
            include_task_details: bool = False,
        ) -> ContextReadResponse:
            reads.append((limit, cursor, include_task_details))
            return ContextReadResponse.model_validate(
                {
                    "requestId": str(request.request_id),
                    "resource": resource,
                    "source": None,
                    "messages": [],
                    "candidates": [
                        {
                            "candidateRef": "cand_" + "a" * 32 if cursor is None else target_ref,
                            "kind": "TASK",
                            "label": "第一页" if cursor is None else "第二页目标😀",
                            "version": 3,
                            "status": "TODO",
                            "reminderAt": None,
                        }
                    ],
                    "nextCursor": "opaque-next" if cursor is None else None,
                }
            )

    calls = 0

    def respond(_: Any, info: AgentInfo) -> ModelResponse:
        nonlocal calls
        calls += 1
        if calls < 3:
            return ModelResponse(parts=[ToolCallPart("read_tasks", {})])
        return ModelResponse(
            parts=[
                ToolCallPart(
                    info.output_tools[0].name,
                    {
                        "type": "ACTION_PROPOSAL",
                        "actionCode": "COMPLETE_TASK",
                        "summary": "完成第二页目标",
                        "mutations": [
                            {
                                "operation": "COMPLETE_TASK",
                                "targetRef": target_ref,
                                "expectedVersion": 3,
                            }
                        ],
                    },
                )
            ]
        )

    result = await PydanticAgentRuntime(FunctionModel(respond), PROFILE).execute(
        context(["ACTION_PROPOSAL"]), ContextPages()
    )
    assert result.result.type == "ACTION_PROPOSAL"
    assert calls == 3
    assert reads == [(50, None, True), (50, "opaque-next", True)]


async def test_third_reasoning_response_cannot_read_again() -> None:
    reads = 0

    class ContextPages:
        async def read(
            self,
            request: Any,
            resource: str,
            limit: int,
            cursor: str | None = None,
            include_task_details: bool = False,
        ) -> ContextReadResponse:
            nonlocal reads
            reads += 1
            return ContextReadResponse.model_validate(
                {
                    "requestId": str(request.request_id),
                    "resource": resource,
                    "source": None,
                    "messages": [],
                    "candidates": [],
                    "nextCursor": "next" + str(reads),
                }
            )

    calls = 0

    def respond(_: Any, info: AgentInfo) -> ModelResponse:
        nonlocal calls
        calls += 1
        return ModelResponse(parts=[ToolCallPart("read_tasks", {})])

    with pytest.raises(AgentServiceError) as error:
        await PydanticAgentRuntime(FunctionModel(respond), PROFILE).execute(
            context(), ContextPages()
        )
    assert error.value.code == "EXECUTION_BUDGET_EXCEEDED"
    assert reads == 2
    assert calls == 3


async def test_two_tools_in_one_model_response_execute_serially() -> None:
    active = 0
    highest_active = 0
    resources: list[str] = []

    class ContextPages:
        async def read(
            self,
            request: Any,
            resource: str,
            limit: int,
            cursor: str | None = None,
            include_task_details: bool = False,
        ) -> ContextReadResponse:
            nonlocal active, highest_active
            active += 1
            highest_active = max(highest_active, active)
            resources.append(resource)
            await asyncio.sleep(0.01)
            active -= 1
            return ContextReadResponse.model_validate(
                {
                    "requestId": str(request.request_id),
                    "resource": resource,
                    "source": None,
                    "messages": [],
                    "candidates": [],
                    "nextCursor": None,
                }
            )

    calls = 0

    def respond(_: Any, info: AgentInfo) -> ModelResponse:
        nonlocal calls
        calls += 1
        if calls == 1:
            return ModelResponse(
                parts=[ToolCallPart("read_tasks", {}), ToolCallPart("read_projects", {})]
            )
        return ModelResponse(
            parts=[
                ToolCallPart(
                    info.output_tools[0].name,
                    {"type": "REPLY", "text": "已读取", "offerPlan": False},
                )
            ]
        )

    result = await PydanticAgentRuntime(FunctionModel(respond), PROFILE).execute(
        context(), ContextPages()
    )
    assert result.result.type == "REPLY"
    assert highest_active == 1
    assert set(resources) == {"TASKS", "PROJECTS"}
    assert calls == 2


TASK_REF = "cand_" + "a" * 32
PROJECT_REF = "cand_" + "b" * 32
DRAFT = {
    "clientRef": "draft_0000000000000001",
    "title": "合成任务",
    "description": None,
    "priority": "MEDIUM",
    "scheduledAt": None,
    "deadlineAt": None,
    "reminderAt": None,
}


@pytest.mark.parametrize(
    ("result_type", "payload"),
    [
        (
            "CLARIFICATION",
            {
                "type": "CLARIFICATION",
                "question": "要修改哪项?",
                "options": [
                    {
                        "optionId": "opt_0000000000000001",
                        "label": "任务一",
                        "nextStep": "AGENT_STANDARD",
                    },
                    {
                        "optionId": "opt_0000000000000002",
                        "label": "任务二",
                        "nextStep": "AGENT_STANDARD",
                    },
                ],
                "allowFreeText": True,
            },
        ),
        (
            "CANDIDATES",
            {
                "type": "CANDIDATES",
                "question": "请选择任务",
                "options": [
                    {
                        "optionId": "opt_0000000000000001",
                        "candidateRef": TASK_REF,
                        "label": "任务一",
                    },
                    {
                        "optionId": "opt_0000000000000002",
                        "candidateRef": PROJECT_REF,
                        "label": "项目",
                    },
                ],
            },
        ),
        (
            "PLAN",
            {
                "type": "PLAN",
                "title": "合成计划",
                "project": {"type": "NEW", "name": "测试"},
                "tasks": [DRAFT],
            },
        ),
        (
            "ACTION_PROPOSAL",
            {
                "type": "ACTION_PROPOSAL",
                "actionCode": "CREATE_TASK",
                "summary": "创建合成任务",
                "mutations": [
                    {"operation": "CREATE_TASK", "project": {"type": "NONE"}, "task": DRAFT}
                ],
            },
        ),
        (
            "ACTION_PROPOSAL",
            {
                "type": "ACTION_PROPOSAL",
                "actionCode": "CREATE_PROJECT_TASKS",
                "summary": "创建项目和任务",
                "mutations": [
                    {
                        "operation": "CREATE_PROJECT_TASKS",
                        "project": {"type": "NEW", "name": "测试"},
                        "tasks": [DRAFT],
                    }
                ],
            },
        ),
        (
            "ACTION_PROPOSAL",
            {
                "type": "ACTION_PROPOSAL",
                "actionCode": "ORGANIZE_TASKS",
                "summary": "设置时间和提醒",
                "mutations": [
                    {
                        "operation": "ORGANIZE_TASK",
                        "targetRef": TASK_REF,
                        "expectedVersion": 1,
                        "scheduledAt": "2030-01-02T08:00:00Z",
                        "reminderAt": "2030-01-02T07:30:00Z",
                    }
                ],
            },
        ),
        (
            "ACTION_PROPOSAL",
            {
                "type": "ACTION_PROPOSAL",
                "actionCode": "UPDATE_TASK",
                "summary": "修改项目",
                "mutations": [
                    {
                        "operation": "UPDATE_TASK",
                        "targetRef": TASK_REF,
                        "expectedVersion": 1,
                        "changes": {"project": {"type": "EXISTING", "candidateRef": PROJECT_REF}},
                    }
                ],
            },
        ),
        *[
            (
                "ACTION_PROPOSAL",
                {
                    "type": "ACTION_PROPOSAL",
                    "actionCode": code,
                    "summary": "处理合成任务",
                    "mutations": [{"operation": code, "targetRef": TASK_REF, "expectedVersion": 1}],
                },
            )
            for code in ("COMPLETE_TASK", "RESTORE_TASK", "DELETE_TASK")
        ],
    ],
)
async def test_all_result_and_action_contracts_pass_through_runtime(
    result_type: str, payload: dict[str, Any]
) -> None:
    def respond(_: Any, info: AgentInfo) -> ModelResponse:
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, payload)])

    request = context([result_type])
    if payload.get("actionCode") == "ORGANIZE_TASKS":
        request.source.kind = "ORGANIZE"
    request.candidates = [
        CandidateContext.model_validate(
            {"candidateRef": TASK_REF, "kind": "TASK", "label": "任务一", "version": 1}
        ),
        CandidateContext.model_validate(
            {"candidateRef": PROJECT_REF, "kind": "PROJECT", "label": "项目", "version": 1}
        ),
    ]
    result = await PydanticAgentRuntime(FunctionModel(respond), PROFILE).execute(request)
    assert result.result.type == result_type
    if result_type == "ACTION_PROPOSAL":
        assert getattr(result.result, "action_code", None) == payload["actionCode"]


async def test_named_task_change_rejects_organize_action_and_repairs_once() -> None:
    attempts = 0

    def respond(_: Any, info: AgentInfo) -> ModelResponse:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            payload = {
                "type": "ACTION_PROPOSAL",
                "actionCode": "ORGANIZE_TASKS",
                "summary": "修改周报时间",
                "mutations": [
                    {
                        "operation": "ORGANIZE_TASK",
                        "targetRef": TASK_REF,
                        "expectedVersion": 1,
                        "scheduledAt": "2030-01-02T08:00:00Z",
                    }
                ],
            }
        else:
            payload = {
                "type": "ACTION_PROPOSAL",
                "actionCode": "UPDATE_TASK",
                "summary": "修改周报时间",
                "mutations": [
                    {
                        "operation": "UPDATE_TASK",
                        "targetRef": TASK_REF,
                        "expectedVersion": 1,
                        "changes": {"scheduledAt": "2030-01-02T08:00:00Z"},
                    }
                ],
            }
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, payload)])

    request = context(["ACTION_PROPOSAL"])
    request.candidates = [
        CandidateContext.model_validate(
            {"candidateRef": TASK_REF, "kind": "TASK", "label": "周报", "version": 1}
        )
    ]
    result = await PydanticAgentRuntime(FunctionModel(respond), PROFILE).execute(request)
    assert result.result.type == "ACTION_PROPOSAL"
    assert getattr(result.result, "action_code", None) == "UPDATE_TASK"
    assert result.resolved.repair_attempts == 1
    assert attempts == 2


async def test_organize_repairs_suggestion_that_overwrites_existing_time() -> None:
    attempts = 0

    class ContextPages:
        async def read(
            self,
            request: Any,
            resource: str,
            limit: int,
            cursor: str | None = None,
            include_task_details: bool = False,
        ) -> ContextReadResponse:
            assert resource == "TASKS"
            return ContextReadResponse.model_validate(
                {
                    "requestId": str(request.request_id),
                    "resource": resource,
                    "source": None,
                    "messages": [],
                    "candidates": [
                        {
                            "candidateRef": TASK_REF,
                            "kind": "TASK",
                            "label": "待整理",
                            "version": 1,
                            "status": "TODO",
                            "scheduledAt": "2030-01-02T09:00:00Z",
                            "reminderAt": None,
                            "projectLabel": "工作",
                        }
                    ],
                    "nextCursor": None,
                }
            )

    def respond(_: Any, info: AgentInfo) -> ModelResponse:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            return ModelResponse(parts=[ToolCallPart("read_tasks", {})])
        field = (
            {"scheduledAt": "2030-01-03T09:00:00Z"}
            if attempts == 2
            else {"reminderAt": "2030-01-02T08:00:00Z"}
        )
        return ModelResponse(
            parts=[
                ToolCallPart(
                    info.output_tools[0].name,
                    {
                        "type": "ACTION_PROPOSAL",
                        "actionCode": "ORGANIZE_TASKS",
                        "summary": "补齐缺失时间",
                        "mutations": [
                            {
                                "operation": "ORGANIZE_TASK",
                                "targetRef": TASK_REF,
                                "expectedVersion": 1,
                                **field,
                            }
                        ],
                    },
                )
            ]
        )

    request = context(["ACTION_PROPOSAL"])
    request.source.kind = "ORGANIZE"
    request.source.instruction = "只补缺失的提醒"
    result = await PydanticAgentRuntime(FunctionModel(respond), PROFILE).execute(
        request, ContextPages()
    )
    assert result.result.type == "ACTION_PROPOSAL"
    assert result.resolved.repair_attempts == 1
    assert attempts == 3
