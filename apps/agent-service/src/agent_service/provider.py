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
    ExecuteRequest,
    ExecuteResponse,
    ExecuteResult,
)
from agent_service.generated.internal_agent_v2 import ExecuteResult as V2ExecuteResult
from agent_service.prompts import build_prompts, build_repair_messages
from agent_service.result_correlation import ResultCorrelationValidator


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
V2_RESULT_ADAPTER: TypeAdapter[V2ExecuteResult] = TypeAdapter(V2ExecuteResult)
PROVIDER_BYTES_PER_OUTPUT_TOKEN = 8
PROVIDER_ENVELOPE_ALLOWANCE_BYTES = 16 * 1024
PROVIDER_READ_CHUNK_BYTES = 8 * 1024


class DeepSeekProvider(ResultCorrelationValidator):
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
        self._validate_correlations(
            V2_RESULT_ADAPTER.validate_python(
                result.model_dump(mode="json", by_alias=True, exclude_unset=True)
            ),
            request,
        )
        return result

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
