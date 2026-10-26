from __future__ import annotations

import time
from typing import Protocol

from agent_service.context import (
    DEFAULT_CONTEXT_POLICY,
    ContextPolicy,
    InferenceRequest,
    build_context,
)
from agent_service.context_client import ContextClient
from agent_service.generated.internal_agent_v1 import ExecuteRequest, ExecuteResponse
from agent_service.generated.internal_agent_v2 import ExecuteRequest as V2ExecuteRequest
from agent_service.generated.internal_agent_v2 import ExecuteResponse as V2ExecuteResponse
from agent_service.provider import DeepSeekProvider
from agent_service.pydantic_runtime import PydanticAgentRuntime
from agent_service.safe_logging import SafeJsonLogger


class AgentOrchestrator(Protocol):
    async def execute(self, request: ExecuteRequest) -> ExecuteResponse: ...


class ProviderAgentOrchestrator:
    def __init__(self, provider: DeepSeekProvider, logger: SafeJsonLogger | None = None) -> None:
        self._provider = provider
        self._logger = logger or SafeJsonLogger()

    async def execute(self, request: ExecuteRequest | InferenceRequest) -> ExecuteResponse:
        started = time.monotonic()
        response = await self._provider.execute(request)
        self._logger.emit(
            event="agent.execute.completed",
            requestId=str(request.request_id),
            status="SUCCEEDED",
            resultType=response.result.type,
            provider=response.resolved.provider,
            model=response.resolved.model,
            repairAttempts=response.resolved.repair_attempts,
            durationMs=round((time.monotonic() - started) * 1000),
        )
        return response


class ContextAgentOrchestrator:
    def __init__(
        self,
        provider: DeepSeekProvider,
        context_client: ContextClient,
        policy: ContextPolicy = DEFAULT_CONTEXT_POLICY,
    ) -> None:
        self._provider = provider
        self._inference = ProviderAgentOrchestrator(provider)
        self._context_client = context_client
        self._policy = policy

    async def execute(self, request: V2ExecuteRequest) -> V2ExecuteResponse:
        context = await build_context(request, self._context_client, self._policy)
        # Provider retains the same single-repair policy and shared deadline.
        response = await self._inference.execute(context)
        return V2ExecuteResponse.model_validate(
            {
                **response.model_dump(mode="json", by_alias=True, exclude_unset=True),
                "contractVersion": "2.0",
            }
        )


class PydanticContextOrchestrator:
    def __init__(self, runtime: PydanticAgentRuntime, context_client: ContextClient) -> None:
        self._runtime = runtime
        self._context_client = context_client
        self._logger = SafeJsonLogger()

    async def execute(self, request: V2ExecuteRequest) -> V2ExecuteResponse:
        started = time.monotonic()
        context = await build_context(request, self._context_client, include_candidates=False)
        response = await self._runtime.execute(context, self._context_client)
        self._logger.emit(
            event="agent.execute.completed",
            requestId=str(request.request_id),
            status="SUCCEEDED",
            resultType=response.result.type,
            provider=response.resolved.provider,
            model=response.resolved.model,
            repairAttempts=response.resolved.repair_attempts,
            durationMs=round((time.monotonic() - started) * 1000),
        )
        return response


class LegacyPydanticOrchestrator:
    """Keep the v1 wire contract while using the same bounded model runtime."""

    def __init__(self, runtime: PydanticAgentRuntime) -> None:
        self._runtime = runtime

    async def execute(self, request: ExecuteRequest) -> ExecuteResponse:
        source_kind = "PLAN" if request.capability_code == "agent.planGeneration" else "TURN"
        if request.allowed_result_types == ["ACTION_PROPOSAL"]:
            source_kind = "ORGANIZE"
        instruction = next(
            (message.content for message in reversed(request.messages) if message.role == "USER"),
            None,
        )
        inference = InferenceRequest.model_validate(
            {
                **request.model_dump(mode="json", by_alias=True),
                "contractVersion": "2.0",
                "source": {
                    "kind": source_kind,
                    "instruction": instruction,
                    "previousDraft": None,
                },
            }
        )
        response = await self._runtime.execute(inference, legacy_output=True)
        return ExecuteResponse.model_validate(
            {
                **response.model_dump(mode="json", by_alias=True, exclude_unset=True),
                "contractVersion": "1.0",
            }
        )
