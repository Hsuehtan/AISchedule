from copy import deepcopy
from typing import Any

import pytest

from evals.cases import scenarios
from evals.compare import compare


def artifact(rounds: int, baseline: bool = False) -> dict[str, Any]:
    return {
        "version": "baseline" if baseline else "new",
        "evaluationClock": "2026-10-27T10:00:00+08:00",
        "scoringVersion": "business-v2-calendar",
        "runStatus": "complete",
        "completedRounds": rounds,
        "rounds": rounds,
        "results": [
            {
                "caseId": case.case_id,
                "category": case.category,
                "round": iteration,
                "passed": None if baseline and case.incremental else True,
                "latencyMs": 1000,
                "modelCalls": 1,
                "toolCalls": 0,
                "failureClass": None,
            }
            for iteration in range(1, rounds + 1)
            for case in scenarios()
        ],
    }


def test_comparison_excludes_unsupported_v1_capabilities_without_dropping_new_cases() -> None:
    result = compare(artifact(1, True), artifact(3))
    assert result["status"] == "passed"
    assert result["baselineComparable"]["total"] == 106
    assert result["newComparable"]["total"] == 318
    assert result["incremental"]["total"] == 42
    assert result["newAll"]["total"] == 360


def test_category_gate_can_fail_even_when_each_round_exceeds_95_percent() -> None:
    current = artifact(3)
    for row in [row for row in current["results"] if row["category"] == "CLARIFICATION"][:4]:
        row["passed"] = False
        row["failureClass"] = "SEMANTIC"
    result = compare(artifact(1, True), current)
    assert result["status"] == "failed"
    assert result["gates"]["eachRoundAtLeast95Percent"]
    assert not result["gates"]["eachCategoryAtLeast90Percent"]


def test_comparison_rejects_incomplete_evidence_and_checks_failed_request_latency() -> None:
    current = artifact(3)
    incomplete = deepcopy(current)
    incomplete["results"].pop()
    with pytest.raises(ValueError, match="120"):
        compare(artifact(1, True), incomplete)
    for row in current["results"][:20]:
        row.update(passed=False, latencyMs=31_000, modelCalls=5)
    result = compare(artifact(1, True), current)
    assert not result["gates"]["standardP95AtMost30Seconds"]
    assert not result["gates"]["modelCallsAtMost4"]


def test_rate_limited_evidence_does_not_pass_as_a_completed_quality_evaluation() -> None:
    current = artifact(3)
    current["results"][0].update(passed=False, failureClass="PROVIDER_RATE_LIMITED")
    result = compare(artifact(1, True), current)
    assert result["gates"]["eachRoundAtLeast95Percent"]
    assert not result["gates"]["providerAndEnvironmentEvidenceComplete"]
