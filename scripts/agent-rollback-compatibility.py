"""Check a complete prior code version in isolation, without touching services or business data."""

from __future__ import annotations

import argparse
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", required=True)
    parser.add_argument("--current", default="HEAD")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    def git(*arguments: str) -> bytes:
        return subprocess.check_output(["git", *arguments], cwd=ROOT)

    target = git("rev-parse", "--verify", "--end-of-options", f"{args.target}^{{commit}}").decode().strip()
    current = git("rev-parse", "--verify", "--end-of-options", f"{args.current}^{{commit}}").decode().strip()
    same_business = not git(
        "diff", "--name-only", target, current, "--", "apps/server", "apps/client",
        "packages/contracts", "packages/db",
    ).strip()
    same_dependencies = not git(
        "diff", "--name-only", target, current, "--", "apps/agent-service/uv.lock",
        "apps/agent-service/pyproject.toml",
    ).strip()
    if not same_business or not same_dependencies:
        raise SystemExit("This drill requires identical business/contracts/database and dependency trees")
    archive = git("archive", target, "apps/agent-service/src", "config")
    with tempfile.TemporaryDirectory(prefix="agent-rollback-compat-", dir="/tmp") as directory:
        scratch = Path(directory)
        with tarfile.open(fileobj=io.BytesIO(archive)) as tree:
            tree.extractall(scratch, filter="data")
        source = scratch / "apps/agent-service/src"
        ini = scratch / "pytest.ini"
        ini.write_text("[pytest]\nasyncio_mode=auto\n", encoding="utf-8")
        environment = {key: value for key, value in os.environ.items() if key not in {
            "DATABASE_URL", "DEEPSEEK_API_KEY", "AGENT_SERVICE_TOKEN", "AGENT_CONTEXT_SERVICE_TOKEN",
        }}
        environment["PYTHONPATH"] = str(source)
        environment["ROLLBACK_SOURCE"] = str(source)
        code = (
            "import os,pathlib,sys,pytest; "
            "sys.path.insert(0,os.environ['ROLLBACK_SOURCE']); import agent_service; "
            "from pydantic_ai import models; models.ALLOW_MODEL_REQUESTS=False; "
            "assert pathlib.Path(agent_service.__file__).resolve().is_relative_to("
            "pathlib.Path(os.environ['ROLLBACK_SOURCE']).resolve()); "
            "print('ROLLBACK_SOURCE_CONFIRMED'); "
            "raise SystemExit(pytest.main(sys.argv[1:]))"
        )
        result = subprocess.run(
            [sys.executable, "-c", code, "-q", "-c", str(ini), "--rootdir", str(scratch),
             str(ROOT / "apps/agent-service/tests/test_contract.py"),
             str(ROOT / "apps/agent-service/tests/test_v2_pydantic_app.py")],
            cwd=scratch, env=environment, capture_output=True, text=True, check=False,
        )
        matches = re.findall(r"(\d+) passed", result.stdout)
        report = {
            "status": "passed" if result.returncode == 0 else "failed",
            "targetCommit": target, "currentCommit": current,
            "businessContractsDatabaseTreesIdentical": same_business,
            "pythonDependenciesIdentical": same_dependencies,
            "priorSourceLocationAsserted": "ROLLBACK_SOURCE_CONFIRMED" in result.stdout,
            "controlledContractAndFastApiTestsPassed": int(matches[-1]) if matches else 0,
            "modelRequestsDisabled": True, "databaseCredentialsRemoved": True,
            "liveServicesOrBusinessDataModified": False,
            "scope": "isolated full-code-version compatibility drill; no live rollback",
        }
        output = args.output if args.output.is_absolute() else ROOT / args.output
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(report))
        if result.returncode:
            print(result.stdout[-5000:] + result.stderr[-2000:], file=sys.stderr)
            raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()
