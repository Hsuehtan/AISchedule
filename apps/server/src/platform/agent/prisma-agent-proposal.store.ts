import {
  actionProposalMutationResponseSchema,
  actionProposalResponseSchema,
  type ActionProposalEditInput,
  type ActionProposalMutationResponse,
  type ActionProposalResponse,
} from '@ai-schedule/contracts';
import { Prisma } from '@ai-schedule/db';

import { type TransactionScope } from '../database/unit-of-work.js';

import type { ResolvedProjectSelection, Transaction } from './agent-persistence.shared.js';
import {
  AgentPersistenceSupport,
  MAX_PROJECT_NAME_LENGTH,
  asJson,
  proposalNotExecutable,
  proposalNotFound,
  proposalVersionConflict,
} from './agent-persistence.shared.js';

export class PrismaAgentProposalStore extends AgentPersistenceSupport {
  async getProposal(
    input: Readonly<{
      userId: string;
      proposalId: string;
    }>,
  ): Promise<ActionProposalResponse> {
    return this.unitOfWork.run(async (scope) => {
      const transaction = this.unitOfWork.clientFor(scope);
      const proposal = await transaction.actionProposal.findFirst({
        where: {
          id: input.proposalId,
          userId: input.userId,
          requestRun: { status: 'SUCCEEDED' },
        },
        include: {
          mutations: { orderBy: { sequence: 'asc' } },
          requestRun: { select: { resultType: true } },
        },
      });
      if (!proposal) throw proposalNotFound();
      const current = await this.expireProposalIfNeeded(transaction, proposal, new Date());
      return actionProposalResponseSchema.parse({
        proposal: this.publicProposal(current, current.requestRun.resultType),
      });
    });
  }

  async editProposal(
    scope: TransactionScope,
    input: Readonly<{
      userId: string;
      proposalId: string;
      idempotencyKey: string;
      request: ActionProposalEditInput;
    }>,
  ): Promise<ActionProposalMutationResponse> {
    const transaction = this.unitOfWork.clientFor(scope);
    const replay = await this.claimProposalMutationIdempotency(transaction, 'edit', input);
    if (replay) return replay;
    const proposal = await this.lockEditableProposal(transaction, input);
    const command = input.request.command;

    if (command.type === 'SET_PROJECT') {
      const projectSelection = await this.resolvePublicProjectSelection(
        scope,
        input.userId,
        command.project,
        proposal.actionCode === 'CREATE_PROJECT_TASKS',
      );
      const taskMutations = proposal.mutations.filter(
        (mutation) => mutation.targetType === 'TASK' && mutation.operation === 'CREATE',
      );
      if (taskMutations.length === 0) throw proposalNotExecutable('提案不包含可编辑的任务草稿');
      for (const mutation of taskMutations) {
        const afterValue = this.jsonRecord(mutation.afterValue);
        await transaction.actionMutation.update({
          where: { id: mutation.id },
          data: {
            afterValue: asJson({ ...afterValue, project: projectSelection }),
            fieldSource: 'USER',
          },
        });
      }
    } else if (command.type === 'UPDATE_TASK_DRAFT') {
      const mutation = proposal.mutations.find((candidate) => candidate.id === command.mutationId);
      if (!mutation || mutation.targetType !== 'TASK' || mutation.operation !== 'CREATE') {
        throw proposalNotExecutable('任务草稿不存在或不可编辑');
      }
      const projectSelection = command.changes.project
        ? await this.resolvePublicProjectSelection(
            scope,
            input.userId,
            command.changes.project,
            proposal.actionCode === 'CREATE_PROJECT_TASKS',
          )
        : undefined;
      if (projectSelection) {
        for (const taskMutation of proposal.mutations.filter(
          (candidate) => candidate.targetType === 'TASK' && candidate.operation === 'CREATE',
        )) {
          await transaction.actionMutation.update({
            where: { id: taskMutation.id },
            data: {
              afterValue: asJson({
                ...this.jsonRecord(taskMutation.afterValue),
                project: projectSelection,
              }),
              fieldSource: 'USER',
            },
          });
        }
      }
      const taskChanges = { ...command.changes };
      delete taskChanges.project;
      await transaction.actionMutation.update({
        where: { id: mutation.id },
        data: {
          afterValue: asJson({
            ...this.jsonRecord(mutation.afterValue),
            ...taskChanges,
            ...(projectSelection ? { project: projectSelection } : {}),
          }),
          fieldSource: 'USER',
        },
      });
    } else if (command.type === 'REMOVE_MUTATION') {
      const mutation = proposal.mutations.find((candidate) => candidate.id === command.mutationId);
      const isOrganize = proposal.actionCode === 'ORGANIZE_TASKS';
      const removableOperation = isOrganize ? 'UPDATE' : 'CREATE';
      if (
        !mutation ||
        mutation.targetType !== 'TASK' ||
        mutation.operation !== removableOperation
      ) {
        throw proposalNotExecutable('该建议项不可移除');
      }
      const taskCount = proposal.mutations.filter(
        (candidate) =>
          candidate.targetType === 'TASK' && candidate.operation === removableOperation,
      ).length;
      if (taskCount <= 1) throw proposalNotExecutable('至少需要保留一项任务');
      await transaction.actionMutation.delete({ where: { id: mutation.id } });
    } else {
      const mutation = proposal.mutations.find((candidate) => candidate.id === command.mutationId);
      if (!mutation || mutation.targetType !== 'TASK' || mutation.operation !== 'CREATE') {
        throw proposalNotExecutable('任务草稿不存在或不可编辑');
      }
      const afterValue = this.jsonRecord(mutation.afterValue);
      if (command.field === 'PROJECT') {
        if (proposal.actionCode === 'CREATE_PROJECT_TASKS') {
          throw proposalNotExecutable('计划任务必须保留项目归属');
        }
        afterValue.project = { type: 'NONE' };
      } else {
        const field = {
          SCHEDULED_AT: 'scheduledAt',
          DEADLINE_AT: 'deadlineAt',
          REMINDER_AT: 'reminderAt',
        }[command.field];
        afterValue[field] = null;
      }
      await transaction.actionMutation.update({
        where: { id: mutation.id },
        data: { afterValue: asJson(afterValue), fieldSource: 'USER' },
      });
    }

    await this.reconcileProjectCreateMutations(transaction, proposal.id, input.userId);
    await transaction.actionProposal.update({
      where: { id: proposal.id },
      data: { version: { increment: 1 } },
    });
    const response = await this.loadProposalResponse(transaction, input.userId, proposal.id);
    await this.completeProposalMutationIdempotency(transaction, 'edit', input, response);
    return response;
  }

  async dismissProposal(
    scope: TransactionScope,
    input: Readonly<{
      userId: string;
      proposalId: string;
      idempotencyKey: string;
      request: { version: number };
    }>,
  ): Promise<ActionProposalMutationResponse> {
    const transaction = this.unitOfWork.clientFor(scope);
    const replay = await this.claimProposalMutationIdempotency(transaction, 'dismiss', input);
    if (replay) return replay;
    const proposal = await this.lockDismissibleProposal(transaction, input);
    await transaction.actionProposal.update({
      where: { id: proposal.id },
      data: { lastDismissedAt: new Date(), version: { increment: 1 } },
    });
    const response = await this.loadProposalResponse(transaction, input.userId, proposal.id);
    await this.completeProposalMutationIdempotency(transaction, 'dismiss', input, response);
    return response;
  }

  async cancelProposal(
    scope: TransactionScope,
    input: Readonly<{
      userId: string;
      proposalId: string;
      idempotencyKey: string;
      request: { version: number };
    }>,
  ): Promise<ActionProposalMutationResponse> {
    const transaction = this.unitOfWork.clientFor(scope);
    const replay = await this.claimProposalMutationIdempotency(transaction, 'cancel', input);
    if (replay) return replay;
    const proposal = await this.lockEditableProposal(transaction, input);
    await transaction.actionProposal.update({
      where: { id: proposal.id },
      data: { status: 'CANCELLED', cancelledAt: new Date(), version: { increment: 1 } },
    });
    const response = await this.loadProposalResponse(transaction, input.userId, proposal.id);
    await this.completeProposalMutationIdempotency(transaction, 'cancel', input, response);
    return response;
  }

  async lockEditableProposal(
    transaction: Transaction,
    input: Readonly<{ userId: string; proposalId: string; request: { version: number } }>,
  ) {
    if (!(await this.lockProposal(transaction, input.userId, input.proposalId))) {
      throw proposalNotFound();
    }
    const found = await transaction.actionProposal.findFirst({
      where: {
        id: input.proposalId,
        userId: input.userId,
        requestRun: { status: 'SUCCEEDED' },
      },
      include: { mutations: { orderBy: { sequence: 'asc' } } },
    });
    if (!found) throw proposalNotFound();
    const proposal = await this.expireProposalIfNeeded(transaction, found, new Date());
    if (proposal.version !== input.request.version) throw proposalVersionConflict(proposal.version);
    if (!['DRAFT', 'AWAITING_CONFIRMATION'].includes(proposal.status)) {
      throw proposalNotExecutable();
    }
    return proposal;
  }

  async lockDismissibleProposal(
    transaction: Transaction,
    input: Readonly<{ userId: string; proposalId: string; request: { version: number } }>,
  ) {
    if (!(await this.lockProposal(transaction, input.userId, input.proposalId))) {
      throw proposalNotFound();
    }
    const found = await transaction.actionProposal.findFirst({
      where: {
        id: input.proposalId,
        userId: input.userId,
        requestRun: { status: 'SUCCEEDED' },
      },
      include: { mutations: { orderBy: { sequence: 'asc' } } },
    });
    if (!found) throw proposalNotFound();
    const proposal = await this.expireProposalIfNeeded(transaction, found, new Date());
    if (proposal.version !== input.request.version) throw proposalVersionConflict(proposal.version);
    if (!['DRAFT', 'AWAITING_CONFIRMATION', 'FAILED'].includes(proposal.status)) {
      throw proposalNotExecutable('该提案当前不可关闭');
    }
    return proposal;
  }

  async expireProposalIfNeeded<
    T extends {
      id: string;
      status: string;
      expiresAt: Date | null;
      version: number;
    },
  >(transaction: Transaction, proposal: T, now: Date): Promise<T> {
    if (
      proposal.expiresAt &&
      proposal.expiresAt <= now &&
      ['DRAFT', 'AWAITING_CONFIRMATION'].includes(proposal.status)
    ) {
      await transaction.actionProposal.updateMany({
        where: { id: proposal.id, version: proposal.version, status: proposal.status as never },
        data: { status: 'EXPIRED', expiredAt: now, version: { increment: 1 } },
      });
      return { ...proposal, status: 'EXPIRED', version: proposal.version + 1 };
    }
    return proposal;
  }

  async claimProposalMutationIdempotency(
    transaction: Transaction,
    operation: 'cancel' | 'dismiss' | 'edit',
    input: Readonly<{
      userId: string;
      proposalId: string;
      idempotencyKey: string;
      request: unknown;
    }>,
  ): Promise<ActionProposalMutationResponse | null> {
    const source = await transaction.actionProposal.findFirst({
      where: { id: input.proposalId, userId: input.userId },
      select: { requestRun: { select: { resultType: true } } },
    });
    if (!source) throw proposalNotFound();
    const presentation = this.proposalPresentation(source.requestRun.resultType);
    return this.claimProductIdempotency(
      transaction,
      {
        userId: input.userId,
        scope: `agent.proposal-${operation}`,
        key: input.idempotencyKey,
        request: { proposalId: input.proposalId, request: input.request },
      },
      (snapshot) => {
        const record = this.jsonRecord(snapshot);
        const prior = this.jsonRecord(record.proposal as Prisma.JsonValue);
        const parsed = actionProposalMutationResponseSchema.safeParse({
          proposal: { ...prior, presentation },
        });
        return parsed.success ? parsed.data : null;
      },
    );
  }

  completeProposalMutationIdempotency(
    transaction: Transaction,
    operation: 'cancel' | 'dismiss' | 'edit',
    input: Readonly<{ userId: string; idempotencyKey: string }>,
    response: ActionProposalMutationResponse,
  ): Promise<void> {
    return this.completeProductIdempotency(transaction, {
      userId: input.userId,
      scope: `agent.proposal-${operation}`,
      key: input.idempotencyKey,
      response,
      responseStatus: 200,
    });
  }

  async resolvePublicProjectSelection(
    scope: TransactionScope,
    userId: string,
    selection:
      | Readonly<{ type: 'EXISTING'; projectId: string }>
      | Readonly<{ type: 'NEW'; name: string }>
      | Readonly<{ type: 'NONE' }>,
    projectRequired: boolean,
  ): Promise<ResolvedProjectSelection> {
    if (selection.type === 'NONE') {
      if (projectRequired) throw proposalNotExecutable('计划任务必须选择已有或新项目');
      return selection;
    }
    if (selection.type === 'NEW') {
      if (Array.from(selection.name.trim()).length > MAX_PROJECT_NAME_LENGTH) {
        throw proposalNotExecutable('项目名称不能超过 40 个字符');
      }
      return { type: 'NEW', name: selection.name.trim() };
    }
    const project = await this.projects.findActiveAgentProject(scope, {
      userId,
      projectId: selection.projectId,
    });
    if (!project) throw proposalNotExecutable('所选项目不存在或已归档');
    return {
      type: 'EXISTING',
      projectId: project.id,
      expectedVersion: project.version,
    };
  }

  async reconcileProjectCreateMutations(
    transaction: Transaction,
    proposalId: string,
    userId: string,
  ): Promise<void> {
    const mutations = await transaction.actionMutation.findMany({
      where: { proposalId, userId },
      orderBy: { sequence: 'asc' },
    });
    const taskMutations = mutations.filter(
      (mutation) => mutation.targetType === 'TASK' && mutation.operation === 'CREATE',
    );
    const newProjectNames = [
      ...new Set(
        taskMutations.flatMap((mutation) => {
          const project = this.jsonRecord(mutation.afterValue).project;
          if (
            typeof project === 'object' &&
            project !== null &&
            !Array.isArray(project) &&
            project.type === 'NEW' &&
            typeof project.name === 'string'
          ) {
            return [project.name];
          }
          return [];
        }),
      ),
    ];
    const projectMutations = mutations.filter(
      (mutation) => mutation.targetType === 'PROJECT' && mutation.operation === 'CREATE',
    );
    for (const mutation of projectMutations) {
      const name = this.jsonRecord(mutation.afterValue).name;
      if (typeof name !== 'string' || !newProjectNames.includes(name)) {
        await transaction.actionMutation.delete({ where: { id: mutation.id } });
      }
    }
    const retainedNames = new Set(
      projectMutations.flatMap((mutation) => {
        const name = this.jsonRecord(mutation.afterValue).name;
        return typeof name === 'string' && newProjectNames.includes(name) ? [name] : [];
      }),
    );
    let temporarySequence = Math.max(0, ...mutations.map((mutation) => mutation.sequence)) + 1;
    for (const name of newProjectNames) {
      if (retainedNames.has(name)) continue;
      await transaction.actionMutation.create({
        data: {
          userId,
          proposalId,
          sequence: temporarySequence,
          operation: 'CREATE',
          targetType: 'PROJECT',
          targetId: null,
          targetVersion: null,
          beforeValue: Prisma.DbNull,
          afterValue: { name },
          fieldSource: 'USER',
        },
      });
      temporarySequence += 1;
    }
    const current = await transaction.actionMutation.findMany({
      where: { proposalId, userId },
      orderBy: [{ sequence: 'asc' }, { id: 'asc' }],
    });
    const ordered = [
      ...current
        .filter((mutation) => mutation.targetType === 'PROJECT')
        .sort((left, right) => {
          const leftName = this.jsonRecord(left.afterValue).name;
          const rightName = this.jsonRecord(right.afterValue).name;
          return (typeof leftName === 'string' ? leftName : '').localeCompare(
            typeof rightName === 'string' ? rightName : '',
          );
        }),
      ...current.filter((mutation) => mutation.targetType === 'TASK'),
    ];
    for (const mutation of ordered) {
      await transaction.actionMutation.update({
        where: { id: mutation.id },
        data: { sequence: mutation.sequence + 1_000 },
      });
    }
    for (const [index, mutation] of ordered.entries()) {
      await transaction.actionMutation.update({
        where: { id: mutation.id },
        data: { sequence: index + 1 },
      });
    }
  }

  async loadProposalResponse(
    transaction: Transaction,
    userId: string,
    proposalId: string,
  ): Promise<ActionProposalMutationResponse> {
    const proposal = await transaction.actionProposal.findFirst({
      where: { id: proposalId, userId },
      include: {
        mutations: { orderBy: { sequence: 'asc' } },
        requestRun: { select: { resultType: true } },
      },
    });
    if (!proposal) throw proposalNotFound();
    return actionProposalMutationResponseSchema.parse({
      proposal: this.publicProposal(proposal, proposal.requestRun.resultType),
    });
  }
}
