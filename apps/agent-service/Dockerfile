FROM ghcr.io/astral-sh/uv:0.11.23 AS uv

FROM python:3.11.15-slim-bookworm AS builder

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

COPY --from=uv /uv /uvx /bin/
WORKDIR /app

COPY apps/agent-service/pyproject.toml apps/agent-service/uv.lock ./
RUN uv sync --locked --no-dev --no-install-project

FROM python:3.11.15-slim-bookworm AS runtime

ENV PATH="/app/.venv/bin:${PATH}" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN groupadd --gid 10001 agent \
    && useradd --uid 10001 --gid agent --no-create-home --shell /usr/sbin/nologin agent

WORKDIR /app
COPY --from=builder --chown=agent:agent /app/.venv /app/.venv
COPY --chown=agent:agent apps/agent-service/src /app/src
COPY --chown=agent:agent config/providers/agent.yaml /app/config/providers/agent.yaml

USER agent
EXPOSE 8081

CMD ["uvicorn", "agent_service.main:app", "--app-dir", "/app/src", "--host", "0.0.0.0", "--port", "8081", "--no-access-log", "--no-server-header"]
