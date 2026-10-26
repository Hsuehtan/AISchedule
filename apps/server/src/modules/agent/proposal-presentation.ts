import type { PublicActionProposal } from '@ai-schedule/contracts';

export function proposalPresentation(
  resultType: string | null,
  actionCode: string | null,
): PublicActionProposal['presentation'] {
  if (resultType !== 'PLAN' && resultType !== 'ACTION_PROPOSAL') {
    throw new Error('Proposal source result type is invalid');
  }
  switch (actionCode) {
    case 'CREATE_TASK':
    case 'CREATE_PROJECT_TASKS':
      return 'PLAN';
    case 'UPDATE_TASK':
    case 'COMPLETE_TASK':
    case 'RESTORE_TASK':
    case 'DELETE_TASK':
    case 'ORGANIZE_TASKS':
      return 'ACTION';
    default:
      throw new Error('Proposal operation is invalid');
  }
}
