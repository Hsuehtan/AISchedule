"""Context selection policy. Business authorization belongs to the context reader."""

from __future__ import annotations

import json
from dataclasses import dataclass

from pydantic import Field

from agent_service.context_client import ContextClient
from agent_service.errors import AgentServiceError
from agent_service.generated.internal_agent_v1 import CandidateContext
from agent_service.generated.internal_agent_v2 import (
    ContextResource,
    ExecuteRequest,
    InternalMessage,
    SourceContext,
)


@dataclass(frozen=True)
class ContextPolicy:
    history_messages: int = 20
    history_bytes: int = 12 * 1024
    task_candidates: int = 50
    project_candidates: int = 30
    organize_tasks: int = 20

    def __post_init__(self) -> None:
        if (
            min(
                self.history_messages,
                self.history_bytes,
                self.task_candidates,
                self.project_candidates,
                self.organize_tasks,
            )
            < 1
        ):
            raise ValueError("Context policy values must be positive")


DEFAULT_CONTEXT_POLICY = ContextPolicy()


class InferenceRequest(ExecuteRequest):
    # This Python-only model is not the transport contract and has no v1 budget validators.
    messages: list[InternalMessage] = Field(default_factory=list)
    candidates: list[CandidateContext] = Field(default_factory=list)
    source: SourceContext = Field(exclude=True)


async def build_context(
    request: ExecuteRequest,
    client: ContextClient,
    policy: ContextPolicy = DEFAULT_CONTEXT_POLICY,
) -> InferenceRequest:
    source_page = await client.read(request, "SOURCE", 1)
    source = source_page.source
    if source is None:
        raise AgentServiceError("CONTEXT_UNAVAILABLE", 503, "Context source missing")
    messages: list[InternalMessage] = []
    candidates: list[CandidateContext] = []
    used_bytes = 0
    resources: list[tuple[ContextResource, int]] = [
        ("MESSAGES", policy.history_messages),
        ("TASKS", policy.organize_tasks if source.kind == "ORGANIZE" else policy.task_candidates),
        ("PROJECTS", policy.project_candidates),
    ]
    for resource, wanted in resources:
        cursor: str | None = None
        seen: set[str] = set()
        received = 0
        while received < wanted:
            page = await client.read(request, resource, wanted - received, cursor)
            rows = len(page.messages) if resource == "MESSAGES" else len(page.candidates)
            if page.next_cursor and (rows == 0 or page.next_cursor in seen):
                raise AgentServiceError("CONTEXT_UNAVAILABLE", 503, "Invalid context pagination")
            received += rows
            if resource == "MESSAGES":
                for message in page.messages:
                    if not messages and source.kind == "REGENERATE":
                        # The safe legacy/new draft occupies the latest model-history slot.
                        # Apply the same Python byte policy; never duplicate it outside the budget.
                        message = InternalMessage(
                            role="USER",
                            content=json.dumps(
                                {
                                    "instruction": source.instruction,
                                    "previousDraft": source.previous_draft.model_dump(
                                        mode="json", by_alias=True
                                    )
                                    if source.previous_draft
                                    else None,
                                },
                                ensure_ascii=False,
                                separators=(",", ":"),
                            ),
                        )
                    size = len(message.content.encode("utf-8"))
                    if used_bytes + size > policy.history_bytes:
                        if not messages:
                            raise AgentServiceError(
                                "CONTEXT_UNAVAILABLE", 503, "Latest message exceeds context budget"
                            )
                        received = wanted
                        break
                    messages.append(message)
                    used_bytes += size
            else:
                candidates.extend(
                    CandidateContext.model_validate(row.model_dump(by_alias=True))
                    for row in page.candidates
                )
            cursor = page.next_cursor
            if cursor is None:
                break
            seen.add(cursor)
    messages.reverse()
    return InferenceRequest.model_validate(
        {
            **request.model_dump(by_alias=True),
            "messages": messages,
            "candidates": candidates,
            "source": source,
        }
    )
