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

  it('opens the formal Agent composer without replacing the selected project filter', () => {
    const selected = appStateReducer(createInitialAppState(), {
      type: 'SELECT_PROJECT',
      projectId: '018f31f2-7c27-7587-85f0-a62f4cc8e5c1',
    });
    const opened = appStateReducer(selected, {
      type: 'OPEN_AGENT_TEXT',
      conversationId: '018f31f4-0074-76b4-bba5-b49c74ae90d6',
      replyToMessageId: '018f31f5-0074-76b4-bba5-b49c74ae90d7',
      replyToVersion: 3,
    });

    expect(opened.filter).toEqual(selected.filter);
    expect(opened.panel).toEqual({
      type: 'agentTextInput',
      conversationId: '018f31f4-0074-76b4-bba5-b49c74ae90d6',
      replyToMessageId: '018f31f5-0074-76b4-bba5-b49c74ae90d7',
      replyToVersion: 3,
    });
  });

  it('restores a real Agent conversation and proposal by their persisted ids', () => {
    const conversation = appStateReducer(createInitialAppState(), {
      type: 'OPEN_AGENT_CONVERSATION',
      conversationId: '018f31f4-0074-76b4-bba5-b49c74ae90d6',
      focusMessageId: '018f31f5-0074-76b4-bba5-b49c74ae90d7',
      requestId: '018f31f7-0074-76b4-bba5-b49c74ae90d9',
    });
    const proposal = appStateReducer(conversation, {
      type: 'OPEN_AGENT_PROPOSAL',
      proposalId: '018f31f6-0074-76b4-bba5-b49c74ae90d8',
      presentation: 'PLAN',
    });

    expect(conversation.panel).toEqual({
      type: 'agentConversation',
      conversationId: '018f31f4-0074-76b4-bba5-b49c74ae90d6',
      focusMessageId: '018f31f5-0074-76b4-bba5-b49c74ae90d7',
      requestId: '018f31f7-0074-76b4-bba5-b49c74ae90d9',
    });
    expect(proposal.panel).toEqual({
      type: 'agentProposal',
      proposalId: '018f31f6-0074-76b4-bba5-b49c74ae90d8',
      presentation: 'PLAN',
    });
  });

  it('distinguishes quota, service and deferred voice Agent unavailable states', () => {
    const unavailable = appStateReducer(createInitialAppState(), {
      type: 'OPEN_AGENT_UNAVAILABLE',
      reason: 'QUOTA',
    });

    expect(unavailable.panel).toEqual({ type: 'agentUnavailable', reason: 'QUOTA' });
  });

  it('keeps the Smart Inbox collapsed preference in account-scoped UI state', () => {
    const collapsed = appStateReducer(createInitialAppState(), {
      type: 'SET_SMART_INBOX_COLLAPSED',
      collapsed: true,
    });

    expect(collapsed.smartInboxCollapsed).toBe(true);
    expect(appStateReducer(collapsed, { type: 'LOGOUT' }).smartInboxCollapsed).toBe(false);
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
