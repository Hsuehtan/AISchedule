import { Inject, Injectable } from '@nestjs/common';

import type { AgentAdmissionPort } from '../../modules/agent/agent-admission.port.js';
import type { AgentProductPort } from '../../modules/agent/agent-product.port.js';
import { type AgentRunPort } from '../../modules/agent/agent-runtime.port.js';
import {
  AGENT_PROJECTS_PORT,
  type AgentProjectsPort,
} from '../../modules/projects/agent-projects.port.js';
import { AGENT_TASKS_PORT, type AgentTasksPort } from '../../modules/tasks/agent-tasks.port.js';
import { DatabaseService } from '../database/database.service.js';
import { DatabaseUnitOfWork } from '../database/unit-of-work.js';

import { AgentResultMaterializer } from './agent-result.materializer.js';
import { PrismaAgentContextReader } from './prisma-agent-context.reader.js';
import { PrismaAgentConversationStore } from './prisma-agent-conversation.store.js';
import { PrismaAgentProposalStore } from './prisma-agent-proposal.store.js';
import { PrismaAgentRunStore } from './prisma-agent-run.store.js';
export {
  AgentLateResultError,
  AgentPersistenceInvariantError,
  AgentResultNotImplementedError,
} from './agent-persistence.shared.js';
@Injectable()
export class PrismaAgentPersistence implements AgentAdmissionPort, AgentRunPort, AgentProductPort {
  readonly context: PrismaAgentContextReader;
  readonly proposal: PrismaAgentProposalStore;
  readonly conversation: PrismaAgentConversationStore;
  readonly run: PrismaAgentRunStore;
  readonly result: AgentResultMaterializer;
  constructor(
    @Inject(DatabaseUnitOfWork) unitOfWork: DatabaseUnitOfWork,
    @Inject(DatabaseService) database: DatabaseService,
    @Inject(AGENT_TASKS_PORT) tasks: AgentTasksPort,
    @Inject(AGENT_PROJECTS_PORT) projects: AgentProjectsPort,
  ) {
    this.context = new PrismaAgentContextReader(unitOfWork, database, tasks, projects);
    this.proposal = new PrismaAgentProposalStore(unitOfWork, database, tasks, projects);
    this.result = new AgentResultMaterializer(unitOfWork, database, tasks, projects, this.context);
    this.conversation = new PrismaAgentConversationStore(
      unitOfWork,
      database,
      tasks,
      projects,
      this.context,
      this.proposal,
    );
    this.run = new PrismaAgentRunStore(unitOfWork, database, tasks, projects, this.conversation);
  }
  replayAnswer(
    ...args: Parameters<PrismaAgentConversationStore['replayAnswer']>
  ): ReturnType<PrismaAgentConversationStore['replayAnswer']> {
    return this.conversation.replayAnswer(...args);
  }
  inspectAnswer(
    ...args: Parameters<PrismaAgentConversationStore['inspectAnswer']>
  ): ReturnType<PrismaAgentConversationStore['inspectAnswer']> {
    return this.conversation.inspectAnswer(...args);
  }
  answerDeterministically(
    ...args: Parameters<PrismaAgentConversationStore['answerDeterministically']>
  ): ReturnType<PrismaAgentConversationStore['answerDeterministically']> {
    return this.conversation.answerDeterministically(...args);
  }
  claimIdempotency(
    ...args: Parameters<PrismaAgentRunStore['claimIdempotency']>
  ): ReturnType<PrismaAgentRunStore['claimIdempotency']> {
    return this.run.claimIdempotency(...args);
  }
  createRun(
    ...args: Parameters<PrismaAgentRunStore['createRun']>
  ): ReturnType<PrismaAgentRunStore['createRun']> {
    return this.run.createRun(...args);
  }
  attachReservation(
    ...args: Parameters<PrismaAgentRunStore['attachReservation']>
  ): ReturnType<PrismaAgentRunStore['attachReservation']> {
    return this.run.attachReservation(...args);
  }
  completeIdempotency(
    ...args: Parameters<PrismaAgentRunStore['completeIdempotency']>
  ): ReturnType<PrismaAgentRunStore['completeIdempotency']> {
    return this.run.completeIdempotency(...args);
  }
  claimProcessing(
    ...args: Parameters<PrismaAgentRunStore['claimProcessing']>
  ): ReturnType<PrismaAgentRunStore['claimProcessing']> {
    return this.run.claimProcessing(...args);
  }
  persistResult(
    ...args: Parameters<AgentResultMaterializer['persistResult']>
  ): ReturnType<AgentResultMaterializer['persistResult']> {
    return this.result.persistResult(...args);
  }
  recordAmbiguousFailure(
    ...args: Parameters<PrismaAgentRunStore['recordAmbiguousFailure']>
  ): ReturnType<PrismaAgentRunStore['recordAmbiguousFailure']> {
    return this.run.recordAmbiguousFailure(...args);
  }
  markFailed(
    ...args: Parameters<PrismaAgentRunStore['markFailed']>
  ): ReturnType<PrismaAgentRunStore['markFailed']> {
    return this.run.markFailed(...args);
  }
  markSucceeded(
    ...args: Parameters<PrismaAgentRunStore['markSucceeded']>
  ): ReturnType<PrismaAgentRunStore['markSucceeded']> {
    return this.run.markSucceeded(...args);
  }
  markReleased(
    ...args: Parameters<PrismaAgentRunStore['markReleased']>
  ): ReturnType<PrismaAgentRunStore['markReleased']> {
    return this.run.markReleased(...args);
  }
  getRequest(
    ...args: Parameters<PrismaAgentRunStore['getRequest']>
  ): ReturnType<PrismaAgentRunStore['getRequest']> {
    return this.run.getRequest(...args);
  }
  listMessages(
    ...args: Parameters<PrismaAgentConversationStore['listMessages']>
  ): ReturnType<PrismaAgentConversationStore['listMessages']> {
    return this.conversation.listMessages(...args);
  }
  markConversationViewed(
    ...args: Parameters<PrismaAgentConversationStore['markConversationViewed']>
  ): ReturnType<PrismaAgentConversationStore['markConversationViewed']> {
    return this.conversation.markConversationViewed(...args);
  }
  getProposal(
    ...args: Parameters<PrismaAgentProposalStore['getProposal']>
  ): ReturnType<PrismaAgentProposalStore['getProposal']> {
    return this.proposal.getProposal(...args);
  }
  editProposal(
    ...args: Parameters<PrismaAgentProposalStore['editProposal']>
  ): ReturnType<PrismaAgentProposalStore['editProposal']> {
    return this.proposal.editProposal(...args);
  }
  dismissProposal(
    ...args: Parameters<PrismaAgentProposalStore['dismissProposal']>
  ): ReturnType<PrismaAgentProposalStore['dismissProposal']> {
    return this.proposal.dismissProposal(...args);
  }
  cancelProposal(
    ...args: Parameters<PrismaAgentProposalStore['cancelProposal']>
  ): ReturnType<PrismaAgentProposalStore['cancelProposal']> {
    return this.proposal.cancelProposal(...args);
  }
}
