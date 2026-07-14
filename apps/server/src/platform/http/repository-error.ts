import {
  OptimisticWriteConflictError,
  RepositoryInvalidStateError,
  RepositoryRecordNotFoundError,
  UndoExpiredError,
  UndoUnavailableError,
} from '@ai-schedule/db';

import { ApiHttpException } from './api-http.exception.js';

function prismaCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

export function rethrowTaskRepositoryError(error: unknown): never {
  if (error instanceof RepositoryRecordNotFoundError) {
    const isProject = error.recordType === 'Project';
    throw new ApiHttpException(
      404,
      isProject
        ? 'PROJECT_NOT_FOUND'
        : error.recordType === 'UndoOperation'
          ? 'UNDO_NOT_FOUND'
          : 'TASK_NOT_FOUND',
      isProject
        ? '项目不存在或不可用'
        : error.recordType === 'UndoOperation'
          ? '撤销操作不存在'
          : '待办不存在',
    );
  }
  if (error instanceof OptimisticWriteConflictError) {
    throw new ApiHttpException(409, 'TASK_VERSION_CONFLICT', '待办已发生变化，请刷新后重试');
  }
  if (error instanceof RepositoryInvalidStateError) {
    throw new ApiHttpException(409, 'TASK_STATE_CONFLICT', '当前状态下无法执行该操作');
  }
  if (error instanceof UndoExpiredError) {
    throw new ApiHttpException(410, 'UNDO_EXPIRED', '撤销时间已超过 3 秒');
  }
  if (error instanceof UndoUnavailableError) {
    throw new ApiHttpException(409, 'UNDO_NOT_AVAILABLE', '该操作已撤销或不可再撤销');
  }
  if (prismaCode(error) === 'P2003') {
    throw new ApiHttpException(404, 'PROJECT_NOT_FOUND', '项目不存在或不可用');
  }
  throw error;
}

export function rethrowProjectRepositoryError(error: unknown): never {
  if (error instanceof RepositoryRecordNotFoundError) {
    throw new ApiHttpException(404, 'PROJECT_NOT_FOUND', '项目不存在');
  }
  if (error instanceof OptimisticWriteConflictError) {
    throw new ApiHttpException(409, 'PROJECT_VERSION_CONFLICT', '项目已发生变化，请刷新后重试');
  }
  if (error instanceof RepositoryInvalidStateError) {
    throw new ApiHttpException(409, 'PROJECT_STATE_CONFLICT', '当前状态下无法修改该项目');
  }
  if (prismaCode(error) === 'P2002') {
    throw new ApiHttpException(409, 'PROJECT_NAME_CONFLICT', '已有同名的活跃项目');
  }
  throw error;
}
