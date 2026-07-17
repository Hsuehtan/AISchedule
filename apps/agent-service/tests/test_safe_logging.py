from __future__ import annotations

import io
import json

from agent_service.safe_logging import SafeJsonLogger


def test_logger_emits_only_whitelisted_non_content_fields() -> None:
    output = io.StringIO()
    logger = SafeJsonLogger(output)

    logger.emit(
        event="agent.execute.completed",
        requestId="request-id",
        status="SUCCEEDED",
        prompt="private prompt",
        response="private response",
        apiKey="private key",
        userId="private user",
    )

    assert json.loads(output.getvalue()) == {
        "event": "agent.execute.completed",
        "requestId": "request-id",
        "status": "SUCCEEDED",
    }


def test_logger_failure_never_changes_service_control_flow() -> None:
    def broken_serializer(_: object) -> str:
        raise RuntimeError("logger failed")

    logger = SafeJsonLogger(io.StringIO(), serializer=broken_serializer)

    logger.emit(event="agent.execute.completed", status="SUCCEEDED")
