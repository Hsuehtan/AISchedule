import { describe, expect, it } from 'vitest';

import { appStateReducer, createInitialAppState } from './app-state';

describe('production app navigation state', () => {
  it('moves authenticated users to the real task page without a prototype screen query', () => {
    const state = appStateReducer(createInitialAppState(), {
      type: 'SESSION_RESOLVED',
      session: 'authenticated',
    });

    expect(state.page).toBe('taskHome');
    expect(state.session).toBe('authenticated');
    expect(state.panel).toBeNull();
  });

  it('marks a restored anonymous session as guest while keeping the login page', () => {
    const state = appStateReducer(createInitialAppState(), {
      type: 'SESSION_RESOLVED',
      session: 'guest',
    });

    expect(state.page).toBe('login');
    expect(state.session).toBe('guest');
  });

  it('opens manual creation from the top add action and edits by the real task id', () => {
    const authenticated = appStateReducer(createInitialAppState(), {
      type: 'SESSION_RESOLVED',
      session: 'authenticated',
    });
    const creating = appStateReducer(authenticated, { type: 'OPEN_CREATE_TASK' });
    const editing = appStateReducer(creating, {
      type: 'OPEN_EDIT_TASK',
      taskId: '018f31f3-0074-76b4-bba5-b49c74ae90d5',
    });

    expect(creating.panel).toEqual({ type: 'createTask' });
    expect(editing.panel).toEqual({
      type: 'editTask',
      taskId: '018f31f3-0074-76b4-bba5-b49c74ae90d5',
    });
  });

  it('keeps the selected project when browser back closes a panel', () => {
    const selected = appStateReducer(createInitialAppState(), {
      type: 'SELECT_PROJECT',
      projectId: '018f31f2-7c27-7587-85f0-a62f4cc8e5c1',
    });
    const opened = appStateReducer(selected, { type: 'OPEN_PROJECT_MANAGER' });
    const closed = appStateReducer(opened, { type: 'CLOSE_PANEL' });

    expect(closed.filter).toEqual({
      type: 'project',
      projectId: '018f31f2-7c27-7587-85f0-a62f4cc8e5c1',
    });
    expect(closed.panel).toBeNull();
  });

  it('clears every account-scoped UI value when the user becomes a guest', () => {
    let state = appStateReducer(createInitialAppState(), {
      type: 'SELECT_PROJECT',
      projectId: '018f31f2-7c27-7587-85f0-a62f4cc8e5c1',
    });
    state = appStateReducer(state, {
      type: 'OPEN_EDIT_TASK',
      taskId: '018f31f3-0074-76b4-bba5-b49c74ae90d5',
    });
    state = appStateReducer(state, { type: 'TOGGLE_COMPLETED' });
    state = appStateReducer(state, {
      type: 'SHOW_DELETE_UNDO',
      receipt: {
        expiresAt: '2026-07-14T12:00:03.000Z',
        operationId: '018f31f4-0074-76b4-bba5-b49c74ae90d6',
        taskTitle: '上一位用户的待办',
      },
    });

    expect(appStateReducer(state, { type: 'LOGOUT' })).toEqual({
      ...createInitialAppState(),
      page: 'login',
      session: 'guest',
    });
  });
});
