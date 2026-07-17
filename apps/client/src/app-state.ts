export type SessionState = 'booting' | 'guest' | 'authenticated';
export type AppPage = 'login' | 'register' | 'taskHome';

export type TaskFilter = { type: 'all' } | { type: 'project'; projectId: string };

export type AgentUnavailableReason = 'QUOTA' | 'SERVICE' | 'VOICE_DEFERRED';

export type AppPanel =
  | { type: 'createTask' }
  | { type: 'editTask'; taskId: string }
  | { type: 'projectManager' }
  | { type: 'createProject' }
  | { type: 'renameProject'; projectId: string }
  | { type: 'archiveProjectConfirm'; projectId: string }
  | { type: 'agentTextInput'; conversationId?: string; replyToMessageId?: string }
  | { type: 'agentConversation'; conversationId: string; focusMessageId?: string }
  | { type: 'agentProposal'; presentation: 'ACTION' | 'PLAN'; proposalId: string }
  | { type: 'agentUnavailable'; reason: AgentUnavailableReason };

export type DeleteUndoReceipt = {
  expiresAt: string;
  operationId: string;
  taskTitle: string;
};

export type AppState = {
  completedExpanded: boolean;
  deleteUndoReceipt: DeleteUndoReceipt | null;
  filter: TaskFilter;
  page: AppPage;
  panel: AppPanel | null;
  session: SessionState;
  smartInboxCollapsed: boolean;
};

export type AppStateAction =
  | { type: 'SESSION_RESOLVED'; session: Exclude<SessionState, 'booting'> }
  | { type: 'GO_TO_LOGIN' }
  | { type: 'GO_TO_REGISTER' }
  | { type: 'LOGOUT' }
  | { type: 'SELECT_ALL' }
  | { type: 'SELECT_PROJECT'; projectId: string }
  | { type: 'OPEN_CREATE_TASK' }
  | { type: 'OPEN_EDIT_TASK'; taskId: string }
  | { type: 'OPEN_PROJECT_MANAGER' }
  | { type: 'OPEN_CREATE_PROJECT' }
  | { type: 'OPEN_RENAME_PROJECT'; projectId: string }
  | { type: 'OPEN_ARCHIVE_PROJECT'; projectId: string }
  | { type: 'OPEN_AGENT_TEXT'; conversationId?: string; replyToMessageId?: string }
  | { type: 'OPEN_AGENT_CONVERSATION'; conversationId: string; focusMessageId?: string }
  | { type: 'OPEN_AGENT_PROPOSAL'; presentation: 'ACTION' | 'PLAN'; proposalId: string }
  | { type: 'OPEN_AGENT_UNAVAILABLE'; reason: AgentUnavailableReason }
  | { type: 'SET_SMART_INBOX_COLLAPSED'; collapsed: boolean }
  | { type: 'CLOSE_PANEL' }
  | { type: 'TOGGLE_COMPLETED' }
  | { type: 'PROJECT_ARCHIVED'; projectId: string }
  | { type: 'SHOW_DELETE_UNDO'; receipt: DeleteUndoReceipt }
  | { type: 'CLEAR_DELETE_UNDO' };

export function createInitialAppState(): AppState {
  return {
    completedExpanded: false,
    deleteUndoReceipt: null,
    filter: { type: 'all' },
    page: 'login',
    panel: null,
    session: 'booting',
    smartInboxCollapsed: false,
  };
}

export function appStateReducer(state: AppState, action: AppStateAction): AppState {
  switch (action.type) {
    case 'SESSION_RESOLVED':
      return {
        ...createInitialAppState(),
        page: action.session === 'authenticated' ? 'taskHome' : 'login',
        session: action.session,
      };
    case 'GO_TO_LOGIN':
      return { ...state, page: 'login', panel: null };
    case 'GO_TO_REGISTER':
      return { ...state, page: 'register', panel: null };
    case 'LOGOUT':
      return {
        ...createInitialAppState(),
        page: 'login',
        session: 'guest',
      };
    case 'SELECT_ALL':
      return { ...state, filter: { type: 'all' }, panel: null };
    case 'SELECT_PROJECT':
      return {
        ...state,
        filter: { type: 'project', projectId: action.projectId },
        panel: null,
      };
    case 'OPEN_CREATE_TASK':
      return { ...state, panel: { type: 'createTask' } };
    case 'OPEN_EDIT_TASK':
      return { ...state, panel: { type: 'editTask', taskId: action.taskId } };
    case 'OPEN_PROJECT_MANAGER':
      return { ...state, panel: { type: 'projectManager' } };
    case 'OPEN_CREATE_PROJECT':
      return { ...state, panel: { type: 'createProject' } };
    case 'OPEN_RENAME_PROJECT':
      return { ...state, panel: { type: 'renameProject', projectId: action.projectId } };
    case 'OPEN_ARCHIVE_PROJECT':
      return {
        ...state,
        panel: { type: 'archiveProjectConfirm', projectId: action.projectId },
      };
    case 'OPEN_AGENT_TEXT':
      return {
        ...state,
        panel: {
          type: 'agentTextInput',
          ...(action.conversationId ? { conversationId: action.conversationId } : {}),
          ...(action.replyToMessageId ? { replyToMessageId: action.replyToMessageId } : {}),
        },
      };
    case 'OPEN_AGENT_CONVERSATION':
      return {
        ...state,
        panel: {
          type: 'agentConversation',
          conversationId: action.conversationId,
          ...(action.focusMessageId ? { focusMessageId: action.focusMessageId } : {}),
        },
      };
    case 'OPEN_AGENT_PROPOSAL':
      return {
        ...state,
        panel: {
          type: 'agentProposal',
          presentation: action.presentation,
          proposalId: action.proposalId,
        },
      };
    case 'OPEN_AGENT_UNAVAILABLE':
      return { ...state, panel: { type: 'agentUnavailable', reason: action.reason } };
    case 'SET_SMART_INBOX_COLLAPSED':
      return { ...state, smartInboxCollapsed: action.collapsed };
    case 'CLOSE_PANEL':
      return { ...state, panel: null };
    case 'TOGGLE_COMPLETED':
      return { ...state, completedExpanded: !state.completedExpanded };
    case 'PROJECT_ARCHIVED':
      return {
        ...state,
        filter:
          state.filter.type === 'project' && state.filter.projectId === action.projectId
            ? { type: 'all' }
            : state.filter,
        panel: { type: 'projectManager' },
      };
    case 'SHOW_DELETE_UNDO':
      return { ...state, deleteUndoReceipt: action.receipt };
    case 'CLEAR_DELETE_UNDO':
      return { ...state, deleteUndoReceipt: null };
  }
}
