"""Cross-field and candidate-reference validation shared by both inference engines."""

from __future__ import annotations

from agent_service.context import InferenceRequest
from agent_service.generated.internal_agent_v1 import CandidateContext, ExecuteRequest
from agent_service.generated.internal_agent_v2 import (
    ActionProposalResult,
    CandidatesResult,
    ClarificationResult,
    CompleteTaskMutation,
    CreateProjectTasksMutation,
    CreateTaskMutation,
    DeleteTaskMutation,
    ExecuteResult,
    ExistingProjectSelection,
    OrganizeTaskMutation,
    PlanResult,
    RestoreTaskMutation,
    UpdateTaskMutation,
)


class ResultCorrelationValidator:
    def _validate_correlations(
        self, result: ExecuteResult, request: ExecuteRequest | InferenceRequest
    ) -> None:
        candidates = {candidate.candidate_ref: candidate for candidate in request.candidates}
        if len(candidates) != len(request.candidates):
            raise ValueError("request contains duplicate candidate references")

        if isinstance(result, ClarificationResult):
            self._require_unique([option.option_id for option in result.options])
            return

        if isinstance(result, CandidatesResult):
            self._require_unique([option.option_id for option in result.options])
            self._require_unique([option.candidate_ref for option in result.options])
            for option in result.options:
                self._require_candidate(candidates, option.candidate_ref)
            return

        if isinstance(result, PlanResult):
            self._validate_project_selection(result.project, candidates)
            self._require_unique([task.client_ref for task in result.tasks])
            return

        if isinstance(result, ActionProposalResult):
            self._validate_action_proposal(result, candidates)

    def _validate_action_proposal(
        self,
        result: ActionProposalResult,
        candidates: dict[str, CandidateContext],
    ) -> None:
        expected_operations = {
            "CREATE_TASK": "CREATE_TASK",
            "CREATE_PROJECT_TASKS": "CREATE_PROJECT_TASKS",
            "ORGANIZE_TASKS": "ORGANIZE_TASK",
            "UPDATE_TASK": "UPDATE_TASK",
            "COMPLETE_TASK": "COMPLETE_TASK",
            "RESTORE_TASK": "RESTORE_TASK",
            "DELETE_TASK": "DELETE_TASK",
        }
        expected_operation = expected_operations[result.action_code]
        if (
            result.action_code in {"CREATE_TASK", "CREATE_PROJECT_TASKS"}
            and len(result.mutations) != 1
        ):
            raise ValueError("create actions require exactly one mutation")
        if result.action_code == "ORGANIZE_TASKS" and len(result.mutations) > 20:
            raise ValueError("organize actions exceed the batch limit")
        draft_refs: list[str] = []
        target_refs: list[str] = []
        for mutation in result.mutations:
            if mutation.operation != expected_operation:
                raise ValueError("action code and mutation operation do not match")
            if isinstance(mutation, CreateTaskMutation):
                self._validate_project_selection(mutation.project, candidates)
                draft_refs.append(mutation.task.client_ref)
            elif isinstance(mutation, CreateProjectTasksMutation):
                self._validate_project_selection(mutation.project, candidates)
                draft_refs.extend(task.client_ref for task in mutation.tasks)
            elif isinstance(mutation, OrganizeTaskMutation):
                if (
                    mutation.project_ref is None
                    and mutation.scheduled_at is None
                    and mutation.reminder_at is None
                ):
                    raise ValueError("organize mutation has no changes")
                self._require_candidate(
                    candidates,
                    mutation.target_ref,
                    kind="TASK",
                    expected_version=mutation.expected_version,
                )
                if mutation.project_ref is not None:
                    self._require_candidate(candidates, mutation.project_ref, kind="PROJECT")
                target_refs.append(mutation.target_ref)
            elif isinstance(
                mutation,
                (
                    UpdateTaskMutation,
                    CompleteTaskMutation,
                    RestoreTaskMutation,
                    DeleteTaskMutation,
                ),
            ):
                self._require_candidate(
                    candidates,
                    mutation.target_ref,
                    kind="TASK",
                    expected_version=mutation.expected_version,
                )
                if isinstance(mutation, UpdateTaskMutation) and mutation.changes.project:
                    self._validate_project_selection(mutation.changes.project, candidates)
                target_refs.append(mutation.target_ref)
        self._require_unique(draft_refs)
        self._require_unique(target_refs)

    def _validate_project_selection(
        self,
        selection: object,
        candidates: dict[str, CandidateContext],
    ) -> None:
        if isinstance(selection, ExistingProjectSelection):
            self._require_candidate(candidates, selection.candidate_ref, kind="PROJECT")

    @staticmethod
    def _require_candidate(
        candidates: dict[str, CandidateContext],
        candidate_ref: str,
        *,
        kind: str | None = None,
        expected_version: int | None = None,
    ) -> CandidateContext:
        candidate = candidates.get(candidate_ref)
        if candidate is None:
            raise ValueError("model returned an unknown candidate reference")
        if kind is not None and candidate.kind != kind:
            raise ValueError("model returned a candidate with the wrong kind")
        if expected_version is not None and candidate.version != expected_version:
            raise ValueError("model returned a stale candidate version")
        return candidate

    @staticmethod
    def _require_unique(values: list[str]) -> None:
        if len(values) != len(set(values)):
            raise ValueError("model returned duplicate references")
