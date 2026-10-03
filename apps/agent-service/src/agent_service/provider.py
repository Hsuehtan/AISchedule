from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

import httpx
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError

from agent_service.config import ProviderProfile
from agent_service.context import InferenceRequest
from agent_service.errors import AgentServiceError
from agent_service.generated.internal_agent_v1 import (
    ActionProposalResult,
    CandidateContext,
    CandidatesResult,
    ClarificationResult,
    CompleteTaskMutation,
    CreateProjectTasksMutation,
    CreateTaskMutation,
    DeleteTaskMutation,
    ExecuteRequest,
    ExecuteResponse,
    ExecuteResult,
    ExistingProjectSelection,
    OrganizeTaskMutation,
    PlanResult,
    RestoreTaskMutation,
    UpdateTaskMutation,
)
from agent_service.prompts import build_prompts, build_repair_messages


class DeepSeekMessage(BaseModel):
    model_config = ConfigDict(extra="ignore")

    content: str


class DeepSeekChoice(BaseModel):
    model_config = ConfigDict(extra="ignore")

    message: DeepSeekMessage


class DeepSeekEnvelope(BaseModel):
    model_config = ConfigDict(extra="ignore")

    choices: list[DeepSeekChoice] = Field(min_length=1)


RESULT_ADAPTER: TypeAdapter[ExecuteResult] = TypeAdapter(ExecuteResult)
PROVIDER_BYTES_PER_OUTPUT_TOKEN = 8
PROVIDER_ENVELOPE_ALLOWANCE_BYTES = 16 * 1024
PROVIDER_READ_CHUNK_BYTES = 8 * 1024


class DeepSeekProvider:
    def __init__(
        self,
        *,
        client: httpx.AsyncClient,
        api_key: str,
        base_url: str,
        standard_profile: ProviderProfile,
        plan_profile: ProviderProfile,
    ) -> None:
        self._client = client
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._standard_profile = standard_profile
        self._plan_profile = plan_profile

    async def execute(self, request: ExecuteRequest | InferenceRequest) -> ExecuteResponse:
        profile = self._profile_for(request)
        system_prompt, user_prompt = build_prompts(request)
        initial_messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]
        content = await self._complete(profile, initial_messages, request.deadline_at)
        repair_attempts = 0
        try:
            result = self._validate_result(content, request)
        except (ValidationError, ValueError):
            if not content.strip():
                raise self._invalid_output() from None
            repair_attempts = 1
            repaired = await self._complete(
                profile,
                build_repair_messages(request, content),
                request.deadline_at,
            )
            try:
                result = self._validate_result(repaired, request)
            except (ValidationError, ValueError) as error:
                raise self._invalid_output() from error

        return ExecuteResponse.model_validate(
            {
                "contractVersion": "1.0",
                "requestId": request.request_id,
                "resolved": {
                    "provider": "DEEPSEEK",
                    "model": profile.model,
                    "promptVersion": profile.prompt_version,
                    "providerSchemaVersion": profile.schema_version,
                    "repairAttempts": repair_attempts,
                },
                "result": result.model_dump(mode="json", by_alias=True, exclude_unset=True),
            }
        )

    def _profile_for(self, request: ExecuteRequest | InferenceRequest) -> ProviderProfile:
        if request.capability_code == "agent.planGeneration":
            return self._plan_profile
        return self._standard_profile

    def _validate_result(
        self, content: str, request: ExecuteRequest | InferenceRequest
    ) -> ExecuteResult:
        if not content.strip():
            raise ValueError("empty output")
        result: ExecuteResult = RESULT_ADAPTER.validate_json(content)
        if result.type not in request.allowed_result_types:
            raise ValueError("result type is not allowed")
        self._validate_correlations(result, request)
        return result

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
                self._require_candidate(
                    candidates,
                    mutation.target_ref,
                    kind="TASK",
                    expected_version=mutation.expected_version,
                )
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

    async def _complete(
        self,
        profile: ProviderProfile,
        messages: list[dict[str, str]],
        deadline_at: datetime,
    ) -> str:
        remaining_seconds = (deadline_at - datetime.now(UTC)).total_seconds()
        if remaining_seconds <= 0:
            raise AgentServiceError(
                code="PROVIDER_TIMEOUT",
                status_code=504,
                message="Provider request deadline elapsed",
            )
        body: dict[str, Any] = {
            "model": profile.model,
            "messages": messages,
            "response_format": {"type": "json_object"},
            "stream": False,
            "temperature": profile.temperature,
            "max_tokens": profile.max_tokens,
            "thinking": {"type": "enabled" if profile.thinking_enabled else "disabled"},
        }
        if profile.reasoning_effort is not None:
            body["reasoning_effort"] = profile.reasoning_effort
        response_limit = (
            profile.max_tokens * PROVIDER_BYTES_PER_OUTPUT_TOKEN + PROVIDER_ENVELOPE_ALLOWANCE_BYTES
        )
        try:
            async with self._client.stream(
                "POST",
                f"{self._base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "Accept-Encoding": "identity",
                    "Content-Type": "application/json",
                },
                json=body,
                timeout=httpx.Timeout(min(profile.timeout_seconds, remaining_seconds)),
                follow_redirects=False,
            ) as response:
                if response.status_code == 429:
                    raise AgentServiceError(
                        code="PROVIDER_RATE_LIMITED",
                        status_code=502,
                        message="Provider is temporarily rate limited",
                    )
                if not 200 <= response.status_code < 300:
                    raise AgentServiceError(
                        code="PROVIDER_UNAVAILABLE",
                        status_code=502,
                        message="Provider is unavailable",
                    )
                raw_response = await self._read_response_within_limit(
                    response,
                    response_limit,
                )
        except httpx.TimeoutException as error:
            raise AgentServiceError(
                code="PROVIDER_TIMEOUT", status_code=504, message="Provider request timed out"
            ) from error
        except httpx.RequestError as error:
            raise AgentServiceError(
                code="PROVIDER_UNAVAILABLE",
                status_code=502,
                message="Provider is unavailable",
            ) from error

        try:
            envelope = DeepSeekEnvelope.model_validate(json.loads(raw_response))
        except (ValueError, ValidationError) as error:
            raise self._invalid_output() from error
        return envelope.choices[0].message.content

    async def _read_response_within_limit(
        self,
        response: httpx.Response,
        limit: int,
    ) -> bytes:
        content_length = response.headers.get("content-length")
        if content_length is not None:
            try:
                if int(content_length) > limit:
                    raise self._invalid_output()
            except ValueError:
                raise self._invalid_output() from None
        body = bytearray()
        async for chunk in response.aiter_bytes(chunk_size=PROVIDER_READ_CHUNK_BYTES):
            if len(body) + len(chunk) > limit:
                raise self._invalid_output()
            body.extend(chunk)
        return bytes(body)

    @staticmethod
    def _invalid_output() -> AgentServiceError:
        return AgentServiceError(
            code="PROVIDER_OUTPUT_INVALID",
            status_code=502,
            message="Provider returned unusable output",
        )
