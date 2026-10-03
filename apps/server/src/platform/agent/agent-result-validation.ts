import type { CandidateContext, ExecuteResult } from '@ai-schedule/contracts/internal-agent/v1';

const ACTION_OPERATIONS = {
  CREATE_PROJECT_TASKS: new Set(['CREATE_PROJECT_TASKS']),
  CREATE_TASK: new Set(['CREATE_TASK']),
  ORGANIZE_TASKS: new Set(['ORGANIZE_TASK']),
  UPDATE_TASK: new Set(['UPDATE_TASK']),
  COMPLETE_TASK: new Set(['COMPLETE_TASK']),
  RESTORE_TASK: new Set(['RESTORE_TASK']),
  DELETE_TASK: new Set(['DELETE_TASK']),
} as const;

export function assertUnique(values: readonly string[]): void {
  if (new Set(values).size !== values.length) throw new Error('Duplicate reference');
}

function candidateMap(request: ReferenceContext): ReadonlyMap<string, CandidateContext> {
  return new Map(request.candidates.map((candidate) => [candidate.candidateRef, candidate]));
}

type ReferenceContext = {
  allowedResultTypes: readonly string[];
  candidates: readonly CandidateContext[];
};

export function validateResultReferences(request: ReferenceContext, result: ExecuteResult): void {
  if (!request.allowedResultTypes.includes(result.type)) {
    throw new Error('Result type was not allowed');
  }

  const candidates = candidateMap(request);
  const requireCandidate = (
    reference: string,
    kind: CandidateContext['kind'],
    expectedVersion?: number,
  ): CandidateContext => {
    const candidate = candidates.get(reference);
    if (
      !candidate ||
      candidate.kind !== kind ||
      candidate.version !== (expectedVersion ?? candidate.version)
    ) {
      throw new Error('Untrusted candidate reference');
    }
    return candidate;
  };
  const validateProject = (project: { type: string; candidateRef?: string }): void => {
    if (project.type === 'EXISTING') requireCandidate(project.candidateRef ?? '', 'PROJECT');
  };

  switch (result.type) {
    case 'REPLY':
    case 'CLARIFICATION':
      if (result.type === 'CLARIFICATION') {
        assertUnique(result.options.map(({ optionId }) => optionId));
      }
      return;
    case 'CANDIDATES':
      assertUnique(result.options.map(({ optionId }) => optionId));
      assertUnique(result.options.map(({ candidateRef }) => candidateRef));
      for (const option of result.options) {
        if (!candidates.has(option.candidateRef)) throw new Error('Untrusted candidate reference');
      }
      return;
    case 'PLAN':
      validateProject(result.project);
      assertUnique(result.tasks.map(({ clientRef }) => clientRef));
      return;
    case 'ACTION_PROPOSAL': {
      if (
        (result.actionCode === 'CREATE_TASK' || result.actionCode === 'CREATE_PROJECT_TASKS') &&
        result.mutations.length !== 1
      ) {
        throw new Error('Create actions require exactly one mutation');
      }
      const allowedOperations = ACTION_OPERATIONS[result.actionCode];
      const targetReferences: string[] = [];
      const draftReferences: string[] = [];
      for (const mutation of result.mutations) {
        if (!(allowedOperations as ReadonlySet<string>).has(mutation.operation)) {
          throw new Error('Action code does not match mutation');
        }
        switch (mutation.operation) {
          case 'CREATE_TASK':
            validateProject(mutation.project);
            draftReferences.push(mutation.task.clientRef);
            break;
          case 'CREATE_PROJECT_TASKS':
            validateProject(mutation.project);
            draftReferences.push(...mutation.tasks.map(({ clientRef }) => clientRef));
            break;
          case 'ORGANIZE_TASK':
            requireCandidate(mutation.targetRef, 'TASK', mutation.expectedVersion);
            requireCandidate(mutation.projectRef, 'PROJECT');
            targetReferences.push(mutation.targetRef);
            break;
          case 'UPDATE_TASK':
            requireCandidate(mutation.targetRef, 'TASK', mutation.expectedVersion);
            targetReferences.push(mutation.targetRef);
            break;
          case 'COMPLETE_TASK':
          case 'RESTORE_TASK':
          case 'DELETE_TASK':
            requireCandidate(mutation.targetRef, 'TASK', mutation.expectedVersion);
            targetReferences.push(mutation.targetRef);
            break;
        }
      }
      assertUnique(targetReferences);
      assertUnique(draftReferences);
    }
  }
}
