"""Run-scoped, read-only model tools over the authorized context endpoint."""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from typing import Protocol

from pydantic_ai import RunContext

from agent_service.context import InferenceRequest
from agent_service.errors import AgentServiceError
from agent_service.generated.internal_agent_v1 import CandidateContext
from agent_service.generated.internal_agent_v2 import (
    CandidateContext as V2CandidateContext,
)
from agent_service.generated.internal_agent_v2 import (
    ContextReadResponse,
    ContextResource,
    InternalMessage,
)


class ContextPages(Protocol):
    async def read(
        self,
        request: InferenceRequest,
        resource: ContextResource,
        limit: int,
        cursor: str | None = None,
        include_task_details: bool = False,
    ) -> ContextReadResponse: ...


PAGE_SIZE = {"TASKS": 50, "PROJECTS": 30, "MESSAGES": 20}
TOTAL_LIMIT = {"TASKS": 200, "PROJECTS": 60, "MESSAGES": 60}
TOTAL_CONTEXT_BYTES = 64 * 1024
TOTAL_HISTORY_BYTES = 24 * 1024


@dataclass
class RunReadState:
    request: InferenceRequest
    client: ContextPages
    calls: int = 0
    repairing: bool = False
    used_bytes: int = 0
    history_bytes: int = 0
    counts: dict[str, int] = field(default_factory=dict)
    cursors: dict[str, str | None] = field(default_factory=dict)
    finished: set[str] = field(default_factory=set)
    known_refs: set[str] = field(default_factory=set)
    task_details: dict[str, dict[str, object]] = field(default_factory=dict)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock, repr=False)

    def __post_init__(self) -> None:
        self.history_bytes = sum(len(m.content.encode("utf-8")) for m in self.request.messages)
        self.used_bytes = len(
            json.dumps(
                self.request.source.model_dump(mode="json", by_alias=True),
                ensure_ascii=False,
            ).encode("utf-8")
        ) + sum(
            len(
                json.dumps(m.model_dump(mode="json", by_alias=True), ensure_ascii=False).encode(
                    "utf-8"
                )
            )
            for m in self.request.messages
        )
        self.counts = {"TASKS": 0, "PROJECTS": 0, "MESSAGES": len(self.request.messages)}
        self.cursors = {"TASKS": None, "PROJECTS": None, "MESSAGES": self.request._history_cursor}
        self.known_refs = {candidate.candidate_ref for candidate in self.request.candidates}
        if self.request._history_cursor is None and not self.request._pending_history:
            self.finished.add("MESSAGES")

    async def read_page(
        self, ctx: RunContext[RunReadState], resource: ContextResource
    ) -> dict[str, object]:
        async with self.lock:
            return await self._read_page_locked(ctx, resource)

    async def _read_page_locked(
        self, ctx: RunContext[RunReadState], resource: ContextResource
    ) -> dict[str, object]:
        self.calls += 1
        if self.calls > 6 or ctx.usage.requests >= 3 or self.repairing:
            raise AgentServiceError("EXECUTION_BUDGET_EXCEEDED", 502, "Agent budget exhausted")
        remaining = TOTAL_LIMIT[resource] - self.counts[resource]
        if remaining <= 0 or resource in self.finished:
            return {"items": [], "incomplete": remaining <= 0, "hasMore": False}
        limit = min(PAGE_SIZE[resource], remaining)
        if resource == "MESSAGES" and self.request._pending_history:
            rows: list[InternalMessage] | list[V2CandidateContext] = self.request._pending_history[
                :limit
            ]
            self.request._pending_history = self.request._pending_history[limit:]
            next_cursor = self.cursors[resource]
        else:
            page = await self.client.read(
                self.request,
                resource,
                limit,
                self.cursors[resource],
                include_task_details=resource == "TASKS",
            )
            rows = page.messages if resource == "MESSAGES" else page.candidates
            next_cursor = page.next_cursor
            if next_cursor is not None and next_cursor == self.cursors[resource]:
                raise AgentServiceError("CONTEXT_UNAVAILABLE", 503, "Context pagination failed")
        items: list[dict[str, object]] = []
        for row in rows:
            item = row.model_dump(mode="json", by_alias=True, exclude_unset=True)
            size = len(json.dumps(item, ensure_ascii=False).encode("utf-8"))
            if resource == "MESSAGES" and isinstance(row, InternalMessage):
                body_size = len(row.content.encode("utf-8"))
                if self.history_bytes + body_size > TOTAL_HISTORY_BYTES:
                    self.finished.add(resource)
                    return {"items": items, "incomplete": True, "hasMore": False}
            if self.used_bytes + size > TOTAL_CONTEXT_BYTES:
                self.finished.add(resource)
                return {"items": items, "incomplete": True, "hasMore": False}
            if resource != "MESSAGES":
                candidate = CandidateContext.model_validate(
                    {
                        key: value
                        for key, value in item.items()
                        if key
                        in {
                            "candidateRef",
                            "kind",
                            "label",
                            "version",
                            "priority",
                            "scheduledAt",
                            "deadlineAt",
                        }
                    }
                )
                if candidate.candidate_ref in self.known_refs:
                    continue
                self.known_refs.add(candidate.candidate_ref)
                self.request.candidates.append(candidate)
                if resource == "TASKS":
                    self.task_details[candidate.candidate_ref] = item
            self.used_bytes += size
            if resource == "MESSAGES" and isinstance(row, InternalMessage):
                self.history_bytes += len(row.content.encode("utf-8"))
            self.counts[resource] += 1
            items.append(item)
        self.cursors[resource] = next_cursor
        has_more = next_cursor is not None or (
            resource == "MESSAGES" and bool(self.request._pending_history)
        )
        if not has_more:
            self.finished.add(resource)
        return {
            "items": items,
            "incomplete": has_more and self.counts[resource] >= TOTAL_LIMIT[resource],
            "hasMore": has_more and self.counts[resource] < TOTAL_LIMIT[resource],
        }
