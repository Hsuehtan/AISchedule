from __future__ import annotations

import json
from pathlib import Path
from typing import Any, cast

import yaml

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]


def load_compose() -> dict[str, Any]:
    return cast(
        dict[str, Any],
        yaml.safe_load((REPOSITORY_ROOT / "compose.yaml").read_text(encoding="utf-8")),
    )


def test_agent_image_is_immutable_non_root_and_disables_access_logs() -> None:
    dockerfile = (REPOSITORY_ROOT / "apps/agent-service/Dockerfile").read_text(encoding="utf-8")

    assert "python:3.11.15-slim-bookworm" in dockerfile
    assert "uv sync --locked --no-dev" in dockerfile
    assert "USER agent" in dockerfile
    assert "WORKDIR /app" in dockerfile
    assert "COPY --from=builder --chown=agent:agent /app/.venv /app/.venv" in dockerfile
    assert "/build/.venv" not in dockerfile
    assert "config/providers/agent.yaml /app/config/providers/agent.yaml" in dockerfile
    assert "COPY --chown=agent:agent config /app/config" not in dockerfile
    assert 'CMD ["uvicorn"' in dockerfile
    assert '"--no-access-log"' in dockerfile


def test_compose_keeps_agent_off_the_postgres_network_and_logs_nowhere() -> None:
    compose = load_compose()
    postgres = compose["services"]["postgres"]
    agent = compose["services"]["agent-service"]

    assert set(postgres["networks"]).isdisjoint(agent["networks"])
    assert agent["logging"] == {"driver": "none"}
    assert agent["read_only"] is True
    assert agent["security_opt"] == ["no-new-privileges:true"]
    assert agent["cap_drop"] == ["ALL"]

    serialized_environment = yaml.safe_dump(agent.get("environment", {}))
    assert "DATABASE_URL" not in serialized_environment
    assert "POSTGRES" not in serialized_environment


def test_host_node_api_can_reach_agent_without_exposing_it_publicly() -> None:
    agent = load_compose()["services"]["agent-service"]

    assert agent["ports"] == ["127.0.0.1:${AGENT_SERVICE_PORT:-8081}:8081"]
    assert agent["environment"]["AGENT_ENV"] == "production"
    assert agent["environment"]["AI_SCHEDULE_CONFIG_ROOT"] == "/app/config"
    assert agent["healthcheck"]["test"][0] == "CMD"


def test_docker_build_context_excludes_local_secret_files() -> None:
    patterns = set((REPOSITORY_ROOT / ".dockerignore").read_text(encoding="utf-8").splitlines())

    assert {".env", ".env.*", "*.pem", "*.key"}.issubset(patterns)


def test_turbo_passes_secrets_only_to_the_processes_that_need_them() -> None:
    root_config = json.loads((REPOSITORY_ROOT / "turbo.json").read_text(encoding="utf-8"))
    agent_config = json.loads(
        (REPOSITORY_ROOT / "apps/agent-service/turbo.json").read_text(encoding="utf-8")
    )
    server_config = json.loads(
        (REPOSITORY_ROOT / "apps/server/turbo.json").read_text(encoding="utf-8")
    )

    root_environment = set(root_config["tasks"]["dev"].get("passThroughEnv", []))
    agent_environment = set(agent_config["tasks"]["dev"]["passThroughEnv"])
    server_environment = set(server_config["tasks"]["dev"]["passThroughEnv"])

    assert "DEEPSEEK_API_KEY" not in root_environment
    assert "AGENT_SERVICE_TOKEN" not in root_environment
    assert "DEEPSEEK_API_KEY" in agent_environment
    assert "DEEPSEEK_API_KEY" not in server_environment
    assert "AGENT_SERVICE_TOKEN" in agent_environment
    assert "AGENT_SERVICE_TOKEN" in server_environment
