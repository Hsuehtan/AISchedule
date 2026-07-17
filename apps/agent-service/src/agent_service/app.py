from __future__ import annotations

import asyncio
import json
import secrets
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

import httpx
from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from agent_service.config import Settings
from agent_service.errors import AgentServiceError
from agent_service.generated.internal_agent_v1 import (
    MAX_PROJECT_CANDIDATES,
    MAX_TASK_CANDIDATES,
    MESSAGE_CONTENT_MAX_BYTES,
    ErrorResponse,
    ExecuteRequest,
    ExecuteResponse,
    HealthResponse,
)
from agent_service.orchestrator import AgentOrchestrator, ProviderAgentOrchestrator
from agent_service.provider import DeepSeekProvider

SERVICE_BEARER = HTTPBearer(
    auto_error=False,
    scheme_name="serviceBearer",
    bearerFormat="opaque-256-bit",
)
ServiceCredentials = Annotated[
    HTTPAuthorizationCredentials | None,
    Depends(SERVICE_BEARER),
]


class BodyLimitMiddleware:
    def __init__(self, app: ASGIApp, max_body_bytes: int) -> None:
        self._app = app
        self._max_body_bytes = max_body_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self._app(scope, receive, send)
            return
        headers = dict(scope.get("headers", []))
        content_length = headers.get(b"content-length")
        if content_length is not None:
            try:
                if int(content_length) > self._max_body_bytes:
                    await self._send_too_large(send)
                    return
            except ValueError:
                await self._send_too_large(send)
                return

        consumed = 0
        buffered: list[Message] = []
        while True:
            message = await receive()
            if message["type"] != "http.request":
                buffered.append(message)
                break
            consumed += len(message.get("body", b""))
            if consumed > self._max_body_bytes:
                await self._send_too_large(send)
                return
            buffered.append(message)
            if not message.get("more_body", False):
                break

        async def replay() -> Message:
            if buffered:
                return buffered.pop(0)
            return {"type": "http.request", "body": b"", "more_body": False}

        await self._app(scope, replay, send)

    @staticmethod
    async def _send_too_large(send: Send) -> None:
        payload = json.dumps(
            {
                "error": {
                    "code": "REQUEST_TOO_LARGE",
                    "message": "Request body exceeds the service limit",
                    "requestId": None,
                }
            },
            separators=(",", ":"),
        ).encode()
        await send(
            {
                "type": "http.response.start",
                "status": 413,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(payload)).encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": payload})


class ConcurrencyLimiter:
    def __init__(self, maximum: int) -> None:
        self._maximum = maximum
        self._active = 0
        self._lock = asyncio.Lock()

    async def try_acquire(self) -> bool:
        async with self._lock:
            if self._active >= self._maximum:
                return False
            self._active += 1
            return True

    async def release(self) -> None:
        async with self._lock:
            self._active = max(0, self._active - 1)


def error_response(
    *, code: str, message: str, status_code: int, request_id: str | None = None
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "error": {"code": code, "message": message, "requestId": request_id},
        },
    )


def validate_semantic_request(request: ExecuteRequest) -> bool:
    message_bytes = sum(len(message.content.encode("utf-8")) for message in request.messages)
    candidate_refs = [candidate.candidate_ref for candidate in request.candidates]
    task_count = sum(candidate.kind == "TASK" for candidate in request.candidates)
    project_count = sum(candidate.kind == "PROJECT" for candidate in request.candidates)
    return (
        message_bytes <= MESSAGE_CONTENT_MAX_BYTES
        and len(candidate_refs) == len(set(candidate_refs))
        and task_count <= MAX_TASK_CANDIDATES
        and project_count <= MAX_PROJECT_CANDIDATES
    )


def default_orchestrator(
    settings: Settings, client: httpx.AsyncClient
) -> ProviderAgentOrchestrator:
    provider = DeepSeekProvider(
        client=client,
        api_key=settings.deepseek_api_key.get_secret_value(),
        base_url=settings.deepseek_base_url,
        standard_profile=settings.standard_profile,
        plan_profile=settings.plan_profile,
    )
    return ProviderAgentOrchestrator(provider)


def create_app(settings: Settings, orchestrator: AgentOrchestrator | None = None) -> FastAPI:
    docs_enabled = not settings.production
    provider_http_client: httpx.AsyncClient | None = None
    if orchestrator is None:
        provider_http_client = httpx.AsyncClient(
            trust_env=False,
            limits=httpx.Limits(
                max_connections=settings.max_concurrency,
                max_keepalive_connections=settings.max_concurrency,
            ),
        )
        selected_orchestrator: AgentOrchestrator = default_orchestrator(
            settings, provider_http_client
        )
    else:
        selected_orchestrator = orchestrator

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        try:
            yield
        finally:
            if provider_http_client is not None:
                await provider_http_client.aclose()

    app = FastAPI(
        title="AI Schedule Internal Agent API",
        version="1.0.0",
        openapi_url="/openapi.json" if docs_enabled else None,
        docs_url="/docs" if docs_enabled else None,
        redoc_url="/redoc" if docs_enabled else None,
        lifespan=lifespan,
    )
    app.add_middleware(BodyLimitMiddleware, max_body_bytes=settings.max_body_bytes)
    if provider_http_client is not None:
        app.state.provider_http_client = provider_http_client
    limiter = ConcurrencyLimiter(settings.max_concurrency)
    expected_token = settings.service_token.get_secret_value()
    expected_token_bytes = expected_token.encode("ascii")

    async def authenticate(credentials: ServiceCredentials) -> None:
        supplied = credentials.credentials if credentials is not None else ""
        scheme_matches = credentials is not None and credentials.scheme == "Bearer"
        try:
            supplied_bytes = supplied.encode("ascii")
            is_ascii = True
        except UnicodeEncodeError:
            supplied_bytes = b"\0" * len(expected_token_bytes)
            is_ascii = False
        token_matches = secrets.compare_digest(supplied_bytes, expected_token_bytes)
        if not scheme_matches or not is_ascii or not token_matches:
            raise AgentServiceError(
                code="UNAUTHORIZED",
                status_code=401,
                message="Service authentication failed",
            )

    @app.exception_handler(AgentServiceError)
    async def handle_service_error(_: Request, error: AgentServiceError) -> JSONResponse:
        return error_response(
            code=error.code,
            message=error.message,
            status_code=error.status_code,
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(_: Request, __: RequestValidationError) -> JSONResponse:
        return error_response(
            code="VALIDATION_ERROR",
            message="Request does not satisfy the internal contract",
            status_code=422,
        )

    @app.get(
        "/internal/health/live",
        response_model=HealthResponse,
        operation_id="getLiveness",
    )
    async def liveness() -> HealthResponse:
        return HealthResponse(status="ok")

    @app.get(
        "/internal/health/ready",
        response_model=HealthResponse,
        operation_id="getReadiness",
        responses={503: {"model": ErrorResponse}},
    )
    async def readiness() -> HealthResponse:
        return HealthResponse(status="ok")

    @app.post(
        "/internal/v1/agent/execute",
        response_model=ExecuteResponse,
        response_model_exclude_unset=True,
        operation_id="executeAgent",
        dependencies=[Depends(authenticate)],
        responses={
            401: {"model": ErrorResponse},
            413: {"model": ErrorResponse},
            422: {"model": ErrorResponse},
            429: {"model": ErrorResponse},
            500: {"model": ErrorResponse},
            502: {"model": ErrorResponse},
            503: {"model": ErrorResponse},
            504: {"model": ErrorResponse},
        },
    )
    async def execute(request: ExecuteRequest) -> ExecuteResponse | JSONResponse:
        if not validate_semantic_request(request):
            return error_response(
                code="VALIDATION_ERROR",
                message="Request does not satisfy the internal contract",
                status_code=422,
                request_id=str(request.request_id),
            )
        if not await limiter.try_acquire():
            return error_response(
                code="CONCURRENCY_LIMIT",
                message="Agent service concurrency limit reached",
                status_code=429,
                request_id=str(request.request_id),
            )
        try:
            try:
                return await selected_orchestrator.execute(request)
            except AgentServiceError as error:
                return error_response(
                    code=error.code,
                    message=error.message,
                    status_code=error.status_code,
                    request_id=str(request.request_id),
                )
            except Exception:
                return error_response(
                    code="INTERNAL_ERROR",
                    message="Agent service failed",
                    status_code=500,
                    request_id=str(request.request_id),
                )
        finally:
            await limiter.release()

    return app
