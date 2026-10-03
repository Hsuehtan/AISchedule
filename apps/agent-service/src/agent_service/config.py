from __future__ import annotations

import base64
import os
import re
from collections.abc import Mapping
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

import yaml
from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator, model_validator


def _default_config_root(module_file: Path = Path(__file__)) -> Path:
    for parent in module_file.resolve().parents:
        candidate = parent / "config"
        if (candidate / "providers/agent.yaml").is_file():
            return candidate
    return Path("/app/config")


class ProviderProfile(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    model: str = Field(min_length=1, max_length=100)
    timeout_seconds: int = Field(gt=0, le=120)
    prompt_version: str = Field(min_length=1, max_length=64)
    schema_version: str = Field(min_length=1, max_length=64)
    thinking_enabled: bool
    reasoning_effort: str | None
    temperature: float = Field(ge=0, le=2)
    max_tokens: int = Field(gt=0, le=8192)


class ProviderFileProfile(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    model: str = Field(min_length=1, max_length=100)
    timeout_ms: int = Field(alias="timeoutMs", gt=0, le=120_000)
    prompt_version: str = Field(alias="promptVersion", min_length=1, max_length=64)
    schema_version: str = Field(alias="schemaVersion", min_length=1, max_length=64)


class ProviderFileProfiles(BaseModel):
    model_config = ConfigDict(extra="forbid")

    standard: ProviderFileProfile
    plan: ProviderFileProfile


class AgentProviderFile(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    version: Literal[1]
    provider: Literal["deepseek"]
    base_url: str = Field(alias="baseUrl")
    profiles: ProviderFileProfiles


class Settings(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    service_token: SecretStr
    context_service_token: SecretStr | None = None
    context_url: str = "http://127.0.0.1:3000"
    deepseek_api_key: SecretStr
    deepseek_base_url: str = "https://api.deepseek.com"
    max_body_bytes: int = Field(default=262_144, gt=0, le=262_144)
    max_concurrency: int = Field(default=4, gt=0, le=64)
    production: bool = True
    standard_profile: ProviderProfile = ProviderProfile(
        model="deepseek-v4-flash",
        timeout_seconds=30,
        prompt_version="p0-v1",
        schema_version="p0-v1",
        thinking_enabled=False,
        reasoning_effort=None,
        temperature=0.2,
        max_tokens=2048,
    )
    plan_profile: ProviderProfile = ProviderProfile(
        model="deepseek-v4-pro",
        timeout_seconds=60,
        prompt_version="p0-plan-v1",
        schema_version="p0-plan-v1",
        thinking_enabled=True,
        reasoning_effort="high",
        temperature=0.2,
        max_tokens=4096,
    )

    @field_validator("service_token")
    @classmethod
    def validate_service_token(cls, value: SecretStr) -> SecretStr:
        token = value.get_secret_value()
        if re.fullmatch(r"[A-Za-z0-9_-]{43,512}", token) is None:
            raise ValueError("AGENT_SERVICE_TOKEN must be unpadded base64url")
        try:
            decoded = base64.b64decode(
                token + ("=" * (-len(token) % 4)),
                altchars=b"-_",
                validate=True,
            )
        except (ValueError, UnicodeEncodeError) as error:
            raise ValueError("AGENT_SERVICE_TOKEN must be base64url") from error
        if len(decoded) < 32:
            raise ValueError("AGENT_SERVICE_TOKEN must contain at least 256 bits")
        canonical = base64.urlsafe_b64encode(decoded).rstrip(b"=").decode("ascii")
        if canonical != token:
            raise ValueError("AGENT_SERVICE_TOKEN must use canonical base64url encoding")
        return value

    @field_validator("context_service_token")
    @classmethod
    def validate_context_token(cls, value: SecretStr | None) -> SecretStr | None:
        return cls.validate_service_token(value) if value is not None else None

    @field_validator("context_url")
    @classmethod
    def validate_context_url(cls, value: str) -> str:
        parsed = urlsplit(value)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.path not in {"", "/"}
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("AGENT_CONTEXT_URL must be a fixed HTTP(S) origin")
        return value.rstrip("/")

    @model_validator(mode="after")
    def validate_independent_tokens(self) -> Settings:
        if (
            self.context_service_token is not None
            and self.context_service_token == self.service_token
        ):
            raise ValueError("Context and execute credentials must be independent")
        return self

    @field_validator("deepseek_api_key")
    @classmethod
    def validate_api_key(cls, value: SecretStr) -> SecretStr:
        if not value.get_secret_value().strip():
            raise ValueError("DEEPSEEK_API_KEY is required")
        return value

    @field_validator("deepseek_base_url")
    @classmethod
    def validate_base_url(cls, value: str) -> str:
        normalized = value.rstrip("/")
        if not normalized.startswith("https://"):
            raise ValueError("DEEPSEEK_BASE_URL must use HTTPS")
        return normalized

    @classmethod
    def from_environment(cls, environment: Mapping[str, str] | None = None) -> Settings:
        source = os.environ if environment is None else environment
        default_config_root = _default_config_root()
        config_root = Path(source.get("AI_SCHEDULE_CONFIG_ROOT", str(default_config_root)))
        provider_file = AgentProviderFile.model_validate(
            yaml.safe_load((config_root / "providers/agent.yaml").read_text(encoding="utf-8"))
        )
        standard = provider_file.profiles.standard
        plan = provider_file.profiles.plan
        return cls(
            context_service_token=source.get("AGENT_CONTEXT_SERVICE_TOKEN"),
            context_url=source.get("AGENT_CONTEXT_URL", "http://127.0.0.1:3000"),
            service_token=source.get("AGENT_SERVICE_TOKEN", ""),
            deepseek_api_key=source.get("DEEPSEEK_API_KEY", ""),
            deepseek_base_url=source.get("DEEPSEEK_BASE_URL", provider_file.base_url),
            max_body_bytes=int(source.get("AGENT_MAX_BODY_BYTES", "262144")),
            max_concurrency=int(source.get("AGENT_MAX_CONCURRENCY", "4")),
            production=source.get("AGENT_ENV", "production") == "production",
            standard_profile=ProviderProfile(
                model=standard.model,
                timeout_seconds=standard.timeout_ms // 1000,
                prompt_version=standard.prompt_version,
                schema_version=standard.schema_version,
                thinking_enabled=False,
                reasoning_effort=None,
                temperature=0.2,
                max_tokens=2048,
            ),
            plan_profile=ProviderProfile(
                model=plan.model,
                timeout_seconds=plan.timeout_ms // 1000,
                prompt_version=plan.prompt_version,
                schema_version=plan.schema_version,
                thinking_enabled=True,
                reasoning_effort="high",
                temperature=0.2,
                max_tokens=4096,
            ),
        )
