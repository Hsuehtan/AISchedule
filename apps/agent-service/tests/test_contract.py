from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any, cast

import pytest
import yaml

from agent_service.generated import internal_agent_v1
from agent_service.generated.internal_agent_v1 import ExecuteRequest, ExecuteResponse

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
CONTRACT_ROOT = REPOSITORY_ROOT / "packages/contracts/internal-agent/v1"


def load_json(path: Path) -> dict[str, Any]:
    return cast(dict[str, Any], json.loads(path.read_text(encoding="utf-8")))


def test_committed_generated_models_match_canonical_openapi() -> None:
    result = subprocess.run(  # noqa: S603 -- fixed interpreter and repository-owned script
        [sys.executable, str(CONTRACT_ROOT / "generate.py"), "--check"],
        cwd=REPOSITORY_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stdout + result.stderr


def test_contract_uses_openapi_31_and_private_bearer_auth() -> None:
    document = yaml.safe_load((CONTRACT_ROOT / "openapi.yaml").read_text(encoding="utf-8"))

    assert document["openapi"] == "3.1.0"
    assert document["security"] == [{"serviceBearer": []}]
    assert document["components"]["securitySchemes"]["serviceBearer"] == {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "opaque-256-bit",
    }


def test_generated_request_policy_constants_come_from_canonical_openapi() -> None:
    assert internal_agent_v1.MESSAGE_CONTENT_MAX_BYTES == 12 * 1024
    assert internal_agent_v1.MAX_TASK_CANDIDATES == 50
    assert internal_agent_v1.MAX_PROJECT_CANDIDATES == 30


@pytest.mark.parametrize(
    "filename",
    ["execute-request.standard.json", "execute-request.plan.json"],
)
def test_request_golden_fixtures_are_accepted(filename: str) -> None:
    payload = load_json(CONTRACT_ROOT / "fixtures" / filename)

    request = ExecuteRequest.model_validate(payload)

    assert request.model_dump(mode="json", by_alias=True) == payload


@pytest.mark.parametrize(
    "filename",
    [
        "execute-response.reply.json",
        "execute-response.clarification.json",
        "execute-response.candidates.json",
        "execute-response.plan.json",
        "execute-response.action-proposal.json",
    ],
)
def test_response_golden_fixtures_are_accepted(filename: str) -> None:
    payload = load_json(CONTRACT_ROOT / "fixtures" / filename)

    response = ExecuteResponse.model_validate(payload)

    assert response.model_dump(mode="json", by_alias=True) == payload


@pytest.mark.parametrize(
    "test_case",
    load_json(CONTRACT_ROOT / "fixtures/unicode-length-boundaries.json")["replyTextCases"],
    ids=lambda test_case: str(test_case["name"]),
)
def test_reply_length_uses_json_schema_unicode_code_points(test_case: dict[str, Any]) -> None:
    payload = load_json(CONTRACT_ROOT / "fixtures/execute-response.reply.json")
    text = str(test_case["unit"]) * int(test_case["repeat"]) + str(test_case["suffix"])
    payload["result"]["text"] = text

    assert len(text) == test_case["expectedCodePoints"]
    if test_case["accepted"]:
        ExecuteResponse.model_validate(payload)
    else:
        with pytest.raises(ValueError):
            ExecuteResponse.model_validate(payload)


@pytest.mark.parametrize("forbidden", ["userId", "taskId", "projectId", "reservationId"])
def test_request_rejects_business_or_billing_identifiers(forbidden: str) -> None:
    payload = load_json(CONTRACT_ROOT / "fixtures/execute-request.standard.json")
    payload[forbidden] = "forbidden"

    with pytest.raises(ValueError):
        ExecuteRequest.model_validate(payload)


def test_response_rejects_unknown_result_types_and_fields() -> None:
    payload = load_json(CONTRACT_ROOT / "fixtures/execute-response.reply.json")
    payload["result"] = {"type": "DROP_DATABASE", "text": "unsafe"}

    with pytest.raises(ValueError):
        ExecuteResponse.model_validate(payload)


def test_request_rejects_timezone_naive_deadlines() -> None:
    payload = load_json(CONTRACT_ROOT / "fixtures/execute-request.standard.json")
    payload["deadlineAt"] = "2026-07-17T12:00:00"

    with pytest.raises(ValueError):
        ExecuteRequest.model_validate(payload)


def test_python_contract_accepts_only_canonical_camel_case_fields() -> None:
    payload = load_json(CONTRACT_ROOT / "fixtures/execute-request.standard.json")
    payload["contract_version"] = payload.pop("contractVersion")

    with pytest.raises(ValueError):
        ExecuteRequest.model_validate(payload)


def response_with(result: dict[str, Any]) -> dict[str, Any]:
    payload = load_json(CONTRACT_ROOT / "fixtures/execute-response.action-proposal.json")
    payload["result"] = result
    return payload


def task_draft(client_ref: str = "draft_0123456789abcdef") -> dict[str, Any]:
    return {
        "clientRef": client_ref,
        "title": "准备材料",
        "description": None,
        "priority": "MEDIUM",
        "scheduledAt": None,
        "deadlineAt": None,
        "reminderAt": None,
    }


def test_plan_and_create_project_tasks_reject_no_project_selection() -> None:
    plan = load_json(CONTRACT_ROOT / "fixtures/execute-response.plan.json")
    plan["result"]["project"] = {"type": "NONE"}
    create_project_tasks = response_with(
        {
            "type": "ACTION_PROPOSAL",
            "actionCode": "CREATE_PROJECT_TASKS",
            "summary": "创建项目任务",
            "mutations": [
                {
                    "operation": "CREATE_PROJECT_TASKS",
                    "project": {"type": "NONE"},
                    "tasks": [task_draft()],
                }
            ],
        }
    )

    with pytest.raises(ValueError):
        ExecuteResponse.model_validate(plan)
    with pytest.raises(ValueError):
        ExecuteResponse.model_validate(create_project_tasks)


def test_create_task_requires_none_or_existing_project_selection() -> None:
    base_result: dict[str, Any] = {
        "type": "ACTION_PROPOSAL",
        "actionCode": "CREATE_TASK",
        "summary": "创建任务",
        "mutations": [
            {
                "operation": "CREATE_TASK",
                "project": {"type": "NONE"},
                "task": task_draft(),
            }
        ],
    }
    ExecuteResponse.model_validate(response_with(base_result))
    base_result["mutations"][0]["project"] = {
        "type": "EXISTING",
        "candidateRef": "cand_0123456789abcdef0123456789abcdef",
    }
    ExecuteResponse.model_validate(response_with(base_result))
    base_result["mutations"][0]["project"] = {"type": "NEW", "name": "不允许"}
    with pytest.raises(ValueError):
        ExecuteResponse.model_validate(response_with(base_result))


def test_update_task_changes_are_strict_partial_fields_without_client_ref() -> None:
    mutation: dict[str, Any] = {
        "operation": "UPDATE_TASK",
        "targetRef": "cand_0123456789abcdef0123456789abcdef",
        "expectedVersion": 1,
        "changes": {"title": "新标题"},
    }
    result = {
        "type": "ACTION_PROPOSAL",
        "actionCode": "UPDATE_TASK",
        "summary": "修改任务",
        "mutations": [mutation],
    }
    ExecuteResponse.model_validate(response_with(result))

    mutation["changes"] = {}
    with pytest.raises(ValueError):
        ExecuteResponse.model_validate(response_with(result))
    mutation["changes"] = {"clientRef": "draft_0123456789abcdef"}
    with pytest.raises(ValueError):
        ExecuteResponse.model_validate(response_with(result))
    mutation["changes"] = {"title": None}
    with pytest.raises(ValueError):
        ExecuteResponse.model_validate(response_with(result))
