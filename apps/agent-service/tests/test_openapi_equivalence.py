from __future__ import annotations

import difflib
import json
from pathlib import Path
from typing import Any, cast

import pytest
import yaml
from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

from agent_service.app import create_app
from agent_service.config import Settings
from agent_service.generated.internal_agent_v1 import ExecuteResponse

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
FIXTURES = REPOSITORY_ROOT / "packages/contracts/internal-agent/v1/fixtures"
CANONICAL_OPENAPI = REPOSITORY_ROOT / "packages/contracts/internal-agent/v1/openapi.yaml"


class UnusedOrchestrator:
    async def execute(self, request: Any) -> ExecuteResponse:
        raise AssertionError("OpenAPI generation must not dispatch inference")


def development_settings() -> Settings:
    return Settings(
        service_token="c3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3M",
        deepseek_api_key="test-key",
        deepseek_base_url="https://api.deepseek.invalid",
        production=False,
    )


def validate_component(document: dict[str, Any], component: str, payload: Any) -> None:
    schema = {"$ref": f"urn:ai-schedule:agent:v1#/components/schemas/{component}"}
    registry = Registry().with_resource(
        "urn:ai-schedule:agent:v1",
        Resource.from_contents(document, default_specification=DRAFT202012),
    )
    validator = Draft202012Validator(
        schema,
        registry=registry,
        format_checker=FormatChecker(),
    )
    validator.validate(payload)


def normalize_schema(
    value: Any,
    components: dict[str, Any],
    resolving: tuple[str, ...] = (),
) -> Any:
    if isinstance(value, list):
        return [normalize_schema(item, components, resolving) for item in value]
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if not isinstance(value, dict):
        return value
    if "$ref" in value:
        name = str(value["$ref"]).rsplit("/", 1)[-1]
        if name in resolving:
            raise AssertionError(f"Recursive schema is not supported: {name}")
        return normalize_schema(components[name], components, (*resolving, name))

    schema_type = value.get("type")
    if isinstance(schema_type, list):
        common = {key: item for key, item in value.items() if key != "type"}
        variants = [
            {"type": item} if item == "null" else {**common, "type": item} for item in schema_type
        ]
        return normalize_schema({"oneOf": variants}, components, resolving)

    normalized: dict[str, Any] = {}
    for key, item in value.items():
        if key in {"title", "description", "default"} or key.startswith("x-"):
            continue
        normalized_key = "oneOf" if key == "anyOf" else key
        if key == "discriminator":
            normalized[normalized_key] = {"propertyName": item["propertyName"]}
            continue
        normalized[normalized_key] = normalize_schema(item, components, resolving)

    for unordered_key in ("required", "enum"):
        if unordered_key in normalized:
            normalized[unordered_key] = sorted(normalized[unordered_key])
    if len(normalized.get("enum", [])) == 1:
        normalized["const"] = normalized.pop("enum")[0]
    if "oneOf" in normalized:
        normalized["oneOf"] = sorted(
            normalized["oneOf"],
            key=lambda item: json.dumps(item, ensure_ascii=False, sort_keys=True),
        )
    return normalized


def test_fastapi_paths_and_operation_ids_match_canonical_contract() -> None:
    document = create_app(development_settings(), UnusedOrchestrator()).openapi()

    operations = {
        (path, method): operation["operationId"]
        for path, path_item in document["paths"].items()
        for method, operation in path_item.items()
    }

    assert operations == {
        ("/internal/health/live", "get"): "getLiveness",
        ("/internal/health/ready", "get"): "getReadiness",
        ("/internal/v1/agent/execute", "post"): "executeAgent",
    }
    assert document["components"]["securitySchemes"]["serviceBearer"] == {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "opaque-256-bit",
    }
    assert document["paths"]["/internal/v1/agent/execute"]["post"]["security"] == [
        {"serviceBearer": []}
    ]


def test_fastapi_component_schemas_are_semantically_equal_to_canonical_openapi() -> None:
    actual_document = create_app(development_settings(), UnusedOrchestrator()).openapi()
    canonical_document = cast(
        dict[str, Any], yaml.safe_load(CANONICAL_OPENAPI.read_text(encoding="utf-8"))
    )
    actual_components = actual_document["components"]["schemas"]
    canonical_components = canonical_document["components"]["schemas"]

    canonical_object_names = {
        name for name, schema in canonical_components.items() if schema.get("type") == "object"
    }
    assert canonical_object_names == set(actual_components)
    for name in sorted(canonical_object_names):
        actual_schema = json.dumps(
            normalize_schema(actual_components[name], actual_components),
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
        canonical_schema = json.dumps(
            normalize_schema(canonical_components[name], canonical_components),
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
        difference = "\n".join(
            difflib.unified_diff(
                canonical_schema.splitlines(),
                actual_schema.splitlines(),
                fromfile=f"canonical/{name}",
                tofile=f"fastapi/{name}",
                lineterm="",
            )
        )
        assert actual_schema == canonical_schema, difference


@pytest.mark.integration
def test_fastapi_generated_schemas_accept_every_golden_fixture() -> None:
    document = create_app(development_settings(), UnusedOrchestrator()).openapi()

    for path in sorted(FIXTURES.glob("execute-request.*.json")):
        validate_component(
            document,
            "ExecuteRequest",
            json.loads(path.read_text()),
        )
    for path in sorted(FIXTURES.glob("execute-response.*.json")):
        validate_component(document, "ExecuteResponse", json.loads(path.read_text()))


def test_fastapi_execute_schema_is_closed_to_unknown_business_fields() -> None:
    document = create_app(development_settings(), UnusedOrchestrator()).openapi()
    payload = json.loads((FIXTURES / "execute-request.standard.json").read_text())
    payload["userId"] = "must-not-cross-boundary"

    registry = Registry().with_resource(
        "urn:ai-schedule:agent:v1",
        Resource.from_contents(document, default_specification=DRAFT202012),
    )
    validator = Draft202012Validator(
        {"$ref": "urn:ai-schedule:agent:v1#/components/schemas/ExecuteRequest"},
        registry=registry,
        format_checker=FormatChecker(),
    )

    assert list(validator.iter_errors(payload))
