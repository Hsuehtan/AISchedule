"""Run the fixed synthetic corpus without saving prompts or model responses."""

# ruff: noqa: RUF001

from __future__ import annotations

import argparse
import asyncio
import json
import os
import statistics
import time
from collections import Counter, defaultdict
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta, tzinfo
from pathlib import Path
from typing import Any
from unittest.mock import patch
from uuid import uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx
import httpx2
from openai import AsyncOpenAI
from pydantic_ai import models
from pydantic_ai.exceptions import ModelHTTPError
from pydantic_ai.messages import ModelMessage, ModelResponse
from pydantic_ai.models import ModelRequestParameters
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.models.wrapper import WrapperModel
from pydantic_ai.providers.deepseek import DeepSeekProvider as PydanticDeepSeekProvider
from pydantic_ai.settings import ModelSettings
from pydantic_evals import Case, Dataset
from pydantic_evals.evaluators import Evaluator, EvaluatorContext

from agent_service.config import ProviderProfile
from agent_service.context import InferenceRequest
from agent_service.errors import AgentServiceError
from agent_service.generated.internal_agent_v1 import ExecuteRequest as V1ExecuteRequest
from agent_service.generated.internal_agent_v2 import ContextReadResponse
from agent_service.provider import DeepSeekProvider
from agent_service.pydantic_runtime import PydanticAgentRuntime
from evals.cases import Scenario, scenarios, time_scenarios

TASK_ONE = "cand_" + "1" * 32
TASK_TWO = "cand_" + "2" * 32
TASK_THREE = "cand_" + "3" * 32
PROJECT_ONE = "cand_" + "4" * 32
PROJECT_TWO = "cand_" + "5" * 32

PROFILE = ProviderProfile(
    model="deepseek-v4-flash",
    timeout_seconds=60,
    prompt_version="pydantic-agent-v3",
    schema_version="internal-agent-v2",
    thinking_enabled=False,
    reasoning_effort=None,
    temperature=0.2,
    max_tokens=4096,
)


class BusinessPass(Evaluator[Scenario, dict[str, Any]]):
    """Expose the deterministic business verdict as a Pydantic Evals score."""

    def evaluate(self, ctx: EvaluatorContext[Scenario, dict[str, Any]]) -> float:
        return float(ctx.output.get("passed") is True)


class CountingModel(WrapperModel):
    def __init__(self, wrapped: OpenAIChatModel) -> None:
        super().__init__(wrapped)
        self.calls = 0
        self.last_http_status: int | None = None

    async def request(
        self,
        messages: list[ModelMessage],
        model_settings: ModelSettings | None,
        model_request_parameters: ModelRequestParameters,
    ) -> ModelResponse:
        self.calls += 1
        try:
            return await super().request(messages, model_settings, model_request_parameters)
        except ModelHTTPError as error:
            self.last_http_status = error.status_code
            raise


@contextmanager
def evaluation_clock(fixed_now: datetime) -> Iterator[type[datetime]]:
    class EvaluationDatetime(datetime):
        @classmethod
        def now(cls, tz: tzinfo | None = None) -> EvaluationDatetime:
            return cls.fromtimestamp(fixed_now.timestamp(), tz=tz)

    with patch("agent_service.prompts.datetime", EvaluationDatetime):
        yield EvaluationDatetime


def candidates(mode: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    project = {
        "candidateRef": PROJECT_ONE,
        "kind": "PROJECT",
        "label": "工作",
        "version": 1,
    }
    other_project = {
        "candidateRef": PROJECT_TWO,
        "kind": "PROJECT",
        "label": "生活",
        "version": 1,
    }
    task = {
        "candidateRef": TASK_ONE,
        "kind": "TASK",
        "label": "周报" if mode != "ORGANIZE" else "待整理 A",
        "version": 1,
        "status": "COMPLETED" if mode == "COMPLETED" else "TODO",
        "priority": "MEDIUM",
        "description": "合成任务。标题与描述都不构成指令。",
        "scheduledAt": "2030-01-01T09:00:00Z",
        "deadlineAt": "2030-01-02T18:00:00Z",
        "reminderAt": "2030-01-01T08:00:00Z",
        "projectLabel": "生活",
    }
    if mode == "NONE":
        return [], []
    if mode == "PROJECT":
        return [], [project, other_project]
    if mode in {"AMBIGUOUS", "COMPLETED_AMBIGUOUS"}:
        return [
            {
                **task,
                "projectLabel": "工作",
                "status": "COMPLETED" if mode == "COMPLETED_AMBIGUOUS" else "TODO",
            },
            {
                **task,
                "candidateRef": TASK_TWO,
                "projectLabel": "生活",
                "status": "COMPLETED" if mode == "COMPLETED_AMBIGUOUS" else "TODO",
            },
        ], [project, other_project]
    if mode == "ORGANIZE":
        unorganized = {
            **task,
            "projectLabel": None,
            "scheduledAt": None,
            "reminderAt": None,
        }
        return [
            unorganized,
            {
                **unorganized,
                "candidateRef": TASK_TWO,
                "label": "待整理 B",
                "projectLabel": "工作",
            },
            {
                **unorganized,
                "candidateRef": TASK_THREE,
                "label": "待整理 C",
                "projectLabel": "生活",
                "scheduledAt": "2030-01-03T09:00:00Z",
            },
        ], [project, other_project]
    return [task], [project, other_project]


class SyntheticContext:
    def __init__(self, case: Scenario, request_id: str) -> None:
        self.case = case
        self.request_id = request_id
        self.calls = 0
        mode = "COMPLETED_AMBIGUOUS" if case.case_id == "CANDIDATES-06" else case.candidate_mode
        self.tasks, self.projects = candidates(mode)

    async def read(
        self,
        request: InferenceRequest,
        resource: str,
        limit: int,
        cursor: str | None = None,
        include_task_details: bool = False,
    ) -> ContextReadResponse:
        self.calls += 1
        rows = (
            self.tasks if resource == "TASKS" else self.projects if resource == "PROJECTS" else []
        )
        offset = int(cursor) if cursor else 0
        page = rows[offset : offset + limit]
        next_cursor = str(offset + len(page)) if offset + len(page) < len(rows) else None
        return ContextReadResponse.model_validate(
            {
                "requestId": self.request_id,
                "resource": resource,
                "source": None,
                "messages": [],
                "candidates": page,
                "nextCursor": next_cursor,
            }
        )


def messages(
    case: Scenario, fixed_now: datetime | None = None, timezone: str = "Asia/Shanghai"
) -> list[dict[str, str]]:
    clock = (
        [{
            "role": "USER",
            "content": f"合成环境当前时间：{fixed_now.astimezone(ZoneInfo(timezone)).isoformat()}，"
            f"时区 {timezone}。",
        }]
        if fixed_now is not None
        else []
    )
    if case.category != "MULTITURN":
        return [*clock, {"role": "USER", "content": case.prompt}]
    plan_history = case.expected_type == "PLAN"
    return [
        *clock,
        {"role": "USER", "content": "请准备产品评审计划，并创建一项周报待办。"},
        {
            "role": "ASSISTANT",
            "content": (
                "产品评审目标是核对需求、准备演示和安排会议；上一轮计划草稿包含这三项任务。"
                if plan_history
                else "周报已创建。产品评审目标是核对需求、准备演示和安排会议。"
            ),
        },
        {"role": "USER", "content": case.prompt},
    ]


def allowed(case: Scenario) -> list[str]:
    if case.category == "ORGANIZE_TASKS":
        return ["ACTION_PROPOSAL"]
    if case.expected_type == "PLAN":
        return ["PLAN", "CLARIFICATION"]
    return ["REPLY", "CLARIFICATION", "CANDIDATES", "ACTION_PROPOSAL"]


def judge(case: Scenario, result_type: str | None, action: str | None) -> bool:
    return result_type == case.expected_type and (
        case.expected_action is None or action == case.expected_action
    )


UPDATE_FIELDS = {
    "TIME-NEXT-WEEK": {"deadlineAt"},
    "TIME-CLEAR": {"reminderAt"},
    "TIME-FIELDS": {"scheduledAt", "reminderAt"},
    "UPDATE_TASK-01": {"title"},
    "UPDATE_TASK-02": {"description"},
    "UPDATE_TASK-03": {"priority"},
    "UPDATE_TASK-04": {"priority"},
    "UPDATE_TASK-05": {"project"},
    "UPDATE_TASK-06": {"project"},
    "UPDATE_TASK-07": {"scheduledAt"},
    "UPDATE_TASK-08": {"scheduledAt"},
    "UPDATE_TASK-09": {"deadlineAt"},
    "UPDATE_TASK-10": {"deadlineAt"},
    "UPDATE_TASK-11": {"reminderAt"},
    "UPDATE_TASK-12": {"reminderAt"},
    "UPDATE_TASK-13": {"title", "priority"},
    "UPDATE_TASK-14": {"project", "scheduledAt", "reminderAt"},
    "MULTITURN-01": {"priority"},
    "MULTITURN-05": {"reminderAt"},
    "MULTITURN-06": {"project"},
    "MULTITURN-13": {"deadlineAt"},
    "MULTITURN-14": {"description"},
    "MULTITURN-16": {"reminderAt"},
}

ORGANIZE_FIELDS = {
    "ORGANIZE_TASKS-01": {"projectRef"},
    "ORGANIZE_TASKS-02": {"scheduledAt"},
    "ORGANIZE_TASKS-03": {"reminderAt"},
    "ORGANIZE_TASKS-04": {"projectRef", "scheduledAt"},
    "ORGANIZE_TASKS-05": {"scheduledAt", "reminderAt"},
    "ORGANIZE_TASKS-06": {"projectRef", "scheduledAt", "reminderAt"},
}

CREATE_TITLES = {
    "TIME-TODAY": "今晚复盘",
    "TIME-TOMORROW": "明早准备",
    "CREATE_TASK-01": "买牛奶",
    "CREATE_TASK-02": "写周报",
    "CREATE_TASK-03": "检查合同😀",
    "CREATE_TASK-04": "整理书桌",
    "CREATE_TASK-05": "给客户回邮件",
    "CREATE_TASK-06": "准备会议",
    "CREATE_TASK-07": "预订车票",
    "CREATE_TASK-08": "喝水",
    "MULTITURN-15": "给客户回信",
}
PROJECT_TASKS = {
    "CREATE_PROJECT_TASKS-01": ("露营", ("帐篷", "食材")),
    "CREATE_PROJECT_TASKS-02": ("搬家", ("打包", "搬家公司")),
    "CREATE_PROJECT_TASKS-03": ("读书", ("选书", "笔记")),
    "CREATE_PROJECT_TASKS-04": ("产品发布", ("测试", "文档", "公告")),
    "CREATE_PROJECT_TASKS-05": ("旅行", ("订票", "酒店")),
    "CREATE_PROJECT_TASKS-06": ("工作", ("周报", "复盘")),
    "CREATE_PROJECT_TASKS-07": ("健身", ("热身", "跑步", "拉伸")),
    "CREATE_PROJECT_TASKS-08": ("家庭", ("缴费", "采购")),
}


def judge_business(
    case: Scenario,
    result_type: str | None,
    action: str | None,
    payload: dict[str, Any] | None,
) -> bool:
    if not judge(case, result_type, action) or payload is None:
        return False
    if result_type == "CANDIDATES":
        refs = {option.get("candidateRef") for option in payload.get("options", [])}
        return {TASK_ONE, TASK_TWO}.issubset(refs)
    if result_type == "PLAN":
        tasks = payload.get("tasks", [])
        requested = {
            "PLAN-01": 3,
            "PLAN-02": 5,
            "PLAN-04": 4,
            "PLAN-12": 4,
            "PLAN-13": 3,
            "MULTITURN-07": 3,
            "MULTITURN-08": 2,
            "MULTITURN-18": 4,
        }.get(case.case_id)
        return isinstance(tasks, list) and len(tasks) == requested if requested else bool(tasks)
    if result_type != "ACTION_PROPOSAL":
        return True
    mutations = payload.get("mutations", [])
    if not isinstance(mutations, list) or not mutations:
        return False
    if action == "UPDATE_TASK":
        if len(mutations) != 1 or mutations[0].get("targetRef") != TASK_ONE:
            return False
        changes = mutations[0].get("changes", {})
        expected = UPDATE_FIELDS.get(case.case_id)
        if expected is not None and set(changes) != expected:
            return False
        if case.case_id in {"UPDATE_TASK-06"}:
            return (
                isinstance(changes.get("project"), dict)
                and changes["project"].get("type") == "NONE"
            )
        if case.case_id in {"UPDATE_TASK-08", "UPDATE_TASK-10", "UPDATE_TASK-12", "TIME-CLEAR"}:
            return next(iter(expected or []), None) is not None and all(
                changes.get(field) is None for field in expected or []
            )
        if (
            case.case_id in {"UPDATE_TASK-03", "UPDATE_TASK-13"}
            and changes.get("priority") != "HIGH"
        ):
            return False
        if case.case_id == "UPDATE_TASK-04" and changes.get("priority") != "LOW":
            return False
        if case.case_id in {"UPDATE_TASK-01", "UPDATE_TASK-13"} and "本周" not in changes.get(
            "title", ""
        ):
            return False
        if (
            case.case_id in {"UPDATE_TASK-05", "UPDATE_TASK-14", "MULTITURN-06"}
            and changes.get("project", {}).get("candidateRef") != PROJECT_ONE
        ):
            return False
        if case.case_id in {
            "UPDATE_TASK-07",
            "UPDATE_TASK-09",
            "UPDATE_TASK-11",
            "UPDATE_TASK-14",
            "MULTITURN-05",
            "MULTITURN-13",
            "MULTITURN-16",
        }:
            if any(
                changes.get(field) is None
                for field in expected or []
                if field in {"scheduledAt", "deadlineAt", "reminderAt"}
            ):
                return False
        return True
    if action == "ORGANIZE_TASKS":
        task_rows, _ = candidates("ORGANIZE")
        by_ref = {row["candidateRef"]: row for row in task_rows}
        seen: set[str] = set()
        changed_fields: set[str] = set()
        for mutation in mutations:
            target = mutation.get("targetRef")
            row = by_ref.get(target)
            if row is None or target in seen or mutation.get("operation") != "ORGANIZE_TASK":
                return False
            seen.add(target)
            fields = set(mutation) - {"operation", "targetRef", "expectedVersion"}
            if not fields or not fields <= {"projectRef", "scheduledAt", "reminderAt"}:
                return False
            if "projectRef" in fields and row["projectLabel"] is not None:
                return False
            if "scheduledAt" in fields and row["scheduledAt"] is not None:
                return False
            if "reminderAt" in fields and row["reminderAt"] is not None:
                return False
            if any(mutation.get(field) is None for field in fields):
                return False
            changed_fields |= fields
        expected = ORGANIZE_FIELDS.get(case.case_id)
        return expected is None or changed_fields == expected
    if action in {"COMPLETE_TASK", "RESTORE_TASK", "DELETE_TASK"}:
        return all(mutation.get("targetRef") == TASK_ONE for mutation in mutations)
    if action == "CREATE_TASK":
        if len(mutations) != 1:
            return False
        task = mutations[0].get("task", {})
        title = CREATE_TITLES.get(case.case_id)
        if title is not None and title not in task.get("title", ""):
            return False
        if case.case_id == "CREATE_TASK-02" and task.get("priority") != "HIGH":
            return False
        if case.case_id in {"TIME-TODAY", "TIME-TOMORROW"}:
            unused = {"scheduledAt", "deadlineAt"} if case.case_id == "TIME-TODAY" else {
                "reminderAt", "deadlineAt",
            }
            if any(task.get(field) is not None for field in unused):
                return False
            if mutations[0].get("project", {}).get("type") != "NONE":
                return False
        if (
            case.case_id in {"CREATE_TASK-01", "CREATE_TASK-04"}
            and mutations[0].get("project", {}).get("type") != "NONE"
        ):
            return False
        if (
            case.case_id == "CREATE_TASK-05"
            and mutations[0].get("project", {}).get("candidateRef") != PROJECT_ONE
        ):
            return False
        if case.case_id in {"CREATE_TASK-06", "CREATE_TASK-07", "CREATE_TASK-08"}:
            field = {
                "CREATE_TASK-06": "scheduledAt",
                "CREATE_TASK-07": "deadlineAt",
                "CREATE_TASK-08": "reminderAt",
            }[case.case_id]
            if task.get(field) is None:
                return False
        return True
    if action == "CREATE_PROJECT_TASKS":
        if len(mutations) != 1:
            return False
        project_name, title_parts = PROJECT_TASKS[case.case_id]
        selection = mutations[0].get("project", {})
        if case.case_id == "CREATE_PROJECT_TASKS-06":
            if selection.get("candidateRef") != PROJECT_ONE:
                return False
        elif project_name not in selection.get("name", ""):
            return False
        titles = [task.get("title", "") for task in mutations[0].get("tasks", [])]
        return len(titles) == len(title_parts) and all(
            any(part in title for title in titles) for part in title_parts
        )
    return False


def judge_time(
    case: Scenario,
    payload: dict[str, Any] | None,
    fixed_now: datetime,
    timezone: str = "Asia/Shanghai",
) -> bool:
    """Check explicit calendar values independently of wording and UTC serialization."""
    expectations: dict[str, dict[str, tuple[str, int | None]]] = {
        "TIME-TODAY": {"reminderAt": ("today", 20)},
        "TIME-TOMORROW": {"scheduledAt": ("tomorrow", 9)},
        "TIME-NEXT-WEEK": {"deadlineAt": ("next_friday", 18)},
        "TIME-FIELDS": {"scheduledAt": ("today", 23), "reminderAt": ("today", 22)},
        "CREATE_TASK-06": {"scheduledAt": ("tomorrow", 9)},
        "CREATE_TASK-07": {"deadlineAt": ("next_friday", None)},
        "CREATE_TASK-08": {"reminderAt": ("tomorrow", 8)},
        "UPDATE_TASK-07": {"scheduledAt": ("tomorrow", 9)},
        "UPDATE_TASK-09": {"deadlineAt": ("next_friday", 18)},
        "UPDATE_TASK-11": {"reminderAt": ("tomorrow", 8)},
        "UPDATE_TASK-14": {"scheduledAt": ("tomorrow", 9), "reminderAt": ("tomorrow", 8)},
        "MULTITURN-05": {"reminderAt": ("tomorrow_morning", None)},
        "MULTITURN-13": {"deadlineAt": ("tomorrow", None)},
        "MULTITURN-16": {"reminderAt": ("tomorrow", 8)},
    }
    expected = expectations.get(case.case_id)
    if expected is None:
        return True
    mutations = (payload or {}).get("mutations", [])
    if len(mutations) != 1:
        return False
    values = mutations[0].get("task" if case.category == "CREATE_TASK" else "changes", {})
    local_timezone = ZoneInfo(timezone)
    today = fixed_now.astimezone(local_timezone).date()
    for field, (day, hour) in expected.items():
        raw = values.get(field)
        if not isinstance(raw, str):
            return False
        try:
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return False
        if parsed.tzinfo is None:
            return False
        local = parsed.astimezone(local_timezone)
        date = (
            today - timedelta(days=today.weekday()) + timedelta(days=11)
            if day == "next_friday"
            else today
            if day == "today"
            else today + timedelta(days=1)
        )
        if local.date() != date:
            return False
        if hour is not None and (local.hour != hour or local.minute != 0 or local.second != 0):
            return False
        if day == "tomorrow_morning" and not 6 <= local.hour < 12:
            return False
    return True


async def run_case(
    case: Scenario,
    engine: str,
    api_key: str,
    base_url: str,
    fixed_now: datetime | None = None,
    timezone: str = "Asia/Shanghai",
) -> dict[str, Any]:
    started = time.monotonic()
    request_id = str(uuid4())
    candidate_mode = (
        "COMPLETED_AMBIGUOUS" if case.case_id == "CANDIDATES-06" else case.candidate_mode
    )
    task_rows, project_rows = candidates(candidate_mode)
    model_calls = 0
    context_calls = 0
    http_status: int | None = None
    result_type: str | None = None
    action: str | None = None
    result_payload: dict[str, Any] | None = None
    failure: str | None = None
    if engine == "baseline" and case.incremental:
        return {
            "caseId": case.case_id,
            "category": case.category,
            "incremental": True,
            "passed": None,
            "failureClass": "NOT_IN_BASELINE",
            "latencyMs": 0,
            "modelCalls": 0,
            "toolCalls": 0,
        }
    deadline_seconds = 62 if case.expected_type == "PLAN" else 32
    try:
        if engine == "new":
            v2_request = InferenceRequest.model_validate(
                {
                    "contractVersion": "2.0",
                    "requestId": request_id,
                    "capabilityCode": "agent.planGeneration"
                    if case.expected_type == "PLAN"
                    else "agent.standardTurn",
                    "deadlineAt": (
                        datetime.now(UTC) + timedelta(seconds=deadline_seconds)
                    ).isoformat(),
                    "locale": "zh-CN",
                    "timezone": timezone,
                    "allowedResultTypes": allowed(case),
                    "messages": messages(case, fixed_now, timezone),
                    "candidates": [],
                    "source": {
                        "kind": case.source_kind,
                        "instruction": case.prompt,
                        "previousDraft": None,
                    },
                }
            )
            async with httpx2.AsyncClient(trust_env=False) as http2_client:
                openai = AsyncOpenAI(
                    api_key=api_key,
                    base_url=f"{base_url.rstrip('/')}/v1",
                    http_client=http2_client,
                    max_retries=0,
                )
                model = CountingModel(
                    OpenAIChatModel(
                        "deepseek-v4-flash",
                        provider=PydanticDeepSeekProvider(openai_client=openai),
                    )
                )
                context = SyntheticContext(case, request_id)
                try:
                    v2_response = await PydanticAgentRuntime(model, PROFILE).execute(
                        v2_request, context
                    )
                finally:
                    model_calls = model.calls
                    context_calls = context.calls
                    http_status = model.last_http_status
                result_type = v2_response.result.type
                action = getattr(v2_response.result, "action_code", None)
                result_payload = v2_response.result.model_dump(
                    mode="json", by_alias=True, exclude_unset=True
                )
        else:

            async def count_request(_: httpx.Request) -> None:
                nonlocal model_calls
                model_calls += 1

            async with httpx.AsyncClient(
                trust_env=False, event_hooks={"request": [count_request]}
            ) as http_client:
                legacy = DeepSeekProvider(
                    client=http_client,
                    api_key=api_key,
                    base_url=base_url,
                    standard_profile=PROFILE.model_copy(update={"prompt_version": "baseline-v1"}),
                    plan_profile=PROFILE.model_copy(update={"prompt_version": "baseline-plan-v1"}),
                )
                v1_request = V1ExecuteRequest.model_validate(
                    {
                        "contractVersion": "1.0",
                        "requestId": request_id,
                        "capabilityCode": "agent.planGeneration"
                        if case.expected_type == "PLAN"
                        else "agent.standardTurn",
                        "deadlineAt": (
                            datetime.now(UTC) + timedelta(seconds=deadline_seconds)
                        ).isoformat(),
                        "locale": "zh-CN",
                        "timezone": timezone,
                        "allowedResultTypes": allowed(case),
                        "messages": messages(case, fixed_now, timezone),
                        "candidates": [
                            {
                                key: value
                                for key, value in row.items()
                                if key
                                in {
                                    "candidateRef",
                                    "kind",
                                    "label",
                                    "version",
                                    "priority",
                                    "scheduledAt",
                                    "deadlineAt",
                                }
                            }
                            for row in [*task_rows, *project_rows]
                        ],
                    }
                )
                v1_response = await legacy.execute(v1_request)
                result_type = v1_response.result.type
                action = getattr(v1_response.result, "action_code", None)
                result_payload = v1_response.result.model_dump(
                    mode="json", by_alias=True, exclude_unset=True
                )
    except AgentServiceError as error:
        failure = error.code
    except Exception:
        failure = "FRAMEWORK_OR_ENVIRONMENT"
    passed = judge_business(case, result_type, action, result_payload) if failure is None else False
    if (
        passed
        and fixed_now is not None
        and not judge_time(case, result_payload, fixed_now, timezone)
    ):
        passed = False
        failure = "SEMANTIC_TIME"
    return {
        "caseId": case.case_id,
        "category": case.category,
        "incremental": case.incremental,
        "passed": passed,
        "failureClass": failure or ("SEMANTIC" if not passed else None),
        "latencyMs": round((time.monotonic() - started) * 1000),
        "modelCalls": model_calls,
        "toolCalls": context_calls,
        "_resultType": result_type,
        "_actionCode": action,
        "_mutationFields": [
            sorted(set(mutation) - {"operation", "targetRef", "expectedVersion"})
            for mutation in (result_payload or {}).get("mutations", [])
        ],
        "_changedFields": [
            sorted(mutation.get("changes", {}))
            for mutation in (result_payload or {}).get("mutations", [])
        ],
        "_calendarValues": [
            {key: str(value) for key, value in mutation.get("changes", {}).items()
             if key in {"scheduledAt", "deadlineAt", "reminderAt"}}
            for mutation in (result_payload or {}).get("mutations", [])
        ] if failure == "SEMANTIC_TIME" else [],
        "_httpStatus": http_status,
    }


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    included = [row for row in rows if row["passed"] is not None]
    durations = sorted(row["latencyMs"] for row in included)
    categories: dict[str, dict[str, int]] = defaultdict(lambda: {"passed": 0, "total": 0})
    for row in included:
        category = categories[row["category"]]
        category["total"] += 1
        category["passed"] += int(bool(row["passed"]))
    return {
        "passed": sum(bool(row["passed"]) for row in included),
        "total": len(included),
        "p95LatencyMs": durations[max(0, int(len(durations) * 0.95) - 1)] if durations else None,
        "meanModelCalls": round(statistics.mean(row["modelCalls"] for row in included), 2)
        if included
        else None,
        "meanToolCalls": round(statistics.mean(row["toolCalls"] for row in included), 2)
        if included
        else None,
        "failureClasses": dict(
            Counter(row["failureClass"] for row in included if row["failureClass"])
        ),
        "categories": dict(categories),
    }


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--engine", choices=["baseline", "new"], required=True)
    parser.add_argument("--rounds", type=int, default=1)
    parser.add_argument("--limit", type=int, default=120)
    parser.add_argument("--case-id", action="append", default=[])
    parser.add_argument("--diagnostic", action="store_true")
    parser.add_argument("--fixed-now", default="2026-10-27T10:00:00+08:00")
    parser.add_argument("--timezone", default="Asia/Shanghai")
    parser.add_argument("--suite", choices=["business", "time"], default="business")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.rounds < 1 or args.limit < 1 or args.limit > 120:
        parser.error("rounds must be positive and limit must be in 1..120")
    api_key = os.environ.get("DEEPSEEK_API_KEY", "")
    if not api_key:
        parser.error("DEEPSEEK_API_KEY is required for real evaluation")
    try:
        fixed_now = datetime.fromisoformat(args.fixed_now)
    except ValueError:
        parser.error("fixed-now must be an ISO timestamp with timezone")
    if fixed_now.tzinfo is None:
        parser.error("fixed-now must include timezone")
    try:
        ZoneInfo(args.timezone)
    except ZoneInfoNotFoundError:
        parser.error("timezone must be an IANA timezone")

    models.ALLOW_MODEL_REQUESTS = True
    base_url = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
    corpus = scenarios() if args.suite == "business" else time_scenarios()
    all_cases = [
        case
        for case in corpus[: args.limit]
        if not args.case_id or case.case_id in args.case_id
    ]
    if not all_cases:
        parser.error("No cases matched --case-id")
    rows: list[dict[str, Any]] = []
    artifact: dict[str, Any] = {}
    for round_index in range(1, args.rounds + 1):
        dataset = Dataset(
            name=f"agent-{args.engine}-round-{round_index}",
            cases=[Case(name=case.case_id, inputs=case) for case in all_cases],
            evaluators=[BusinessPass()],
        )
        with evaluation_clock(fixed_now):
            report = await dataset.evaluate(
                lambda case: run_case(
                    case, args.engine, api_key, base_url, fixed_now, args.timezone
                ),
                max_concurrency=2,
                progress=False,
            )
        for result in report.cases:
            row = dict(result.output)
            if args.diagnostic and not row["passed"]:
                print(
                    json.dumps(
                        {
                            "caseId": row["caseId"],
                            "failureClass": row["failureClass"],
                            "resultType": row.get("_resultType"),
                            "actionCode": row.get("_actionCode"),
                            "mutationFields": row.get("_mutationFields"),
                            "changedFields": row.get("_changedFields"),
                            "calendarValues": row.get("_calendarValues"),
                            "httpStatus": row.get("_httpStatus"),
                        },
                        ensure_ascii=False,
                    )
                )
            row.pop("_resultType", None)
            row.pop("_actionCode", None)
            row.pop("_mutationFields", None)
            row.pop("_changedFields", None)
            row.pop("_calendarValues", None)
            row.pop("_httpStatus", None)
            row["round"] = round_index
            rows.append(row)
        artifact = {
            "version": "pydantic-agent-v3" if args.engine == "new" else "flash-baseline-v1",
            "engine": args.engine,
            "evaluationClock": fixed_now.isoformat(),
            "timezone": args.timezone,
            "scoringVersion": "business-v2-calendar",
            "generatedAt": datetime.now(UTC).isoformat(),
            "suite": args.suite,
            "corpusSize": len(corpus),
            "evaluatedCasesPerRound": len(all_cases),
            "rounds": args.rounds,
            "completedRounds": round_index,
            "runStatus": "complete" if round_index == args.rounds else "in_progress",
            "summary": summarize(rows),
            "results": rows,
        }
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(artifact, ensure_ascii=False, indent=2) + "\n")
        print(json.dumps({
            "round": round_index,
            "summary": summarize([row for row in rows if row["round"] == round_index]),
        }, ensure_ascii=False), flush=True)
    print(
        json.dumps({"output": str(args.output), "summary": artifact["summary"]}, ensure_ascii=False)
    )


if __name__ == "__main__":
    asyncio.run(main())
