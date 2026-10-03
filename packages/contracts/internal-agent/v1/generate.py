#!/usr/bin/env python3
"""Generate the internal Agent Zod and Pydantic models from canonical OpenAPI 3.1."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any

import yaml

CONTRACT_ROOT = Path(__file__).resolve().parent
REPOSITORY_ROOT = CONTRACT_ROOT.parents[3]
OPENAPI_PATH = CONTRACT_ROOT / "openapi.yaml"
TS_OUTPUT = REPOSITORY_ROOT / "packages/contracts/src/generated/internal-agent-v1.ts"
PYTHON_OUTPUT = (
    REPOSITORY_ROOT / "apps/agent-service/src/agent_service/generated/internal_agent_v1.py"
)


Schema = dict[str, Any]


def snake_case(value: str) -> str:
    value = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1_\2", value)
    return re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", value).replace("-", "_").lower()


def lower_camel(value: str) -> str:
    return value[:1].lower() + value[1:]


def request_policy(schemas: dict[str, Schema]) -> tuple[int, int, int]:
    request = schemas["ExecuteRequest"]
    candidate_limits = request["x-candidate-kind-max"]
    return (
        int(request["x-message-content-max-bytes"]),
        int(candidate_limits["TASK"]),
        int(candidate_limits["PROJECT"]),
    )


def referenced_names(schema: Schema) -> set[str]:
    names: set[str] = set()
    if "$ref" in schema:
        names.add(str(schema["$ref"]).rsplit("/", 1)[-1])
    for key in ("oneOf", "anyOf", "allOf"):
        for item in schema.get(key, []):
            names.update(referenced_names(item))
    if isinstance(schema.get("items"), dict):
        names.update(referenced_names(schema["items"]))
    for property_schema in schema.get("properties", {}).values():
        names.update(referenced_names(property_schema))
    return names


def ordered_schemas(schemas: dict[str, Schema]) -> list[tuple[str, Schema]]:
    remaining = dict(schemas)
    emitted: list[tuple[str, Schema]] = []
    resolved: set[str] = set()
    while remaining:
        ready = [
            name
            for name, schema in remaining.items()
            if (referenced_names(schema) - {name}).issubset(resolved)
        ]
        if not ready:
            raise ValueError(f"Cyclic or unresolved schemas: {', '.join(sorted(remaining))}")
        for name in ready:
            emitted.append((name, remaining.pop(name)))
            resolved.add(name)
    return emitted


def quote_ts(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def nullable_one_of(schema: Schema) -> Schema | None:
    variants = schema.get("oneOf")
    if not isinstance(variants, list) or len(variants) != 2:
        return None
    non_null = [item for item in variants if item.get("type") != "null"]
    null_items = [item for item in variants if item.get("type") == "null"]
    return non_null[0] if len(non_null) == 1 and len(null_items) == 1 else None


def zod_expression(schema: Schema) -> str:
    if "$ref" in schema:
        return f"{lower_camel(str(schema['$ref']).rsplit('/', 1)[-1])}Schema"
    nullable = nullable_one_of(schema)
    if nullable is not None:
        return f"{zod_expression(nullable)}.nullable()"
    if "oneOf" in schema:
        variants = [zod_expression(item) for item in schema["oneOf"]]
        discriminator = schema.get("discriminator", {}).get("propertyName")
        if discriminator:
            return f"z.discriminatedUnion({quote_ts(discriminator)}, [{', '.join(variants)}])"
        return f"z.union([{', '.join(variants)}])"

    schema_type = schema.get("type")
    if isinstance(schema_type, list):
        non_null = [value for value in schema_type if value != "null"]
        if len(non_null) != 1 or len(non_null) == len(schema_type):
            raise ValueError(f"Unsupported type union: {schema_type}")
        return f"{zod_expression({**schema, 'type': non_null[0]})}.nullable()"
    if "const" in schema:
        return f"z.literal({quote_ts(schema['const'])})"
    if "enum" in schema:
        values = ", ".join(quote_ts(value) for value in schema["enum"])
        return f"z.enum([{values}])"
    if schema_type == "string":
        result = "z.string()"
        if schema.get("format") == "uuid":
            result += ".uuid()"
        elif schema.get("format") == "date-time":
            result += ".datetime({ offset: true })"
        if "pattern" in schema:
            result += f".regex(new RegExp({quote_ts(schema['pattern'])}, 'u'))"
        if "minLength" in schema:
            minimum = schema["minLength"]
            result += (
                ".refine((value) => unicodeCodePointLength(value) >= "
                f"{minimum}, {{ message: 'Must contain at least {minimum} Unicode "
                "code point(s)' })"
            )
        if "maxLength" in schema:
            maximum = schema["maxLength"]
            result += (
                ".refine((value) => unicodeCodePointLength(value) <= "
                f"{maximum}, {{ message: 'Must contain at most {maximum} Unicode "
                "code point(s)' })"
            )
        return result
    if schema_type == "integer":
        result = "z.number().int()"
        if "minimum" in schema:
            result += f".min({schema['minimum']})"
        if "maximum" in schema:
            result += f".max({schema['maximum']})"
        return result
    if schema_type == "boolean":
        return "z.boolean()"
    if schema_type == "array":
        result = f"z.array({zod_expression(schema['items'])})"
        if "minItems" in schema:
            result += f".min({schema['minItems']})"
        if "maxItems" in schema:
            result += f".max({schema['maxItems']})"
        if schema.get("uniqueItems"):
            result += (
                ".refine((items) => new Set(items).size === items.length, "
                "{ message: 'Must contain unique items' })"
            )
        return result
    if schema_type == "object":
        required = set(schema.get("required", []))
        fields: list[str] = []
        for name, property_schema in schema.get("properties", {}).items():
            expression = zod_expression(property_schema)
            if name not in required:
                expression += ".optional()"
            fields.append(f"  {quote_ts(name)}: {expression},")
        suffix = ".strict()" if schema.get("additionalProperties") is False else ""
        if "minProperties" in schema:
            suffix += (
                ".refine((value) => Object.keys(value).length >= "
                f"{schema['minProperties']}, {{ message: 'Must contain at least "
                f"{schema['minProperties']} field(s)' }})"
            )
        return "z.object({\n" + "\n".join(fields) + f"\n}}){suffix}"
    if schema_type == "null":
        return "z.null()"
    raise ValueError(f"Unsupported Zod schema: {schema}")


def render_typescript(schemas: dict[str, Schema], contract_hash: str) -> str:
    policy = (
        request_policy(schemas) if "x-candidate-kind-max" in schemas["ExecuteRequest"] else None
    )
    message_bytes, task_candidates, project_candidates = policy or (0, 0, 0)
    blocks = [
        "// This file is generated from internal-agent/v1/openapi.yaml. Do not edit.",
        f"// Contract SHA-256: {contract_hash}",
        "import { z } from 'zod';",
        "",
        f"export const MESSAGE_CONTENT_MAX_BYTES = {message_bytes};",
        f"export const MAX_TASK_CANDIDATES = {task_candidates};",
        f"export const MAX_PROJECT_CANDIDATES = {project_candidates};",
        "",
        "const unicodeCodePointLength = (value: string): number => Array.from(value).length;",
        "",
    ]
    if policy is None:
        blocks = [
            line
            for line in blocks
            if not any(
                key in line
                for key in (
                    "MESSAGE_CONTENT_MAX_BYTES =",
                    "MAX_TASK_CANDIDATES =",
                    "MAX_PROJECT_CANDIDATES =",
                )
            )
        ]
    for name, schema in ordered_schemas(schemas):
        expression = zod_expression(schema)
        if name == "ExecuteRequest" and policy is not None:
            expression += """.superRefine((value, context) => {
  const messageBytes = value.messages.reduce(
    (total, message) => total + new TextEncoder().encode(message.content).byteLength,
    0,
  );
  if (messageBytes > MESSAGE_CONTENT_MAX_BYTES) {
    context.addIssue({
      code: 'custom',
      path: ['messages'],
      message: 'Message content exceeds byte limit',
    });
  }
  const candidateRefs = value.candidates.map((candidate) => candidate.candidateRef);
  if (new Set(candidateRefs).size !== candidateRefs.length) {
    context.addIssue({
      code: 'custom',
      path: ['candidates'],
      message: 'Candidate references must be unique',
    });
  }
  const taskCount = value.candidates.filter((candidate) => candidate.kind === 'TASK').length;
  const projectCount = value.candidates.length - taskCount;
  if (taskCount > MAX_TASK_CANDIDATES || projectCount > MAX_PROJECT_CANDIDATES) {
    context.addIssue({
      code: 'custom',
      path: ['candidates'],
      message: 'Candidate kind limit exceeded',
    });
  }
})"""
        blocks.append(
            f"export const {lower_camel(name)}Schema = {expression};\n"
            f"export type {name} = z.infer<typeof {lower_camel(name)}Schema>;\n"
        )
    return "\n".join(blocks).rstrip() + "\n"


def python_literal(value: Any) -> str:
    if value is None:
        return "None"
    if value is True:
        return "True"
    if value is False:
        return "False"
    return repr(value)


def python_type(schema: Schema) -> str:
    if "$ref" in schema:
        return str(schema["$ref"]).rsplit("/", 1)[-1]
    nullable = nullable_one_of(schema)
    if nullable is not None:
        return f"{python_type(nullable)} | None"
    if "oneOf" in schema:
        variants = ", ".join(python_type(item) for item in schema["oneOf"])
        discriminator = schema.get("discriminator", {}).get("propertyName")
        union = f"Union[{variants}]"
        if discriminator:
            return f"Annotated[{union}, Field(discriminator={discriminator!r})]"
        return union

    schema_type = schema.get("type")
    if isinstance(schema_type, list):
        non_null = [value for value in schema_type if value != "null"]
        if len(non_null) != 1 or len(non_null) == len(schema_type):
            raise ValueError(f"Unsupported type union: {schema_type}")
        return f"{python_type({**schema, 'type': non_null[0]})} | None"
    if "const" in schema:
        return f"Literal[{python_literal(schema['const'])}]"
    if "enum" in schema:
        values = ", ".join(python_literal(value) for value in schema["enum"])
        return f"Literal[{values}]"
    if schema_type == "string":
        if schema.get("format") == "uuid":
            return "UUID"
        if schema.get("format") == "date-time":
            return "AwareDatetime"
        constraints: list[str] = []
        if "minLength" in schema:
            constraints.append(f"min_length={schema['minLength']}")
        if "maxLength" in schema:
            constraints.append(f"max_length={schema['maxLength']}")
        if "pattern" in schema:
            constraints.append(f"pattern={schema['pattern']!r}")
        if constraints:
            return f"Annotated[str, StringConstraints({', '.join(constraints)})]"
        return "str"
    if schema_type == "integer":
        constraints = []
        if "minimum" in schema:
            constraints.append(f"ge={schema['minimum']}")
        if "maximum" in schema:
            constraints.append(f"le={schema['maximum']}")
        return f"Annotated[int, Field({', '.join(constraints)})]" if constraints else "int"
    if schema_type == "boolean":
        return "bool"
    if schema_type == "array":
        result = f"list[{python_type(schema['items'])}]"
        constraints = []
        if "minItems" in schema:
            constraints.append(f"min_length={schema['minItems']}")
        if "maxItems" in schema:
            constraints.append(f"max_length={schema['maxItems']}")
        if schema.get("uniqueItems"):
            constraints.append("json_schema_extra={'uniqueItems': True}")
        if constraints:
            result = f"Annotated[{result}, Field({', '.join(constraints)})]"
        return result
    if schema_type == "null":
        return "None"
    raise ValueError(f"Unsupported Python schema: {schema}")


def render_python(schemas: dict[str, Schema], contract_hash: str) -> str:
    policy = (
        request_policy(schemas) if "x-candidate-kind-max" in schemas["ExecuteRequest"] else None
    )
    message_bytes, task_candidates, project_candidates = policy or (0, 0, 0)
    blocks = [
        '"""Generated from internal-agent/v1/openapi.yaml. Do not edit."""',
        "",
        "from __future__ import annotations",
        "",
        "from typing import Any, Annotated, Literal, Self, Union, cast",
        "from uuid import UUID",
        "",
        (
            "from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, "
            "StringConstraints, field_validator, model_validator"
        ),
        "",
        f"CONTRACT_SHA256 = {contract_hash!r}",
        f"MESSAGE_CONTENT_MAX_BYTES = {message_bytes}",
        f"MAX_TASK_CANDIDATES = {task_candidates}",
        f"MAX_PROJECT_CANDIDATES = {project_candidates}",
        "",
        "class ContractModel(BaseModel):",
        (
            "    model_config = ConfigDict(extra='forbid', validate_by_alias=True, "
            "validate_by_name=False)"
        ),
        "",
    ]
    if policy is None:
        blocks = [
            line
            for line in blocks
            if not any(
                key in line
                for key in (
                    "MESSAGE_CONTENT_MAX_BYTES =",
                    "MAX_TASK_CANDIDATES =",
                    "MAX_PROJECT_CANDIDATES =",
                )
            )
        ]
    for name, schema in ordered_schemas(schemas):
        if "enum" in schema and schema.get("type") == "string":
            blocks.append(f"{name} = {python_type(schema)}\n")
            continue
        if "oneOf" in schema:
            blocks.append(f"{name} = {python_type(schema)}\n")
            continue
        if schema.get("type") != "object":
            blocks.append(f"{name} = {python_type(schema)}\n")
            continue
        required = set(schema.get("required", []))
        lines = [f"class {name}(ContractModel):"]
        properties = schema.get("properties", {})
        if not properties:
            lines.append("    pass")
        if "minProperties" in schema:
            lines.append(
                "    model_config = ConfigDict(json_schema_extra="
                f"{{'minProperties': {schema['minProperties']}}})"
            )
        for property_name, property_schema in properties.items():
            field_name = snake_case(property_name)
            annotation = python_type(property_schema)
            alias = f"Field(alias={property_name!r})"
            if property_name not in required:
                if "None" not in annotation:
                    alias = f"Field(default=cast(Any, None), alias={property_name!r})"
                else:
                    alias = f"Field(default=None, alias={property_name!r})"
            lines.append(f"    {field_name}: {annotation} = {alias}")
        unique_fields = [
            property_name
            for property_name, property_schema in properties.items()
            if property_schema.get("uniqueItems")
        ]
        for property_name in unique_fields:
            field_name = snake_case(property_name)
            lines.extend(
                [
                    "",
                    f"    @field_validator({field_name!r})",
                    "    @classmethod",
                    (
                        f"    def validate_unique_{field_name}("
                        "cls, value: list[object]) -> list[object]:"
                    ),
                    "        if len(set(value)) != len(value):",
                    "            raise ValueError('must contain unique items')",
                    "        return value",
                ]
            )
        if "minProperties" in schema:
            lines.extend(
                [
                    "",
                    "    @model_validator(mode='after')",
                    (
                        f"    def validate_min_properties(self) -> Self:\n"
                        f"        if len(self.model_fields_set) < {schema['minProperties']}:\n"
                        "            raise ValueError('must contain at least one field')\n"
                        "        return self"
                    ),
                ]
            )
        blocks.append("\n".join(lines) + "\n")
    blocks.append(
        "\nALL_MODELS = [model for model in globals().values() "
        "if isinstance(model, type) and issubclass(model, ContractModel)]\n"
    )
    return "\n".join(blocks).rstrip() + "\n"


def write_or_check(path: Path, content: str, check: bool) -> bool:
    if check:
        if not path.exists() or path.read_text(encoding="utf-8") != content:
            print(f"Generated contract is stale: {path.relative_to(REPOSITORY_ROOT)}")
            return False
        return True
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return True


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    source = OPENAPI_PATH.read_text(encoding="utf-8")
    document = yaml.safe_load(source)
    if document.get("openapi") != "3.1.0":
        raise ValueError("Internal Agent contract must use OpenAPI 3.1.0")
    schemas = document["components"]["schemas"]
    contract_hash = hashlib.sha256(source.encode()).hexdigest()
    results = [
        write_or_check(TS_OUTPUT, render_typescript(schemas, contract_hash), args.check),
        write_or_check(PYTHON_OUTPUT, render_python(schemas, contract_hash), args.check),
    ]
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
