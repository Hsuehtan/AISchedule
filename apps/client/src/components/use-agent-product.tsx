import type {
  AgentTurnQueuedResponse,
  MessageAnswerResponse,
  Project,
  PublicActionProposal,
  SmartInboxItem,
} from '@ai-schedule/contracts';
import { BottomSheet, ElectricButton } from '@ai-schedule/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { agentPollingInterval } from '../agent-polling';
import { presentAgentMessages } from '../agent-presentation';
import {
  actionProposalPresentation,
  agentUnavailableReason,
  createTaskDraftChanges,
  isAgentRequestTerminal,
  type AgentProposalDraftItem,
} from '../agent-product-model';
import { ApiRequestError } from '../api-client';
import type { AppPanel } from '../app-state';
import { useAppState } from '../app-state-context';
import { queryClient, scheduleApi } from '../app-runtime';
import { presentSmartInboxItem } from '../smart-inbox-presentation';
import { WriteIntentRegistry } from '../write-intent';
import { AgentConversationDialog } from './agent-conversation-dialog';
import { AgentTextInputSheet } from './agent-input-sheet';
import { AgentProposalSheet } from './agent-proposal-sheet';
import { AgentUnavailableSheet } from './agent-unavailable-sheet';
import './agent-panels.scss';

type SmartInboxCardModel = {
  actionAriaLabel: string;
  actionLabel: string;
  body: string;
  collapsed: boolean;
  onAction: () => void;
  onToggleCollapsed: () => void;
};

type UseAgentProductOptions = {
  accountEnabled: boolean;
  closePanel: () => void;
  projects: readonly Project[];
  refreshTasksAndProjects: () => Promise<void>;
  selectedProjectId?: string;
  timeZone: string;
  userId?: string;
};

type UseAgentProductResult = {
  openTextInput: () => void;
  openVoiceDeferred: () => void;
  panels: ReactNode;
  smartInbox: SmartInboxCardModel;
};

const QUOTA_CODES = new Set(['AGENT_DAILY_QUOTA_EXHAUSTED', 'AGENT_POINTS_INSUFFICIENT']);
const SERVICE_CODES = new Set([
  'AGENT_CAPABILITY_DISABLED',
  'AGENT_REQUEST_EXPIRED',
  'AGENT_RESULT_UNAVAILABLE',
  'AGENT_SERVICE_UNAVAILABLE',
]);

function preferenceKey(userId: string): string {
  return `ai-schedule:smart-inbox-collapsed:${userId}`;
}

function safeStoredPreference(userId: string): boolean {
  try {
    return Taro.getStorageSync(preferenceKey(userId)) === true;
  } catch {
    return false;
  }
}

function saveStoredPreference(userId: string, collapsed: boolean): void {
  try {
    Taro.setStorageSync(preferenceKey(userId), collapsed);
  } catch {
    // Preference persistence is best effort and must never block product actions.
  }
}

function usePageVisibility(): boolean {
  const [visible, setVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState === 'visible',
  );
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const update = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}

function showAgentFailure(error: unknown): void {
  void Taro.showToast({
    duration: 2_400,
    icon: 'none',
    title: error instanceof ApiRequestError ? error.message : '操作失败，请稍后重试',
  });
}

function shouldOpenUnavailable(error: unknown): boolean {
  if (!(error instanceof ApiRequestError)) return true;
  return error.status >= 500 || QUOTA_CODES.has(error.code) || SERVICE_CODES.has(error.code);
}

function proposalKind(proposal: PublicActionProposal): 'ACTION' | 'PLAN' {
  return proposal.actionCode === 'CREATE_PROJECT_TASKS' ? 'PLAN' : 'ACTION';
}

function latestAssistantMessageId(
  items: readonly { id: string; role: 'ASSISTANT' | 'SYSTEM' | 'USER' }[],
): string | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.role === 'ASSISTANT') return item.id;
  }
  return null;
}

export function useAgentProduct({
  accountEnabled,
  closePanel,
  projects,
  refreshTasksAndProjects,
  selectedProjectId,
  timeZone,
  userId,
}: UseAgentProductOptions): UseAgentProductResult {
  const { dispatch, state } = useAppState();
  const [draft, setDraft] = useState('');
  const [writeIntents] = useState(() => new WriteIntentRegistry());
  const [pollStartedAt, setPollStartedAt] = useState(Date.now());
  const visible = usePageVisibility();
  const loadedPreferenceUser = useRef<string | null>(null);
  const processedRequests = useRef(new Set<string>());
  const processedRequestErrors = useRef(new Set<string>());
  const latestProposal = useRef<PublicActionProposal | null>(null);
  const previousProposalPanelId = useRef<string | null>(null);
  const proposalExitHandled = useRef(false);
  const viewedMessages = useRef(new Set<string>());

  const conversationPanel = state.panel?.type === 'agentConversation' ? state.panel : undefined;
  const proposalPanel = state.panel?.type === 'agentProposal' ? state.panel : undefined;
  const requestId = conversationPanel?.requestId;

  useEffect(() => {
    if (!userId || loadedPreferenceUser.current === userId) return;
    loadedPreferenceUser.current = userId;
    dispatch({
      collapsed: safeStoredPreference(userId),
      type: 'SET_SMART_INBOX_COLLAPSED',
    });
  }, [dispatch, userId]);

  useEffect(() => {
    if (requestId) setPollStartedAt(Date.now());
  }, [requestId]);

  const smartInboxQuery = useQuery({
    enabled: accountEnabled && Boolean(userId),
    queryFn: () =>
      scheduleApi.getSmartInbox(selectedProjectId ? { projectId: selectedProjectId } : {}),
    queryKey: ['agent', 'smart-inbox', userId ?? 'guest', selectedProjectId ?? 'all'],
  });
  const messagesQuery = useQuery({
    enabled: accountEnabled && Boolean(conversationPanel?.conversationId),
    queryFn: () =>
      scheduleApi.listConversationMessages(conversationPanel?.conversationId ?? '', { limit: 100 }),
    queryKey: ['agent', 'messages', conversationPanel?.conversationId ?? 'closed'],
  });
  const proposalQuery = useQuery({
    enabled: accountEnabled && Boolean(proposalPanel?.proposalId),
    queryFn: () => scheduleApi.getActionProposal(proposalPanel?.proposalId ?? ''),
    queryKey: ['agent', 'proposal', proposalPanel?.proposalId ?? 'closed'],
  });
  const requestQuery = useQuery({
    enabled: accountEnabled && Boolean(requestId),
    queryFn: () => scheduleApi.getAgentRequest(requestId ?? ''),
    queryKey: ['agent', 'request', requestId ?? 'closed'],
    refetchInterval: (query) => {
      const response = query.state.data;
      return agentPollingInterval({
        elapsedMs: Date.now() - pollStartedAt,
        pageVisible: visible,
        terminal: response ? isAgentRequestTerminal(response.status) : false,
      });
    },
    refetchIntervalInBackground: false,
    retry: false,
    staleTime: 0,
  });

  if (proposalQuery.data?.proposal) latestProposal.current = proposalQuery.data.proposal;

  const submitTextMutation = useMutation<
    AgentTurnQueuedResponse | MessageAnswerResponse,
    Error,
    {
      idempotencyKey: string;
      panel: Extract<AppPanel, { type: 'agentTextInput' }>;
      text: string;
    }
  >({
    mutationFn: ({
      panel,
      text,
      idempotencyKey,
    }: {
      idempotencyKey: string;
      panel: Extract<AppPanel, { type: 'agentTextInput' }>;
      text: string;
    }) => {
      if (panel.replyToMessageId && panel.replyToVersion && panel.conversationId) {
        return scheduleApi.answerConversationMessage(
          panel.conversationId,
          panel.replyToMessageId,
          { answer: { text, type: 'TEXT' }, version: panel.replyToVersion },
          idempotencyKey,
        );
      }
      return scheduleApi.createAgentTurn(
        {
          ...(panel.conversationId ? { conversationId: panel.conversationId } : {}),
          input: { mode: 'TEXT', text },
        },
        idempotencyKey,
      );
    },
  });
  const answerMutation = useMutation({
    mutationFn: ({
      conversationId,
      idempotencyKey,
      messageId,
      optionId,
      version,
    }: {
      conversationId: string;
      idempotencyKey: string;
      messageId: string;
      optionId: string;
      version: number;
    }) =>
      scheduleApi.answerConversationMessage(
        conversationId,
        messageId,
        { answer: { optionId, type: 'OPTION' }, version },
        idempotencyKey,
      ),
  });
  const planMutation = useMutation({
    mutationFn: ({
      idempotencyKey,
      source,
    }: {
      idempotencyKey: string;
      source:
        | { messageId: string; type: 'MESSAGE'; version: number }
        | { proposalId: string; type: 'PROPOSAL'; version: number };
    }) => scheduleApi.createPlanGeneration({ source }, idempotencyKey),
  });
  const organizeMutation = useMutation({
    mutationFn: ({ idempotencyKey, item }: { idempotencyKey: string; item: SmartInboxItem }) => {
      if (item.action.type !== 'ORGANIZE_TASKS') throw new Error('Smart Inbox 动作已变化');
      return scheduleApi.organizeSmartInbox({ scope: item.action.scope }, idempotencyKey);
    },
  });
  const proposalEditMutation = useMutation({
    mutationFn: ({
      command,
      idempotencyKey,
      proposal,
    }: {
      command:
        | {
            changes: ReturnType<typeof createTaskDraftChanges>;
            mutationId: string;
            type: 'UPDATE_TASK_DRAFT';
          }
        | { mutationId: string; type: 'REMOVE_MUTATION' };
      idempotencyKey: string;
      proposal: PublicActionProposal;
    }) =>
      scheduleApi.editActionProposal(
        proposal.id,
        { command, version: proposal.version },
        idempotencyKey,
      ),
  });
  const proposalDismissMutation = useMutation({
    mutationFn: ({
      idempotencyKey,
      proposal,
    }: {
      idempotencyKey: string;
      proposal: PublicActionProposal;
    }) =>
      scheduleApi.dismissActionProposal(proposal.id, { version: proposal.version }, idempotencyKey),
  });
  const proposalCancelMutation = useMutation({
    mutationFn: ({
      idempotencyKey,
      proposal,
    }: {
      idempotencyKey: string;
      proposal: PublicActionProposal;
    }) =>
      scheduleApi.cancelActionProposal(proposal.id, { version: proposal.version }, idempotencyKey),
  });
  const proposalConfirmMutation = useMutation({
    mutationFn: ({
      idempotencyKey,
      proposal,
    }: {
      idempotencyKey: string;
      proposal: PublicActionProposal;
    }) =>
      scheduleApi.confirmActionProposal(proposal.id, { version: proposal.version }, idempotencyKey),
  });

  const invalidateAgentState = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['agent', 'messages'] }),
      queryClient.invalidateQueries({ queryKey: ['agent', 'smart-inbox'] }),
    ]);
  }, []);

  const openQueuedRequest = useCallback(
    (request: { conversationId: string; requestId: string }) => {
      void queryClient.invalidateQueries({ queryKey: ['agent', 'smart-inbox'] });
      dispatch({
        conversationId: request.conversationId,
        requestId: request.requestId,
        type: 'OPEN_AGENT_CONVERSATION',
      });
    },
    [dispatch],
  );

  const handleAgentError = useCallback(
    (error: unknown) => {
      if (shouldOpenUnavailable(error)) {
        dispatch({ reason: agentUnavailableReason(error), type: 'OPEN_AGENT_UNAVAILABLE' });
      } else {
        showAgentFailure(error);
      }
    },
    [dispatch],
  );

  const handleAnswerResponse = useCallback(
    async (response: MessageAnswerResponse, conversationId: string) => {
      await invalidateAgentState();
      if (response.outcome === 'QUEUED') {
        openQueuedRequest(response.request);
        return;
      }
      if (response.proposal) {
        queryClient.setQueryData(['agent', 'proposal', response.proposal.id], {
          proposal: response.proposal,
        });
        dispatch({
          presentation: proposalKind(response.proposal),
          proposalId: response.proposal.id,
          type: 'OPEN_AGENT_PROPOSAL',
        });
        return;
      }
      dispatch({ conversationId, type: 'OPEN_AGENT_CONVERSATION' });
    },
    [dispatch, invalidateAgentState, openQueuedRequest],
  );

  useEffect(() => {
    const response = requestQuery.data;
    if (!response || !isAgentRequestTerminal(response.status)) return;
    if (processedRequests.current.has(response.requestId)) return;
    processedRequests.current.add(response.requestId);

    if (response.status === 'FAILED' || response.status === 'RELEASED') {
      dispatch({
        reason: agentUnavailableReason(response.failure),
        type: 'OPEN_AGENT_UNAVAILABLE',
      });
      void queryClient.invalidateQueries({ queryKey: ['agent', 'smart-inbox'] });
      return;
    }

    if (response.status !== 'SUCCEEDED') return;

    void invalidateAgentState();
    if (response.result.type === 'PLAN' || response.result.type === 'ACTION_PROPOSAL') {
      const proposal = response.result.proposal;
      queryClient.setQueryData(['agent', 'proposal', proposal.id], { proposal });
      dispatch({
        presentation: proposalKind(proposal),
        proposalId: proposal.id,
        type: 'OPEN_AGENT_PROPOSAL',
      });
      return;
    }
    dispatch({ conversationId: response.conversationId, type: 'OPEN_AGENT_CONVERSATION' });
  }, [dispatch, invalidateAgentState, requestQuery.data]);

  useEffect(() => {
    if (!requestId || !requestQuery.isError || processedRequestErrors.current.has(requestId)) {
      return;
    }
    processedRequestErrors.current.add(requestId);
    dispatch({ reason: 'SERVICE', type: 'OPEN_AGENT_UNAVAILABLE' });
    void queryClient.invalidateQueries({ queryKey: ['agent', 'smart-inbox'] });
  }, [dispatch, requestId, requestQuery.isError]);

  useEffect(() => {
    const currentId = proposalPanel?.proposalId ?? null;
    const previousId = previousProposalPanelId.current;
    if (currentId) {
      if (currentId !== previousId) proposalExitHandled.current = false;
      previousProposalPanelId.current = currentId;
      return;
    }
    if (!previousId) return;
    previousProposalPanelId.current = null;
    const proposal = latestProposal.current;
    if (
      proposalExitHandled.current ||
      !proposal ||
      proposal.id !== previousId ||
      !['DRAFT', 'AWAITING_CONFIRMATION', 'FAILED'].includes(proposal.status)
    ) {
      return;
    }
    proposalExitHandled.current = true;
    const intent = {
      operation: 'AGENT_PROPOSAL_DISMISS',
      proposalId: proposal.id,
      version: proposal.version,
    };
    void scheduleApi
      .dismissActionProposal(
        proposal.id,
        { version: proposal.version },
        writeIntents.keyFor(intent),
      )
      .then(() => {
        writeIntents.complete(intent);
        return queryClient.invalidateQueries({ queryKey: ['agent', 'smart-inbox'] });
      })
      .catch(() => undefined);
  }, [proposalPanel?.proposalId, writeIntents]);

  useEffect(() => {
    const conversationId = conversationPanel?.conversationId;
    const lastViewedMessageId = messagesQuery.data
      ? latestAssistantMessageId(messagesQuery.data.items)
      : null;
    if (
      !conversationId ||
      !lastViewedMessageId ||
      viewedMessages.current.has(lastViewedMessageId)
    ) {
      return;
    }
    viewedMessages.current.add(lastViewedMessageId);
    const intent = {
      conversationId,
      lastViewedMessageId,
      operation: 'AGENT_CONVERSATION_VIEWED',
    };
    void scheduleApi
      .markConversationViewed(conversationId, { lastViewedMessageId }, writeIntents.keyFor(intent))
      .then(() => {
        writeIntents.complete(intent);
        return queryClient.invalidateQueries({ queryKey: ['agent', 'smart-inbox'] });
      })
      .catch(() => viewedMessages.current.delete(lastViewedMessageId));
  }, [conversationPanel?.conversationId, messagesQuery.data, writeIntents]);

  const submitText = useCallback(async () => {
    const panel = state.panel;
    const text = draft.trim();
    if (panel?.type !== 'agentTextInput' || !text) return;
    const intent = { operation: 'AGENT_TEXT_SUBMIT', panel, text };
    try {
      const response = await submitTextMutation.mutateAsync({
        idempotencyKey: writeIntents.keyFor(intent),
        panel,
        text,
      });
      writeIntents.complete(intent);
      setDraft('');
      if ('outcome' in response) {
        await handleAnswerResponse(response, panel.conversationId ?? '');
      } else {
        openQueuedRequest(response);
      }
    } catch (error) {
      handleAgentError(error);
    }
  }, [
    draft,
    handleAgentError,
    handleAnswerResponse,
    openQueuedRequest,
    state.panel,
    submitTextMutation,
    writeIntents,
  ]);

  const answerOption = useCallback(
    async (messageId: string, version: number, optionId: string) => {
      const conversationId = conversationPanel?.conversationId;
      if (!conversationId || version < 1) return;
      const intent = {
        conversationId,
        messageId,
        operation: 'AGENT_ANSWER_OPTION',
        optionId,
        version,
      };
      try {
        const response = await answerMutation.mutateAsync({
          conversationId,
          idempotencyKey: writeIntents.keyFor(intent),
          messageId,
          optionId,
          version,
        });
        writeIntents.complete(intent);
        await handleAnswerResponse(response, conversationId);
      } catch (error) {
        handleAgentError(error);
        void messagesQuery.refetch();
      }
    },
    [
      answerMutation,
      conversationPanel?.conversationId,
      handleAgentError,
      handleAnswerResponse,
      messagesQuery,
      writeIntents,
    ],
  );

  const generatePlanFromMessage = useCallback(
    async (messageId: string, version: number) => {
      if (version < 1) return;
      const source = { messageId, type: 'MESSAGE' as const, version };
      const intent = { operation: 'AGENT_PLAN_GENERATE', source };
      try {
        const response = await planMutation.mutateAsync({
          idempotencyKey: writeIntents.keyFor(intent),
          source,
        });
        writeIntents.complete(intent);
        openQueuedRequest(response);
      } catch (error) {
        handleAgentError(error);
      }
    },
    [handleAgentError, openQueuedRequest, planMutation, writeIntents],
  );

  const updateProposalCache = useCallback((proposal: PublicActionProposal) => {
    queryClient.setQueryData(['agent', 'proposal', proposal.id], { proposal });
  }, []);

  const editProposal = useCallback(
    async (
      proposal: PublicActionProposal,
      command:
        | {
            changes: ReturnType<typeof createTaskDraftChanges>;
            mutationId: string;
            type: 'UPDATE_TASK_DRAFT';
          }
        | { mutationId: string; type: 'REMOVE_MUTATION' },
    ) => {
      const intent = {
        command,
        operation: 'AGENT_PROPOSAL_EDIT',
        proposalId: proposal.id,
        version: proposal.version,
      };
      try {
        const response = await proposalEditMutation.mutateAsync({
          command,
          idempotencyKey: writeIntents.keyFor(intent),
          proposal,
        });
        writeIntents.complete(intent);
        updateProposalCache(response.proposal);
        await queryClient.invalidateQueries({ queryKey: ['agent', 'smart-inbox'] });
      } catch (error) {
        showAgentFailure(error);
        void proposalQuery.refetch();
        throw error;
      }
    },
    [proposalEditMutation, proposalQuery, updateProposalCache, writeIntents],
  );

  const closeProposal = useCallback(async () => {
    const proposal = proposalQuery.data?.proposal;
    if (proposal && ['DRAFT', 'AWAITING_CONFIRMATION', 'FAILED'].includes(proposal.status)) {
      const intent = {
        operation: 'AGENT_PROPOSAL_DISMISS',
        proposalId: proposal.id,
        version: proposal.version,
      };
      try {
        const response = await proposalDismissMutation.mutateAsync({
          idempotencyKey: writeIntents.keyFor(intent),
          proposal,
        });
        writeIntents.complete(intent);
        updateProposalCache(response.proposal);
        void queryClient.invalidateQueries({ queryKey: ['agent', 'smart-inbox'] });
      } catch (error) {
        showAgentFailure(error);
      }
    }
    proposalExitHandled.current = true;
    closePanel();
  }, [
    closePanel,
    proposalDismissMutation,
    proposalQuery.data?.proposal,
    updateProposalCache,
    writeIntents,
  ]);

  const cancelProposal = useCallback(async () => {
    const proposal = proposalQuery.data?.proposal;
    if (!proposal) return;
    const intent = {
      operation: 'AGENT_PROPOSAL_CANCEL',
      proposalId: proposal.id,
      version: proposal.version,
    };
    try {
      const response = await proposalCancelMutation.mutateAsync({
        idempotencyKey: writeIntents.keyFor(intent),
        proposal,
      });
      writeIntents.complete(intent);
      updateProposalCache(response.proposal);
      await queryClient.invalidateQueries({ queryKey: ['agent', 'smart-inbox'] });
      proposalExitHandled.current = true;
      closePanel();
    } catch (error) {
      showAgentFailure(error);
      void proposalQuery.refetch();
    }
  }, [closePanel, proposalCancelMutation, proposalQuery, updateProposalCache, writeIntents]);

  const confirmProposal = useCallback(async () => {
    const proposal = proposalQuery.data?.proposal;
    if (!proposal) return;
    const intent = {
      operation: 'AGENT_PROPOSAL_CONFIRM',
      proposalId: proposal.id,
      version: proposal.version,
    };
    try {
      const response = await proposalConfirmMutation.mutateAsync({
        idempotencyKey: writeIntents.keyFor(intent),
        proposal,
      });
      writeIntents.complete(intent);
      updateProposalCache(response.proposal);
      if (response.outcome === 'FAILED') {
        showAgentFailure(new Error(response.execution.error.message));
        return;
      }
      if (response.execution.result.undoOperationId && response.execution.result.undoExpiresAt) {
        dispatch({
          receipt: {
            expiresAt: response.execution.result.undoExpiresAt,
            operationId: response.execution.result.undoOperationId,
            taskTitle: proposal.title,
          },
          type: 'SHOW_DELETE_UNDO',
        });
      }
      await Promise.all([refreshTasksAndProjects(), invalidateAgentState()]);
      proposalExitHandled.current = true;
      closePanel();
    } catch (error) {
      showAgentFailure(error);
      void proposalQuery.refetch();
    }
  }, [
    closePanel,
    dispatch,
    invalidateAgentState,
    proposalConfirmMutation,
    proposalQuery,
    refreshTasksAndProjects,
    updateProposalCache,
    writeIntents,
  ]);

  const regeneratePlan = useCallback(async () => {
    const proposal = proposalQuery.data?.proposal;
    if (!proposal) return;
    const source = {
      proposalId: proposal.id,
      type: 'PROPOSAL' as const,
      version: proposal.version,
    };
    const intent = { operation: 'AGENT_PLAN_REGENERATE', source };
    try {
      const response = await planMutation.mutateAsync({
        idempotencyKey: writeIntents.keyFor(intent),
        source,
      });
      writeIntents.complete(intent);
      proposalExitHandled.current = true;
      openQueuedRequest(response);
    } catch (error) {
      handleAgentError(error);
    }
  }, [
    handleAgentError,
    openQueuedRequest,
    planMutation,
    proposalQuery.data?.proposal,
    writeIntents,
  ]);

  const handleSmartInboxAction = useCallback(async () => {
    const item = smartInboxQuery.data?.item;
    if (!item) {
      void smartInboxQuery.refetch();
      return;
    }
    switch (item.action.type) {
      case 'CREATE_TASK':
        dispatch({ type: 'OPEN_CREATE_TASK' });
        return;
      case 'START_AGENT':
        dispatch({ type: 'OPEN_AGENT_TEXT' });
        return;
      case 'RESUME_CONVERSATION':
        if (item.action.proposalId) {
          dispatch({
            presentation: 'ACTION',
            proposalId: item.action.proposalId,
            type: 'OPEN_AGENT_PROPOSAL',
          });
          return;
        }
        dispatch({
          conversationId: item.action.conversationId,
          ...(item.action.messageId ? { focusMessageId: item.action.messageId } : {}),
          ...(item.action.requestId ? { requestId: item.action.requestId } : {}),
          type: 'OPEN_AGENT_CONVERSATION',
        });
        return;
      case 'ORGANIZE_TASKS': {
        const intent = { operation: 'SMART_INBOX_ORGANIZE', scope: item.action.scope };
        try {
          const response = await organizeMutation.mutateAsync({
            idempotencyKey: writeIntents.keyFor(intent),
            item,
          });
          writeIntents.complete(intent);
          openQueuedRequest(response);
        } catch (error) {
          handleAgentError(error);
        }
      }
    }
  }, [
    dispatch,
    handleAgentError,
    openQueuedRequest,
    organizeMutation,
    smartInboxQuery,
    writeIntents,
  ]);

  const smartInbox = useMemo<SmartInboxCardModel>(() => {
    const collapsed = state.smartInboxCollapsed;
    const onToggleCollapsed = () => {
      const next = !collapsed;
      dispatch({ collapsed: next, type: 'SET_SMART_INBOX_COLLAPSED' });
      if (userId) saveStoredPreference(userId, next);
    };
    if (smartInboxQuery.isPending) {
      return {
        actionAriaLabel: '正在读取 Smart Inbox',
        actionLabel: '读取中',
        body: '正在检查需要你处理的智能事项…',
        collapsed,
        onAction: () => undefined,
        onToggleCollapsed,
      };
    }
    if (smartInboxQuery.isError || !smartInboxQuery.data) {
      return {
        actionAriaLabel: '重试读取 Smart Inbox',
        actionLabel: '重试',
        body: '智能处理暂不可用，手工待办不受影响。',
        collapsed,
        onAction: () => void smartInboxQuery.refetch(),
        onToggleCollapsed,
      };
    }
    const presentation = presentSmartInboxItem(smartInboxQuery.data.item);
    return {
      ...presentation,
      collapsed,
      onAction: () => void handleSmartInboxAction(),
      onToggleCollapsed,
    };
  }, [
    dispatch,
    handleSmartInboxAction,
    smartInboxQuery.data,
    smartInboxQuery.isError,
    smartInboxQuery.isPending,
    smartInboxQuery.refetch,
    state.smartInboxCollapsed,
    userId,
  ]);

  const proposal = proposalQuery.data?.proposal;
  const proposalPresentation = proposal
    ? actionProposalPresentation(proposal, projects, timeZone)
    : null;
  const agentPending =
    Boolean(requestId) && (!requestQuery.data || !isAgentRequestTerminal(requestQuery.data.status));
  const interactionPending =
    agentPending ||
    answerMutation.isPending ||
    planMutation.isPending ||
    submitTextMutation.isPending;
  const proposalPending =
    proposalEditMutation.isPending ||
    proposalDismissMutation.isPending ||
    proposalCancelMutation.isPending ||
    proposalConfirmMutation.isPending ||
    planMutation.isPending;

  let panels: ReactNode = null;
  if (state.panel?.type === 'agentTextInput') {
    panels = (
      <AgentTextInputSheet
        disabled={submitTextMutation.isPending}
        onChange={setDraft}
        onClose={closePanel}
        onSubmit={() => void submitText()}
        value={draft}
      />
    );
  } else if (state.panel?.type === 'agentConversation') {
    const activeConversationId = state.panel.conversationId;
    panels = (
      <AgentConversationDialog
        {...(messagesQuery.isError
          ? {
              errorMessage: '暂时无法读取对话，你可以稍后重试。',
              onRetry: () => void messagesQuery.refetch(),
            }
          : {})}
        messages={presentAgentMessages(messagesQuery.data?.items ?? [])}
        {...(state.panel.focusMessageId ? { focusMessageId: state.panel.focusMessageId } : {})}
        onAnswer={(messageId, version, optionId) => void answerOption(messageId, version, optionId)}
        onClose={closePanel}
        onContinue={() =>
          dispatch({
            conversationId: activeConversationId,
            type: 'OPEN_AGENT_TEXT',
          })
        }
        onFreeText={(messageId, version) =>
          dispatch({
            conversationId: activeConversationId,
            replyToMessageId: messageId,
            replyToVersion: version,
            type: 'OPEN_AGENT_TEXT',
          })
        }
        onGeneratePlan={(messageId, version) => void generatePlanFromMessage(messageId, version)}
        onOpenProposal={(proposalId) =>
          dispatch({ presentation: 'ACTION', proposalId, type: 'OPEN_AGENT_PROPOSAL' })
        }
        pending={interactionPending}
      />
    );
  } else if (state.panel?.type === 'agentProposal') {
    if (proposalPresentation && proposal) {
      panels = (
        <AgentProposalSheet
          disabled={proposalPending}
          kind={proposalKind(proposal)}
          onCancel={() => void cancelProposal()}
          onClose={() => void closeProposal()}
          onConfirm={() => void confirmProposal()}
          onRegenerate={() => void regeneratePlan()}
          onRemoveItem={(mutationId) =>
            editProposal(proposal, { mutationId, type: 'REMOVE_MUTATION' })
          }
          onSaveItem={(item: AgentProposalDraftItem) =>
            editProposal(proposal, {
              changes: createTaskDraftChanges(item, timeZone),
              mutationId: item.id,
              type: 'UPDATE_TASK_DRAFT',
            })
          }
          proposal={proposalPresentation}
          projects={projects}
          timeZone={timeZone}
        />
      );
    } else {
      panels = (
        <BottomSheet
          description={proposalQuery.isError ? '该草稿可能已变化，请重试。' : '正在读取最新草稿。'}
          title="Agent 操作草稿"
        >
          <Text className="inlineStatus">
            {proposalQuery.isError ? '暂时无法读取草稿' : '加载中…'}
          </Text>
          <ElectricButton
            ariaLabel={proposalQuery.isError ? '重试读取 Agent 草稿' : '关闭 Agent 草稿'}
            onClick={proposalQuery.isError ? () => void proposalQuery.refetch() : closePanel}
            variant="secondary"
          >
            {proposalQuery.isError ? '重试' : '关闭'}
          </ElectricButton>
        </BottomSheet>
      );
    }
  } else if (state.panel?.type === 'agentUnavailable') {
    panels = <AgentUnavailableSheet onClose={closePanel} reason={state.panel.reason} />;
  }

  return {
    openTextInput: () => dispatch({ type: 'OPEN_AGENT_TEXT' }),
    openVoiceDeferred: () => dispatch({ reason: 'VOICE_DEFERRED', type: 'OPEN_AGENT_UNAVAILABLE' }),
    panels,
    smartInbox,
  };
}
