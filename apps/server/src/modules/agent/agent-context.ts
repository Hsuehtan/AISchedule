import { randomBytes } from 'node:crypto';

export function createCandidateReference(): string {
  return `cand_${randomBytes(16).toString('hex')}`;
}

export function createOptionId(): string {
  return `opt_${randomBytes(8).toString('hex')}`;
}
