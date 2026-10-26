"""Typed inference inside one business-owned execute request."""

from __future__ import annotations

import asyncio
import os
from datetime import UTC, datetime
from typing import cast

from pydantic import BaseModel, TypeAdapter, ValidationError

os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")

from pydantic_ai import Agent, ModelRetry, RunContext, ToolOutput, UsageLimits
from pydantic_ai.exceptions import (
    ModelHTTPError,
    ModelTimeoutError,
    UnexpectedModelBehavior,
    UsageLimitExceeded,
)
from pydantic_ai.models import Model
from pydantic_ai.models.openai import OpenAIChatModelSettings

from agent_service.config import ProviderProfile
from agent_service.context import InferenceRequest
from agent_service.errors import AgentServiceError
from agent_service.generated.internal_agent_v1 import (
    ActionProposalResult as V1ActionProposalResult,
)
from agent_service.generated.internal_agent_v1 import (
    CandidatesResult as V1CandidatesResult,
)
from agent_service.generated.internal_agent_v1 import (
    ClarificationResult as V1ClarificationResult,
)
from agent_service.generated.internal_agent_v1 import (
    PlanResult as V1PlanResult,
)
from agent_service.generated.internal_agent_v1 import (
    ReplyResult as V1ReplyResult,
)
from agent_service.generated.internal_agent_v2 import (
    ActionProposalResult,
    CandidatesResult,
    ClarificationResult,
    ExecuteResponse,
    ExecuteResult,
    OrganizeTaskMutation,
    PlanResult,
    ReplyResult,
)
from agent_service.model_boundary import RunModelBoundary
from agent_service.prompts import build_agent_prompts
from agent_service.read_tools import ContextPages, RunReadState
from agent_service.result_correlation import ResultCorrelationValidator

RESULT_ADAPTER: TypeAdapter[ExecuteResult] = TypeAdapter(ExecuteResult)
RESULT_MODELS = {
    "REPLY": ReplyResult,
    "CLARIFICATION": ClarificationResult,
    "CANDIDATES": CandidatesResult,
    "PLAN": PlanResult,
    "ACTION_PROPOSAL": ActionProposalResult,
}
LEGACY_RESULT_MODELS = {
    "REPLY": V1ReplyResult,
    "CLARIFICATION": V1ClarificationResult,
    "CANDIDATES": V1CandidatesResult,
    "PLAN": V1PlanResult,
    "ACTION_PROPOSAL": V1ActionProposalResult,
}


class PydanticAgentRuntime(ResultCorrelationValidator):
    def __init__(self, model: Model, profile: ProviderProfile) -> None:
        self._model = model
        self._profile = profile

    async def execute(
        self,
        request: InferenceRequest,
        client: ContextPages | None = None,
        *,
        legacy_output: bool = False,
    ) -> ExecuteResponse:
        remaining = (request.deadline_at - datetime.now(UTC)).total_seconds() - 2
        if remaining <= 0:
            raise AgentServiceError("PROVIDER_TIMEOUT", 504, "Provider deadline expired")
        system, user = build_agent_prompts(request)
        state = RunReadState(request, cast(ContextPages, client))
        boundary = RunModelBoundary(self._model, state)
        result_models = LEGACY_RESULT_MODELS if legacy_output else RESULT_MODELS
        outputs = [
            ToolOutput(result_models[name], name=f"emit_{name.lower()}", max_retries=1)
            for name in request.allowed_result_types
        ]
        agent: Agent[RunReadState, object] = Agent(
            boundary,
            output_type=outputs,
            instructions=system,
            deps_type=RunReadState,
            model_settings=OpenAIChatModelSettings(
                thinking=False,
                max_retries=0,
                max_tokens=self._profile.max_tokens,
                temperature=self._profile.temperature,
                parallel_tool_calls=False,
                timeout=min(self._profile.timeout_seconds, remaining),
            ),
            retries=1,
        )
        if client is not None:

            @agent.tool
            async def read_tasks(ctx: RunContext[RunReadState]) -> dict[str, object]:
                """Read the next page of authorized tasks and their opaque references."""
                return await ctx.deps.read_page(ctx, "TASKS")

            @agent.tool
            async def read_projects(ctx: RunContext[RunReadState]) -> dict[str, object]:
                """Read the next page of authorized projects and their opaque references."""
                return await ctx.deps.read_page(ctx, "PROJECTS")

            @agent.tool
            async def read_history(ctx: RunContext[RunReadState]) -> dict[str, object]:
                """Read an earlier page of settled conversation messages."""
                return await ctx.deps.read_page(ctx, "MESSAGES")

        repair_attempts = 0

        @agent.output_validator
        def validate_output(output: object) -> object:
            nonlocal repair_attempts
            try:
                if not isinstance(output, BaseModel):
                    raise ValueError("Result is not a typed output")
                typed = RESULT_ADAPTER.validate_python(
                    output.model_dump(mode="json", by_alias=True, exclude_unset=True)
                )
                self._validate_correlations(typed, request)
                if typed.type == "ACTION_PROPOSAL":
                    is_organize = typed.action_code == "ORGANIZE_TASKS"
                    organize_intent = request.source.kind == "ORGANIZE" or any(
                        word in (request.source.instruction or "")
                        for word in ("整理", "归类", "批量")
                    )
                    if (request.source.kind == "ORGANIZE" and not is_organize) or (
                        is_organize and not organize_intent
                    ):
                        raise ValueError("Action does not match request source")
                    if is_organize:
                        for mutation in typed.mutations:
                            if not isinstance(mutation, OrganizeTaskMutation):
                                continue
                            details = state.task_details.get(mutation.target_ref)
                            if details is None:
                                continue
                            if details.get("status") not in {None, "TODO"}:
                                raise ValueError("Organize target is not pending")
                            if (
                                mutation.project_ref is not None
                                and details.get("projectLabel") is not None
                            ):
                                raise ValueError("Organize would overwrite project")
                            if (
                                mutation.scheduled_at is not None
                                and details.get("scheduledAt") is not None
                            ):
                                raise ValueError("Organize would overwrite schedule")
                            if (
                                mutation.reminder_at is not None
                                and details.get("reminderAt") is not None
                            ):
                                raise ValueError("Organize would overwrite reminder")
            except (ValueError, ValidationError):
                repair_attempts += 1
                state.repairing = True
                if repair_attempts > 1:
                    raise AgentServiceError(
                        "PROVIDER_OUTPUT_INVALID", 502, "Provider output invalid"
                    ) from None
                raise ModelRetry(
                    "Result fields, references, or Action type are invalid. "
                    "Use UPDATE_TASK for an explicitly named task field change; "
                    "ORGANIZE_TASKS is only valid for an explicit organizing request "
                    "and must never overwrite non-empty fields."
                ) from None
            return output

        try:
            async with asyncio.timeout(remaining):
                result = await agent.run(
                    user,
                    deps=state,
                    usage_limits=UsageLimits(request_limit=4, tool_calls_limit=6),
                    timeout=remaining,
                )
        except TimeoutError:
            raise AgentServiceError("PROVIDER_TIMEOUT", 504, "Provider timed out") from None
        except ModelTimeoutError:
            raise AgentServiceError("PROVIDER_TIMEOUT", 504, "Provider timed out") from None
        except ModelHTTPError as error:
            if error.status_code == 429:
                raise AgentServiceError(
                    "PROVIDER_RATE_LIMITED", 502, "Provider rate limited"
                ) from None
            raise AgentServiceError("PROVIDER_UNAVAILABLE", 502, "Provider unavailable") from None
        except UsageLimitExceeded:
            raise AgentServiceError(
                "EXECUTION_BUDGET_EXCEEDED", 502, "Agent budget exhausted"
            ) from None
        except UnexpectedModelBehavior:
            raise AgentServiceError(
                "PROVIDER_OUTPUT_INVALID", 502, "Provider output invalid"
            ) from None
        output = result.output
        if (
            not isinstance(output, BaseModel)
            or getattr(output, "type", None) not in request.allowed_result_types
        ):
            raise AgentServiceError("PROVIDER_OUTPUT_INVALID", 502, "Provider output invalid")
        return ExecuteResponse.model_validate(
            {
                "contractVersion": "2.0",
                "requestId": request.request_id,
                "resolved": {
                    "provider": "DEEPSEEK",
                    "model": self._profile.model,
                    "promptVersion": self._profile.prompt_version,
                    "providerSchemaVersion": self._profile.schema_version,
                    "repairAttempts": min(max(repair_attempts, boundary.repairs), 1),
                },
                "result": output.model_dump(mode="json", by_alias=True, exclude_unset=True),
            }
        )
