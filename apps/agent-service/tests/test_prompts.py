from __future__ import annotations

import json

from agent_service.generated.internal_agent_v1 import ExecuteRequest
from agent_service.prompts import build_prompts, build_repair_messages, render_result_contract


def request_with_every_result_type() -> ExecuteRequest:
    return ExecuteRequest.model_validate(
        {
            "contractVersion": "1.0",
            "requestId": "b52e72d5-bb52-48c4-b511-fd7dc8c0f166",
            "capabilityCode": "agent.planGeneration",
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
            "messages": [{"role": "USER", "content": "帮我安排任务"}],
            "candidates": [],
        }
    )


def assert_complete_result_shapes(prompt: str) -> None:
    assert "Canonical JSON Schema" in prompt
    assert '"REPLY"' in prompt
    assert '"offerPlan"' in prompt
    assert '"CLARIFICATION"' in prompt
    assert '"allowFreeText"' in prompt
    assert '"CANDIDATES"' in prompt
    assert '"PLAN"' in prompt
    assert '"clientRef"' in prompt
    assert '"ACTION_PROPOSAL"' in prompt
    assert '"actionCode"' in prompt
    assert '"mutations"' in prompt
    assert '"required"' in prompt
    assert "may generate ephemeral optionId and clientRef" in prompt
    assert "never invent identifiers" not in prompt


def test_main_prompt_contains_full_schema_for_every_allowed_result_type() -> None:
    system, _ = build_prompts(request_with_every_result_type())

    assert_complete_result_shapes(system)


def test_repair_prompt_repeats_the_same_complete_result_contract() -> None:
    messages = build_repair_messages(
        request_with_every_result_type(),
        '{"type":"REPLY","text":"missing required field"}',
    )

    assert_complete_result_shapes(messages[0]["content"])


def test_prompt_schema_keeps_sparse_task_changes_non_nullable_without_invalid_defaults() -> None:
    rendered = render_result_contract(request_with_every_result_type())
    schemas = json.loads(rendered.split("\n", 1)[1])
    task_changes = schemas["ACTION_PROPOSAL"]["$defs"]["TaskChanges"]

    assert "required" not in task_changes
    assert task_changes["properties"]["title"]["type"] == "string"
    assert task_changes["properties"]["priority"]["type"] == "string"
    assert "default" not in task_changes["properties"]["title"]
    assert "default" not in task_changes["properties"]["priority"]
    assert "title" not in task_changes["properties"]["title"]
