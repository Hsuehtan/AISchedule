from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from agent_service.config import ProviderProfile
from agent_service.errors import AgentServiceError
from agent_service.generated.internal_agent_v1 import ExecuteRequest
from agent_service.provider import DeepSeekProvider

TASK_REF = "cand_11111111111111111111111111111111"
PROJECT_REF = "cand_22222222222222222222222222222222"
UNKNOWN_REF = "cand_99999999999999999999999999999999"

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


def correlated_request() -> ExecuteRequest:
    return ExecuteRequest.model_validate(
        {
            "contractVersion": "1.0",
            "requestId": "b52e72d5-bb52-48c4-b511-fd7dc8c0f166",
            "capabilityCode": "agent.standardTurn",
            "deadlineAt": "2099-07-17T12:00:00Z",
            "locale": "zh-CN",
            "timezone": "Asia/Shanghai",
            "allowedResultTypes": [
                "REPLY",
                "CLARIFICATION",
                "CANDIDATES",
                "PLAN",
                "ACTION_PROPOSAL",
            ],
            "messages": [{"role": "USER", "content": "处理任务"}],
            "candidates": [
                {
                    "candidateRef": TASK_REF,
                    "kind": "TASK",
                    "label": "交报告",
                    "version": 3,
                },
                {
                    "candidateRef": PROJECT_REF,
                    "kind": "PROJECT",
                    "label": "工作",
                    "version": 2,
                },
            ],
        }
    )


def task_draft() -> dict[str, Any]:
    return {
        "clientRef": "draft_0123456789abcdef",
        "title": "准备材料",
        "description": None,
        "priority": "MEDIUM",
        "scheduledAt": None,
        "deadlineAt": None,
        "reminderAt": None,
    }


async def execute_with_repeated_result(result: dict[str, Any]) -> tuple[int, AgentServiceError]:
    calls = 0

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": json.dumps(result)}}]},
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = DeepSeekProvider(
            client=client,
            api_key="test-key",
            base_url="https://api.deepseek.invalid",
            standard_profile=STANDARD,
            plan_profile=PLAN,
        )
        with pytest.raises(AgentServiceError) as captured:
            await provider.execute(correlated_request())

    return calls, captured.value


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "result",
    [
        {
            "type": "CANDIDATES",
            "question": "哪一个",
            "options": [
                {
                    "optionId": "opt_0123456789abcdef",
                    "candidateRef": TASK_REF,
                    "label": "交报告",
                },
                {
                    "optionId": "opt_fedcba9876543210",
                    "candidateRef": UNKNOWN_REF,
                    "label": "伪造对象",
                },
            ],
        },
        {
            "type": "CANDIDATES",
            "question": "哪一个",
            "options": [
                {
                    "optionId": "opt_0123456789abcdef",
                    "candidateRef": TASK_REF,
                    "label": "交报告",
                },
                {
                    "optionId": "opt_0123456789abcdef",
                    "candidateRef": PROJECT_REF,
                    "label": "工作",
                },
            ],
        },
        {
            "type": "CLARIFICATION",
            "question": "何时",
            "options": [
                {
                    "optionId": "opt_0123456789abcdef",
                    "label": "今天",
                    "nextStep": "AGENT_STANDARD",
                },
                {
                    "optionId": "opt_0123456789abcdef",
                    "label": "明天",
                    "nextStep": "AGENT_STANDARD",
                },
            ],
            "allowFreeText": True,
        },
        {
            "type": "PLAN",
            "title": "准备计划",
            "project": {"type": "EXISTING", "candidateRef": TASK_REF},
            "tasks": [task_draft()],
        },
        {
            "type": "ACTION_PROPOSAL",
            "actionCode": "CREATE_PROJECT_TASKS",
            "summary": "创建任务",
            "mutations": [
                {
                    "operation": "CREATE_PROJECT_TASKS",
                    "project": {"type": "EXISTING", "candidateRef": TASK_REF},
                    "tasks": [task_draft()],
                }
            ],
        },
        {
            "type": "ACTION_PROPOSAL",
            "actionCode": "ORGANIZE_TASKS",
            "summary": "整理任务",
            "mutations": [
                {
                    "operation": "ORGANIZE_TASK",
                    "targetRef": TASK_REF,
                    "projectRef": PROJECT_REF,
                    "expectedVersion": 2,
                }
            ],
        },
        {
            "type": "ACTION_PROPOSAL",
            "actionCode": "UPDATE_TASK",
            "summary": "修改任务",
            "mutations": [
                {
                    "operation": "UPDATE_TASK",
                    "targetRef": UNKNOWN_REF,
                    "expectedVersion": 3,
                    "changes": {"title": "新标题"},
                }
            ],
        },
        {
            "type": "ACTION_PROPOSAL",
            "actionCode": "CREATE_TASK",
            "summary": "错误项目引用",
            "mutations": [
                {
                    "operation": "CREATE_TASK",
                    "project": {"type": "EXISTING", "candidateRef": TASK_REF},
                    "task": task_draft(),
                }
            ],
        },
        {
            "type": "ACTION_PROPOSAL",
            "actionCode": "COMPLETE_TASK",
            "summary": "完成任务",
            "mutations": [
                {
                    "operation": "COMPLETE_TASK",
                    "targetRef": TASK_REF,
                    "expectedVersion": 99,
                }
            ],
        },
        {
            "type": "ACTION_PROPOSAL",
            "actionCode": "RESTORE_TASK",
            "summary": "恢复任务",
            "mutations": [
                {
                    "operation": "RESTORE_TASK",
                    "targetRef": PROJECT_REF,
                    "expectedVersion": 2,
                }
            ],
        },
        {
            "type": "ACTION_PROPOSAL",
            "actionCode": "DELETE_TASK",
            "summary": "删除任务",
            "mutations": [
                {
                    "operation": "DELETE_TASK",
                    "targetRef": UNKNOWN_REF,
                    "expectedVersion": 1,
                }
            ],
        },
        {
            "type": "ACTION_PROPOSAL",
            "actionCode": "CREATE_TASK",
            "summary": "伪装动作",
            "mutations": [
                {
                    "operation": "COMPLETE_TASK",
                    "targetRef": TASK_REF,
                    "expectedVersion": 3,
                }
            ],
        },
    ],
    ids=[
        "unknown-candidate-ref",
        "duplicate-candidate-option-id",
        "duplicate-clarification-option-id",
        "plan-project-kind-mismatch",
        "create-project-kind-mismatch",
        "organize-version-mismatch",
        "update-unknown-ref",
        "complete-version-mismatch",
        "restore-kind-mismatch",
        "delete-unknown-ref",
        "create-task-project-kind-mismatch",
        "action-code-operation-mismatch",
    ],
)
async def test_invalid_model_references_get_one_repair_then_fail(result: dict[str, Any]) -> None:
    calls, error = await execute_with_repeated_result(result)

    assert calls == 2
    assert error.code == "PROVIDER_OUTPUT_INVALID"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "result",
    [
        {
            "type": "ACTION_PROPOSAL",
            "actionCode": "CREATE_TASK",
            "summary": "一次偷偷创建多项",
            "mutations": [
                {
                    "operation": "CREATE_TASK",
                    "project": {"type": "NONE"},
                    "task": task_draft(),
                },
                {
                    "operation": "CREATE_TASK",
                    "project": {"type": "NONE"},
                    "task": {**task_draft(), "clientRef": "draft_fedcba9876543210"},
                },
            ],
        },
        {
            "type": "ACTION_PROPOSAL",
            "actionCode": "CREATE_PROJECT_TASKS",
            "summary": "一次偷偷创建多个项目批次",
            "mutations": [
                {
                    "operation": "CREATE_PROJECT_TASKS",
                    "project": {"type": "NEW", "name": "项目一"},
                    "tasks": [task_draft()],
                },
                {
                    "operation": "CREATE_PROJECT_TASKS",
                    "project": {"type": "NEW", "name": "项目二"},
                    "tasks": [{**task_draft(), "clientRef": "draft_fedcba9876543210"}],
                },
            ],
        },
    ],
    ids=["multiple-create-task-mutations", "multiple-create-project-task-mutations"],
)
async def test_contract_valid_action_specific_overflow_is_repaired_then_rejected(
    result: dict[str, Any],
) -> None:
    calls, error = await execute_with_repeated_result(result)

    assert calls == 2
    assert error.code == "PROVIDER_OUTPUT_INVALID"


@pytest.mark.asyncio
async def test_matching_candidate_reference_kind_and_version_are_accepted() -> None:
    result = {
        "type": "ACTION_PROPOSAL",
        "actionCode": "ORGANIZE_TASKS",
        "summary": "整理任务",
        "mutations": [
            {
                "operation": "ORGANIZE_TASK",
                "targetRef": TASK_REF,
                "projectRef": PROJECT_REF,
                "expectedVersion": 3,
            }
        ],
    }

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": json.dumps(result)}}]},
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = DeepSeekProvider(
            client=client,
            api_key="test-key",
            base_url="https://api.deepseek.invalid",
            standard_profile=STANDARD,
            plan_profile=PLAN,
        )
        response = await provider.execute(correlated_request())

    assert response.result.type == "ACTION_PROPOSAL"
    assert response.resolved.repair_attempts == 0
