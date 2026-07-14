export class RepositoryRecordNotFoundError extends Error {
  constructor(readonly recordType: 'Project' | 'Task' | 'UndoOperation') {
    super(`${recordType} was not found`);
    this.name = 'RepositoryRecordNotFoundError';
  }
}

export class OptimisticWriteConflictError extends Error {
  constructor() {
    super('The record version no longer matches');
    this.name = 'OptimisticWriteConflictError';
  }
}

export class RepositoryInvalidStateError extends Error {
  constructor(readonly state: string) {
    super(`The record cannot be changed from state ${state}`);
    this.name = 'RepositoryInvalidStateError';
  }
}

export class UndoExpiredError extends Error {
  constructor() {
    super('The undo window has expired');
    this.name = 'UndoExpiredError';
  }
}

export class UndoUnavailableError extends Error {
  constructor() {
    super('The undo operation is no longer available');
    this.name = 'UndoUnavailableError';
  }
}
