from __future__ import annotations

import base64
from pathlib import Path

import pytest
from pydantic import ValidationError

from agent_service.config import Settings, _default_config_root

VALID_TOKEN = "c3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3M"
TOO_LONG_CANONICAL_TOKEN = base64.urlsafe_b64encode(b"x" * 385).rstrip(b"=").decode()


@pytest.mark.parametrize(
    "invalid_token",
    [
        "short",
        "!" * 43,
        "+" * 43,
        "/" * 43,
        ("a" * 43) + "=",
        "a" * 43,
        TOO_LONG_CANONICAL_TOKEN,
    ],
)
def test_service_token_is_strict_unpadded_base64url_with_at_least_256_bits(
    invalid_token: str,
) -> None:
    with pytest.raises(ValidationError):
        Settings(
            service_token=invalid_token,
            deepseek_api_key="test-key",
            deepseek_base_url="https://api.deepseek.invalid",
        )


def test_service_token_accepts_a_canonical_256_bit_value() -> None:
    settings = Settings(
        service_token=VALID_TOKEN,
        deepseek_api_key="test-key",
        deepseek_base_url="https://api.deepseek.invalid",
    )

    assert settings.service_token.get_secret_value() == VALID_TOKEN


def test_provider_configuration_loads_committed_yaml_profiles() -> None:
    repository_root = Path(__file__).resolve().parents[3]

    settings = Settings.from_environment(
        {
            "AGENT_SERVICE_TOKEN": VALID_TOKEN,
            "DEEPSEEK_API_KEY": "test-key",
            "AI_SCHEDULE_CONFIG_ROOT": str(repository_root / "config"),
        }
    )

    assert settings.deepseek_base_url == "https://api.deepseek.com"
    assert settings.standard_profile.model == "deepseek-v4-flash"
    assert settings.standard_profile.timeout_seconds == 30
    assert settings.plan_profile.model == "deepseek-v4-pro"
    assert settings.plan_profile.timeout_seconds == 60


def test_default_config_root_does_not_depend_on_source_depth(tmp_path: Path) -> None:
    config_root = tmp_path / "runtime/config"
    provider_directory = config_root / "providers"
    provider_directory.mkdir(parents=True)
    (provider_directory / "agent.yaml").write_text("version: 1\n", encoding="utf-8")

    assert _default_config_root(tmp_path / "runtime/src/agent_service/config.py") == config_root


def test_provider_configuration_requires_both_profiles(tmp_path: Path) -> None:
    providers = tmp_path / "providers"
    providers.mkdir()
    (providers / "agent.yaml").write_text(
        """version: 1
provider: deepseek
baseUrl: https://api.deepseek.com
profiles:
  standard:
    model: deepseek-v4-flash
    timeoutMs: 30000
    promptVersion: p0-v1
    schemaVersion: p0-v1
""",
        encoding="utf-8",
    )

    with pytest.raises(ValidationError):
        Settings.from_environment(
            {
                "AGENT_SERVICE_TOKEN": VALID_TOKEN,
                "DEEPSEEK_API_KEY": "test-key",
                "AI_SCHEDULE_CONFIG_ROOT": str(tmp_path),
            }
        )
