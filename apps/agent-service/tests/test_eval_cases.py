from collections import Counter
from typing import Any

from pydantic_evals import Case, Dataset

from evals.cases import scenarios
from evals.run import PROJECT_ONE, TASK_ONE, BusinessPass, judge, judge_business


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
