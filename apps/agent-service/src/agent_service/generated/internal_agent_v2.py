"""Generated from internal-agent/v2/openapi.yaml. Do not edit."""

from __future__ import annotations

from typing import Any, Annotated, Literal, Self, Union, cast
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

CONTRACT_SHA256 = '34dc47e80bac48c8a38cb8f97bd6506b3d0f3816dc6c2a18e958c7813fe184a0'

class ContractModel(BaseModel):
    model_config = ConfigDict(extra='forbid', validate_by_alias=True, validate_by_name=False)

ResultType = Literal['REPLY', 'CLARIFICATION', 'CANDIDATES', 'PLAN', 'ACTION_PROPOSAL']

CapabilityCode = Literal['agent.standardTurn', 'agent.planGeneration']

MessageRole = Literal['USER', 'ASSISTANT']

CandidateKind = Literal['TASK', 'PROJECT']

Priority = Literal['HIGH', 'MEDIUM', 'LOW']

NextStep = Literal['DETERMINISTIC', 'AGENT_STANDARD', 'AGENT_PLAN']

ActionCode = Literal['CREATE_TASK', 'CREATE_PROJECT_TASKS', 'ORGANIZE_TASKS', 'UPDATE_TASK', 'COMPLETE_TASK', 'RESTORE_TASK', 'DELETE_TASK']

class HealthResponse(ContractModel):
    status: Literal['ok'] = Field(alias='status')

ErrorCode = Literal['UNAUTHORIZED', 'REQUEST_TOO_LARGE', 'VALIDATION_ERROR', 'CONCURRENCY_LIMIT', 'PROVIDER_UNAVAILABLE', 'PROVIDER_TIMEOUT', 'PROVIDER_RATE_LIMITED', 'PROVIDER_OUTPUT_INVALID', 'INTERNAL_ERROR', 'CONTEXT_UNAVAILABLE', 'CONTEXT_TIMEOUT']

class ResolutionMetadata(ContractModel):
    provider: Literal['DEEPSEEK'] = Field(alias='provider')
    model: Annotated[str, StringConstraints(min_length=1, max_length=100)] = Field(alias='model')
    prompt_version: Annotated[str, StringConstraints(min_length=1, max_length=64)] = Field(alias='promptVersion')
    provider_schema_version: Annotated[str, StringConstraints(min_length=1, max_length=64)] = Field(alias='providerSchemaVersion')
    repair_attempts: Annotated[int, Field(ge=0, le=1)] = Field(alias='repairAttempts')

class ReplyResult(ContractModel):
    type: Literal['REPLY'] = Field(alias='type')
    text: Annotated[str, StringConstraints(min_length=1, max_length=2000)] = Field(alias='text')
    offer_plan: bool = Field(alias='offerPlan')

class CandidateOption(ContractModel):
    option_id: Annotated[str, StringConstraints(pattern='^opt_[a-f0-9]{16}$')] = Field(alias='optionId')
    candidate_ref: Annotated[str, StringConstraints(pattern='^cand_[a-f0-9]{32}$')] = Field(alias='candidateRef')
    label: Annotated[str, StringConstraints(min_length=1, max_length=200)] = Field(alias='label')

class NoProjectSelection(ContractModel):
    type: Literal['NONE'] = Field(alias='type')

class ExistingProjectSelection(ContractModel):
    type: Literal['EXISTING'] = Field(alias='type')
    candidate_ref: Annotated[str, StringConstraints(pattern='^cand_[a-f0-9]{32}$')] = Field(alias='candidateRef')

class NewProjectSelection(ContractModel):
    type: Literal['NEW'] = Field(alias='type')
    name: Annotated[str, StringConstraints(min_length=1, max_length=50)] = Field(alias='name')

class OrganizeTaskMutation(ContractModel):
    operation: Literal['ORGANIZE_TASK'] = Field(alias='operation')
    target_ref: Annotated[str, StringConstraints(pattern='^cand_[a-f0-9]{32}$')] = Field(alias='targetRef')
    project_ref: Annotated[str, StringConstraints(pattern='^cand_[a-f0-9]{32}$')] = Field(alias='projectRef')
    expected_version: Annotated[int, Field(ge=1)] = Field(alias='expectedVersion')

class CompleteTaskMutation(ContractModel):
    operation: Literal['COMPLETE_TASK'] = Field(alias='operation')
    target_ref: Annotated[str, StringConstraints(pattern='^cand_[a-f0-9]{32}$')] = Field(alias='targetRef')
    expected_version: Annotated[int, Field(ge=1)] = Field(alias='expectedVersion')

class RestoreTaskMutation(ContractModel):
    operation: Literal['RESTORE_TASK'] = Field(alias='operation')
    target_ref: Annotated[str, StringConstraints(pattern='^cand_[a-f0-9]{32}$')] = Field(alias='targetRef')
    expected_version: Annotated[int, Field(ge=1)] = Field(alias='expectedVersion')

class DeleteTaskMutation(ContractModel):
    operation: Literal['DELETE_TASK'] = Field(alias='operation')
    target_ref: Annotated[str, StringConstraints(pattern='^cand_[a-f0-9]{32}$')] = Field(alias='targetRef')
    expected_version: Annotated[int, Field(ge=1)] = Field(alias='expectedVersion')

class SafeDraftProject(ContractModel):
    type: Literal['NEW', 'EXISTING', 'NONE'] = Field(alias='type')
    name: Annotated[str, StringConstraints(max_length=40)] | None = Field(alias='name')

ContextResource = Literal['SOURCE', 'MESSAGES', 'TASKS', 'PROJECTS']

class ErrorDetail(ContractModel):
    code: ErrorCode = Field(alias='code')
    message: Annotated[str, StringConstraints(min_length=1, max_length=160)] = Field(alias='message')
    request_id: UUID | None = Field(default=None, alias='requestId')

class InternalMessage(ContractModel):
    role: MessageRole = Field(alias='role')
    content: Annotated[str, StringConstraints(min_length=1)] = Field(alias='content')

class CandidateContext(ContractModel):
    candidate_ref: Annotated[str, StringConstraints(pattern='^cand_[a-f0-9]{32}$')] = Field(alias='candidateRef')
    kind: CandidateKind = Field(alias='kind')
    label: Annotated[str, StringConstraints(min_length=1, max_length=200)] = Field(alias='label')
    version: Annotated[int, Field(ge=1)] = Field(alias='version')
    priority: Priority | None = Field(default=None, alias='priority')
    scheduled_at: AwareDatetime | None = Field(default=None, alias='scheduledAt')
    deadline_at: AwareDatetime | None = Field(default=None, alias='deadlineAt')

class ExecuteRequest(ContractModel):
    contract_version: Literal['2.0'] = Field(alias='contractVersion')
    request_id: UUID = Field(alias='requestId')
    capability_code: CapabilityCode = Field(alias='capabilityCode')
    deadline_at: AwareDatetime = Field(alias='deadlineAt')
    locale: Annotated[str, StringConstraints(min_length=2, max_length=16, pattern='^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$')] = Field(alias='locale')
    timezone: Annotated[str, StringConstraints(min_length=1, max_length=64)] = Field(alias='timezone')
    allowed_result_types: Annotated[list[ResultType], Field(min_length=1, max_length=5, json_schema_extra={'uniqueItems': True})] = Field(alias='allowedResultTypes')

    @field_validator('allowed_result_types')
    @classmethod
    def validate_unique_allowed_result_types(cls, value: list[object]) -> list[object]:
        if len(set(value)) != len(value):
            raise ValueError('must contain unique items')
        return value

class ClarificationOption(ContractModel):
    option_id: Annotated[str, StringConstraints(pattern='^opt_[a-f0-9]{16}$')] = Field(alias='optionId')
    label: Annotated[str, StringConstraints(min_length=1, max_length=120)] = Field(alias='label')
    next_step: NextStep = Field(alias='nextStep')

class CandidatesResult(ContractModel):
    type: Literal['CANDIDATES'] = Field(alias='type')
    question: Annotated[str, StringConstraints(min_length=1, max_length=500)] = Field(alias='question')
    options: Annotated[list[CandidateOption], Field(min_length=2, max_length=10)] = Field(alias='options')

TaskProjectSelection = Annotated[Union[NoProjectSelection, ExistingProjectSelection], Field(discriminator='type')]

PlanProjectSelection = Annotated[Union[ExistingProjectSelection, NewProjectSelection], Field(discriminator='type')]

class TaskDraft(ContractModel):
    client_ref: Annotated[str, StringConstraints(pattern='^draft_[a-f0-9]{16}$')] = Field(alias='clientRef')
    title: Annotated[str, StringConstraints(min_length=1, max_length=200)] = Field(alias='title')
    description: Annotated[str, StringConstraints(max_length=2000)] | None = Field(alias='description')
    priority: Priority = Field(alias='priority')
    scheduled_at: AwareDatetime | None = Field(alias='scheduledAt')
    deadline_at: AwareDatetime | None = Field(alias='deadlineAt')
    reminder_at: AwareDatetime | None = Field(alias='reminderAt')

class TaskChanges(ContractModel):
    model_config = ConfigDict(json_schema_extra={'minProperties': 1})
    title: Annotated[str, StringConstraints(min_length=1, max_length=200)] = Field(default=cast(Any, None), alias='title')
    description: Annotated[str, StringConstraints(max_length=2000)] | None = Field(default=None, alias='description')
    priority: Priority = Field(default=cast(Any, None), alias='priority')
    scheduled_at: AwareDatetime | None = Field(default=None, alias='scheduledAt')
    deadline_at: AwareDatetime | None = Field(default=None, alias='deadlineAt')
    reminder_at: AwareDatetime | None = Field(default=None, alias='reminderAt')

    @model_validator(mode='after')
    def validate_min_properties(self) -> Self:
        if len(self.model_fields_set) < 1:
            raise ValueError('must contain at least one field')
        return self

class SafeDraftTask(ContractModel):
    title: Annotated[str, StringConstraints(min_length=1, max_length=200)] = Field(alias='title')
    description: Annotated[str, StringConstraints(max_length=2000)] | None = Field(alias='description')
    priority: Priority = Field(alias='priority')
    scheduled_at: AwareDatetime | None = Field(alias='scheduledAt')
    deadline_at: AwareDatetime | None = Field(alias='deadlineAt')
    reminder_at: AwareDatetime | None = Field(alias='reminderAt')
    project: SafeDraftProject = Field(default=cast(Any, None), alias='project')

class ContextReadRequest(ContractModel):
    request_id: UUID = Field(alias='requestId')
    resource: ContextResource = Field(alias='resource')
    limit: Annotated[int, Field(ge=1, le=9007199254740991)] = Field(alias='limit')
    cursor: Annotated[str, StringConstraints(max_length=4096)] | None = Field(default=None, alias='cursor')

class ErrorResponse(ContractModel):
    error: ErrorDetail = Field(alias='error')

class ClarificationResult(ContractModel):
    type: Literal['CLARIFICATION'] = Field(alias='type')
    question: Annotated[str, StringConstraints(min_length=1, max_length=500)] = Field(alias='question')
    options: Annotated[list[ClarificationOption], Field(min_length=2, max_length=5)] = Field(alias='options')
    allow_free_text: bool = Field(alias='allowFreeText')

class PlanResult(ContractModel):
    type: Literal['PLAN'] = Field(alias='type')
    title: Annotated[str, StringConstraints(min_length=1, max_length=200)] = Field(alias='title')
    project: PlanProjectSelection = Field(alias='project')
    tasks: Annotated[list[TaskDraft], Field(min_length=1, max_length=10)] = Field(alias='tasks')

class CreateTaskMutation(ContractModel):
    operation: Literal['CREATE_TASK'] = Field(alias='operation')
    project: TaskProjectSelection = Field(alias='project')
    task: TaskDraft = Field(alias='task')

class CreateProjectTasksMutation(ContractModel):
    operation: Literal['CREATE_PROJECT_TASKS'] = Field(alias='operation')
    project: PlanProjectSelection = Field(alias='project')
    tasks: Annotated[list[TaskDraft], Field(min_length=1, max_length=10)] = Field(alias='tasks')

class UpdateTaskMutation(ContractModel):
    operation: Literal['UPDATE_TASK'] = Field(alias='operation')
    target_ref: Annotated[str, StringConstraints(pattern='^cand_[a-f0-9]{32}$')] = Field(alias='targetRef')
    expected_version: Annotated[int, Field(ge=1)] = Field(alias='expectedVersion')
    changes: TaskChanges = Field(alias='changes')

class SafePreviousDraft(ContractModel):
    action_code: ActionCode = Field(alias='actionCode')
    title: Annotated[str, StringConstraints(max_length=200)] = Field(alias='title')
    summary: Annotated[str, StringConstraints(max_length=2000)] = Field(alias='summary')
    tasks: Annotated[list[SafeDraftTask], Field(min_length=1, max_length=10)] = Field(alias='tasks')

ActionMutation = Annotated[Union[CreateTaskMutation, CreateProjectTasksMutation, OrganizeTaskMutation, UpdateTaskMutation, CompleteTaskMutation, RestoreTaskMutation, DeleteTaskMutation], Field(discriminator='operation')]

class SourceContext(ContractModel):
    kind: Literal['TURN', 'ANSWER', 'PLAN', 'REGENERATE', 'ORGANIZE'] = Field(alias='kind')
    instruction: Annotated[str, StringConstraints(max_length=4000)] | None = Field(alias='instruction')
    previous_draft: SafePreviousDraft | None = Field(alias='previousDraft')

class ActionProposalResult(ContractModel):
    type: Literal['ACTION_PROPOSAL'] = Field(alias='type')
    action_code: ActionCode = Field(alias='actionCode')
    summary: Annotated[str, StringConstraints(min_length=1, max_length=500)] = Field(alias='summary')
    mutations: Annotated[list[ActionMutation], Field(min_length=1, max_length=20)] = Field(alias='mutations')

class ContextReadResponse(ContractModel):
    request_id: UUID = Field(alias='requestId')
    resource: ContextResource = Field(alias='resource')
    source: SourceContext | None = Field(alias='source')
    messages: list[InternalMessage] = Field(alias='messages')
    candidates: list[CandidateContext] = Field(alias='candidates')
    next_cursor: Annotated[str, StringConstraints(max_length=4096)] | None = Field(alias='nextCursor')

ExecuteResult = Annotated[Union[ReplyResult, ClarificationResult, CandidatesResult, PlanResult, ActionProposalResult], Field(discriminator='type')]

class ExecuteResponse(ContractModel):
    contract_version: Literal['2.0'] = Field(alias='contractVersion')
    request_id: UUID = Field(alias='requestId')
    resolved: ResolutionMetadata = Field(alias='resolved')
    result: ExecuteResult = Field(alias='result')


ALL_MODELS = [model for model in globals().values() if isinstance(model, type) and issubclass(model, ContractModel)]
