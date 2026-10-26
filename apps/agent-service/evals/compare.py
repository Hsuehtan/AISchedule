"""Produce a reproducible comparison and enforce the approved real-evaluation gates."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from evals.cases import scenarios
from evals.run import summarize


def _rows(artifact: dict[str, Any], rounds: int, baseline: bool) -> list[dict[str, Any]]:
    cases = {case.case_id: case for case in scenarios()}
    rows: list[dict[str, Any]] = artifact["results"]
    expected = {(case_id, iteration) for case_id in cases for iteration in range(1, rounds + 1)}
    if (
        artifact.get("runStatus") != "complete"
        or artifact.get("completedRounds") != rounds
        or artifact.get("rounds") != rounds
        or len(rows) != 120 * rounds
        or {(row["caseId"], row["round"]) for row in rows} != expected
    ):
        raise ValueError("Evidence must contain all 120 distinct cases in every completed round")
    for row in rows:
        case = cases[row["caseId"]]
        if row["category"] != case.category:
            raise ValueError("Case category does not match the frozen corpus")
        if not (baseline and case.incremental) and not isinstance(row["passed"], bool):
            raise ValueError("Every eligible case must have an explicit pass or fail verdict")
    return rows


def compare(baseline: dict[str, Any], current: dict[str, Any]) -> dict[str, Any]:
    if any(
        baseline.get(key) != current.get(key)
        for key in ("evaluationClock", "scoringVersion")
    ) or baseline.get("timezone", "Asia/Shanghai") != current.get("timezone", "Asia/Shanghai"):
        raise ValueError("Versions must use the same clock, timezone and scoring rules")
    before = _rows(baseline, 1, True)
    after = _rows(current, 3, False)
    cases = {case.case_id: case for case in scenarios()}
    comparable = {case_id for case_id, case in cases.items() if not case.incremental}
    rounds = [summarize([row for row in after if row["round"] == number]) for number in range(1, 4)]
    summary = summarize(after)
    standard = summarize([row for row in after if cases[row["caseId"]].expected_type != "PLAN"])
    plan = summarize([row for row in after if cases[row["caseId"]].expected_type == "PLAN"])
    model_max = max(row["modelCalls"] for row in after)
    tool_max = max(row["toolCalls"] for row in after)
    gates = {
        "eachRoundAtLeast95Percent": all(row["passed"] / row["total"] >= 0.95 for row in rounds),
        "eachCategoryAtLeast90Percent": all(
            category["passed"] / category["total"] >= 0.90
            for category in summary["categories"].values()
        ),
        "standardP95AtMost30Seconds": standard["p95LatencyMs"] <= 30_000,
        "planP95AtMost60Seconds": plan["p95LatencyMs"] <= 60_000,
        "modelCallsAtMost4": model_max <= 4,
        "toolCallsAtMost6": tool_max <= 6,
        "providerAndEnvironmentEvidenceComplete": not any(
            row["failureClass"] in {
                "PROVIDER_UNAVAILABLE", "PROVIDER_TIMEOUT", "PROVIDER_RATE_LIMITED",
                "CONTEXT_UNAVAILABLE",
                "FRAMEWORK_OR_ENVIRONMENT", "DEADLINE_EXCEEDED",
            }
            for row in after
        ),
    }
    return {
        "status": "passed" if all(gates.values()) else "failed",
        "baselineVersion": baseline["version"],
        "newVersion": current["version"],
        "evaluationClock": current["evaluationClock"],
        "timezone": current.get("timezone", "Asia/Shanghai"),
        "scoringVersion": current["scoringVersion"],
        "eligibilitySource": (
            "corpus-capability-v2; v1 lacks project updates and multifield organize"
        ),
        "incrementalCaseIds": sorted(set(cases) - comparable),
        "baselineComparable": summarize([row for row in before if row["caseId"] in comparable]),
        "newComparable": summarize([row for row in after if row["caseId"] in comparable]),
        "incremental": summarize([row for row in after if row["caseId"] not in comparable]),
        "newAll": summary,
        "rounds": [{"round": number, **row} for number, row in enumerate(rounds, 1)],
        "standardRequests": standard,
        "planRequests": plan,
        "maxModelCalls": model_max,
        "maxToolCalls": tool_max,
        "gates": gates,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--new", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = compare(json.loads(args.baseline.read_text()), json.loads(args.new.read_text()))
    report["sources"] = {"baseline": args.baseline.name, "new": args.new.name}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({
        "output": str(args.output), "status": report["status"], "gates": report["gates"],
    }))
    if report["status"] != "passed":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
