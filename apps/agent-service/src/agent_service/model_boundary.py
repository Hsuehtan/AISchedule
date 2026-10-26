"""Enforce per-execute budgets at the actual model request boundary."""

from __future__ import annotations

from dataclasses import replace

from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    RetryPromptPart,
    ToolReturnPart,
)
from pydantic_ai.models import Model, ModelRequestParameters
from pydantic_ai.models.wrapper import WrapperModel
from pydantic_ai.settings import ModelSettings

from agent_service.errors import AgentServiceError
from agent_service.read_tools import RunReadState


class RunModelBoundary(WrapperModel):
    def __init__(self, model: Model, state: RunReadState) -> None:
        super().__init__(model)
        self.state = state
        self.calls = 0
        self.repairs = 0
        self._seen_retries: set[int] = set()

    async def request(
        self,
        messages: list[ModelMessage],
        model_settings: ModelSettings | None,
        model_request_parameters: ModelRequestParameters,
    ) -> ModelResponse:
        retries = [
            part
            for message in messages
            if isinstance(message, ModelRequest)
            for part in message.parts
            if (
                isinstance(part, RetryPromptPart)
                or (isinstance(part, ToolReturnPart) and part.outcome == "retried")
            )
            and id(part) not in self._seen_retries
        ]
        if retries:
            self._seen_retries.update(id(part) for part in retries)
            output_names = {tool.name for tool in model_request_parameters.output_tools}
            if any(
                part.tool_name is not None and part.tool_name not in output_names
                for part in retries
            ):
                raise AgentServiceError(
                    "PROVIDER_OUTPUT_INVALID", 502, "Read tool parameters or tool name invalid"
                )
            self.repairs += 1
            if self.repairs > 1:
                raise AgentServiceError("PROVIDER_OUTPUT_INVALID", 502, "Output repair exhausted")
            self.state.repairing = True
        if self.calls >= 4 or (self.calls >= 3 and not self.state.repairing):
            raise AgentServiceError("EXECUTION_BUDGET_EXCEEDED", 502, "Agent budget exhausted")
        if self.calls >= 2 or self.state.repairing:
            model_request_parameters = replace(model_request_parameters, function_tools=[])
        self.calls += 1
        return await super().request(messages, model_settings, model_request_parameters)
