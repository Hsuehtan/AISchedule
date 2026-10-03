"""Generate v2 models with the shared v1 schema renderer."""

from __future__ import annotations

import argparse
import hashlib
import runpy
from pathlib import Path

import yaml


def main() -> int:
    root = Path(__file__).resolve().parent
    repo = root.parents[3]
    renderer = runpy.run_path(str(root.parent / "v1/generate.py"))
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    source = (root / "openapi.yaml").read_text(encoding="utf-8")
    document = yaml.safe_load(source)
    digest = hashlib.sha256(source.encode()).hexdigest()
    targets = [
        (
            "render_typescript",
            repo / "packages/contracts/src/generated/internal-agent-v2.ts",
        ),
        (
            "render_python",
            repo / "apps/agent-service/src/agent_service/generated/internal_agent_v2.py",
        ),
    ]
    results = []
    for name, target in targets:
        content = renderer[name](document["components"]["schemas"], digest).replace(
            "internal-agent/v1/openapi.yaml", "internal-agent/v2/openapi.yaml"
        )
        results.append(renderer["write_or_check"](target, content, args.check))
    return 0 if all(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
