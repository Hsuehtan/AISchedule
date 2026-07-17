from __future__ import annotations

import time
from typing import Protocol

from agent_service.generated.internal_agent_v1 import ExecuteRequest, ExecuteResponse
from agent_service.provider import DeepSeekProvider
from agent_service.safe_logging import SafeJsonLogger


class AgentOrchestrator(Protocol):
    async def execute(self, request: ExecuteRequest) -> ExecuteResponse: ...


class ProviderAgentOrchestrator:
    def __init__(self, provider: DeepSeekProvider, logger: SafeJsonLogger | None = None) -> None:
        self._provider = provider
        self._logger = logger or SafeJsonLogger()

    async def execute(self, request: ExecuteRequest) -> ExecuteResponse:
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
