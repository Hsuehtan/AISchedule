from collections import Counter
from datetime import datetime
from typing import Any

from pydantic_evals import Case, Dataset

from evals.cases import scenarios, time_scenarios
from evals.run import (
    PROJECT_ONE,
    TASK_ONE,
    BusinessPass,
    judge,
    judge_business,
    judge_time,
    messages,
)


def test_corpus_has_frozen_business_distribution() -> None:
    rows = scenarios()
    assert len(rows) == len({case.case_id for case in rows}) == 120
    assert Counter(case.category for case in rows) == {
        "REPLY": 8,
        "CLARIFICATION": 10,
        "CANDIDATES": 10,
        "PLAN": 16,
        "CREATE_TASK": 8,
        "CREATE_PROJECT_TASKS": 8,
        "ORGANIZE_TASKS": 10,
        "UPDATE_TASK": 14,
        "COMPLETE_TASK": 6,
        "RESTORE_TASK": 6,
        "DELETE_TASK": 6,
        "MULTITURN": 18,
    }
    assert all(case.prompt and case.expected_type for case in rows)
    assert all(case.incremental for case in rows if case.category == "ORGANIZE_TASKS")
    assert {case.case_id for case in rows if case.incremental} == {
        *(f"ORGANIZE_TASKS-{index:02d}" for index in range(1, 11)),
        "UPDATE_TASK-05", "UPDATE_TASK-06", "UPDATE_TASK-14", "MULTITURN-06",
    }


def test_action_case_requires_matching_action_code() -> None:
    case = next(case for case in scenarios() if case.category == "COMPLETE_TASK")
    assert judge(case, "ACTION_PROPOSAL", "COMPLETE_TASK")
    assert not judge(case, "ACTION_PROPOSAL", "DELETE_TASK")
    assert not judge(case, "REPLY", None)


def test_business_score_rejects_wrong_target_and_unrequested_fields() -> None:
    case = next(case for case in scenarios() if case.case_id == "UPDATE_TASK-03")
    proposal: dict[str, Any] = {
        "type": "ACTION_PROPOSAL",
        "actionCode": "UPDATE_TASK",
        "mutations": [
            {
                "operation": "UPDATE_TASK",
                "targetRef": TASK_ONE,
                "expectedVersion": 1,
                "changes": {"priority": "HIGH"},
            }
        ],
    }
    assert judge_business(case, "ACTION_PROPOSAL", "UPDATE_TASK", proposal)
    proposal["mutations"][0]["targetRef"] = "cand_" + "f" * 32
    assert not judge_business(case, "ACTION_PROPOSAL", "UPDATE_TASK", proposal)
    proposal["mutations"][0]["targetRef"] = TASK_ONE
    proposal["mutations"][0]["changes"]["title"] = "意外修改"
    assert not judge_business(case, "ACTION_PROPOSAL", "UPDATE_TASK", proposal)
    del proposal["mutations"][0]["changes"]["title"]
    proposal["mutations"][0]["changes"]["priority"] = "LOW"
    assert not judge_business(case, "ACTION_PROPOSAL", "UPDATE_TASK", proposal)


def test_pydantic_evals_records_deterministic_business_score() -> None:
    dataset = Dataset(
        name="business-score-smoke",
        cases=[Case(name="reply", inputs=scenarios()[0])],
        evaluators=[BusinessPass()],
    )
    report = dataset.evaluate_sync(lambda _: {"passed": True}, progress=False)
    assert report.cases[0].scores["BusinessPass"].value == 1.0


def test_business_score_uses_candidate_ref_for_existing_project_selection() -> None:
    case = next(case for case in scenarios() if case.case_id == "CREATE_TASK-05")
    proposal: dict[str, Any] = {
        "mutations": [
            {
                "operation": "CREATE_TASK",
                "project": {"type": "EXISTING", "candidateRef": PROJECT_ONE},
                "task": {"title": "给客户回邮件"},
            }
        ]
    }
    assert judge_business(case, "ACTION_PROPOSAL", "CREATE_TASK", proposal)
    proposal["mutations"][0]["project"]["candidateRef"] = TASK_ONE
    assert not judge_business(case, "ACTION_PROPOSAL", "CREATE_TASK", proposal)


def test_calendar_score_checks_timezone_and_exact_requested_hour() -> None:
    case = next(case for case in scenarios() if case.case_id == "UPDATE_TASK-07")
    clock = datetime.fromisoformat("2026-10-27T23:59:59+08:00")
    proposal = {"mutations": [{"changes": {"scheduledAt": "2026-10-28T01:00:00Z"}}]}
    assert judge_time(case, proposal, clock)
    proposal["mutations"][0]["changes"]["scheduledAt"] = "2026-10-28T09:00:00Z"
    assert not judge_time(case, proposal, clock)
    proposal["mutations"][0]["changes"]["scheduledAt"] = "2026-10-29T01:00:00Z"
    assert not judge_time(case, proposal, clock)


def test_calendar_score_next_friday_and_clear_field_semantics() -> None:
    clock = datetime.fromisoformat("2026-10-27T10:00:00+08:00")
    case = next(case for case in scenarios() if case.case_id == "UPDATE_TASK-09")
    proposal = {"mutations": [{"changes": {"deadlineAt": "2026-11-06T10:00:00Z"}}]}
    assert judge_time(case, proposal, clock)
    proposal["mutations"][0]["changes"]["deadlineAt"] = "2026-10-30T10:00:00Z"
    assert not judge_time(case, proposal, clock)
    clear = next(case for case in scenarios() if case.case_id == "UPDATE_TASK-10")
    assert judge_business(clear, "ACTION_PROPOSAL", "UPDATE_TASK", {
        "mutations": [{"targetRef": TASK_ONE, "changes": {"deadlineAt": None}}],
    })


def test_calendar_score_resolves_different_local_dates_at_the_same_instant() -> None:
    case = next(case for case in scenarios() if case.case_id == "UPDATE_TASK-07")
    clock = datetime.fromisoformat("2026-10-27T00:30:00+08:00")
    proposal = {"mutations": [{"changes": {"scheduledAt": "2026-10-27T16:00:00Z"}}]}
    assert judge_time(case, proposal, clock, "America/Los_Angeles")
    assert not judge_time(case, proposal, clock, "Asia/Shanghai")
    assert "2026-10-26T09:30:00-07:00" in messages(case, clock, "America/Los_Angeles")[0][
        "content"
    ]


def test_fixed_clock_is_supplied_identically_to_single_and_multiturn_cases() -> None:
    clock = datetime.fromisoformat("2026-10-27T10:00:00+08:00")
    single = messages(scenarios()[0], clock)
    multiple = messages(next(case for case in scenarios() if case.category == "MULTITURN"), clock)
    assert single[0] == multiple[0]
    assert clock.isoformat() in single[0]["content"]
    assert multiple[-1]["content"].endswith("高优先级。")


def test_supplemental_today_and_field_distinction_do_not_change_business_corpus() -> None:
    assert len(scenarios()) == 120
    assert len({case.case_id for case in time_scenarios()}) == 5
    case = next(case for case in time_scenarios() if case.case_id == "TIME-FIELDS")
    clock = datetime.fromisoformat("2026-10-27T00:30:00+08:00")
    payload = {"mutations": [{"changes": {
        "scheduledAt": "2026-10-27T06:00:00Z", "reminderAt": "2026-10-27T05:00:00Z",
    }}]}
    assert judge_time(case, payload, clock, "America/Los_Angeles")
    assert not judge_time(case, payload, clock, "Asia/Shanghai")
