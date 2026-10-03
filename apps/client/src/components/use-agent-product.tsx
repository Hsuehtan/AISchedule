import type {
  AgentTurnQueuedResponse,
  MessageAnswerResponse,
  Project,
  PublicActionProposal,
  SmartInboxItem,
} from '@ai-schedule/contracts';
import { BottomSheet, ElectricButton, UndoToast } from '@ai-schedule/ui';
import { useMutation, useQueries, useQuery } from '@tanstack/react-query';
import { Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { agentPollingInterval } from '../agent-polling';
import { presentActionCard } from '../action-card-presentation';
import { presentAgentMessages } from '../agent-presentation';
import {
  actionProposalPresentation,
  agentUnavailableReason,
  createTaskDraftChanges,
  isAgentRequestTerminal,
  type AgentProposalDraftItem,
} from '../agent-product-model';
import { ApiRequestError } from '../api-client';
import { useAppState } from '../app-state-context';
import type { DeleteUndoReceipt } from '../app-state';
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
  onUndo: () => void;
  selectedProjectId?: string;
  timeZone: string;
  undoPending: boolean;
  undoReceipt: DeleteUndoReceipt | null;
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
const conversationDraftMemory = new Map<string, string>();

export function clearConversationDraftMemory(): void {
  conversationDraftMemory.clear();
}

function conversationDraftKey(userId: string | undefined, conversationId: string): string {
  return `${userId ?? 'guest'}:${conversationId}`;
}

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
  return proposal.presentation;
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
  onUndo,
  selectedProjectId,
  timeZone,
  undoPending,
  undoReceipt,
  userId,
}: UseAgentProductOptions): UseAgentProductResult {
  const { dispatch, state } = useAppState();
  const [draft, setDraft] = useState('');
  const [conversationDrafts, setConversationDrafts] = useState<Record<string, string>>({});
  const [scrollToLatest, setScrollToLatest] = useState(0);
  const submitLock = useRef(false);
  const [submitPending, setSubmitPending] = useState(false);
  const replyTarget = useRef<Record<string, string>>({});
  const currentPanel = useRef(state.panel);
  currentPanel.current = state.panel;
  const [writeIntents] = useState(() => new WriteIntentRegistry());
  const [pollStartedAt, setPollStartedAt] = useState(Date.now());
  const visible = usePageVisibility();
  const loadedPreferenceUser = useRef<string | null>(null);
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
    refetchInterval: (query) =>
      visible && query.state.data?.item.kind === 'PROCESSING' ? 2_000 : false,
    refetchIntervalInBackground: false,
  });
  const messagesQuery = useQuery({
    enabled: accountEnabled && Boolean(conversationPanel?.conversationId),
    queryFn: () =>
      scheduleApi.listConversationMessages(conversationPanel?.conversationId ?? '', { limit: 100 }),
    queryKey: ['agent', 'messages', conversationPanel?.conversationId ?? 'closed'],
  });
  const conversationProposalIds = useMemo(
    () => [
      ...new Set(
        (messagesQuery.data?.items ?? []).flatMap((message) =>
          message.proposalId ? [String(message.proposalId)] : [],
        ),
      ),
    ],
    [messagesQuery.data?.items],
  );
  const conversationProposalQueries = useQueries({
    queries: conversationProposalIds.map((proposalId) => ({
      enabled: accountEnabled && Boolean(conversationPanel),
      queryFn: () => scheduleApi.getActionProposal(proposalId),
      queryKey: ['agent', 'proposal', proposalId],
    })),
  });
  const conversationProposals = Object.fromEntries(
    conversationProposalIds.flatMap((id, index) => {
      const proposal = conversationProposalQueries[index]?.data?.proposal;
      return proposal ? [[id, proposal] as const] : [];
    }),
  ) as Record<string, PublicActionProposal>;
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
      target: {
        conversationId?: string;
        replyToMessageId?: string;
        replyToVersion?: number;
      };
      text: string;
    }
  >({
    mutationFn: ({
      target,
      text,
      idempotencyKey,
    }: {
      idempotencyKey: string;
      target: {
        conversationId?: string;
        replyToMessageId?: string;
        replyToVersion?: number;
      };
      text: string;
    }) => {
      if (target.replyToMessageId && target.replyToVersion && target.conversationId) {
        return scheduleApi.answerConversationMessage(
          target.conversationId,
          target.replyToMessageId,
          { answer: { text, type: 'TEXT' }, version: target.replyToVersion },
          idempotencyKey,
        );
      }
      return scheduleApi.createAgentTurn(
        {
          ...(target.conversationId ? { conversationId: target.conversationId } : {}),
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
      queryClient.invalidateQueries({ queryKey: ['agent', 'proposal'] }),
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
      const visiblePanel = currentPanel.current;
      if (
        !visiblePanel ||
        (visiblePanel.type !== 'agentConversation' && visiblePanel.type !== 'agentTextInput') ||
        (visiblePanel.type === 'agentConversation' &&
          visiblePanel.conversationId !== conversationId)
      ) {
        await invalidateAgentState();
        return;
      }
      if (response.outcome === 'QUEUED') {
        openQueuedRequest(response.request);
        void invalidateAgentState();
        return;
      }
      await invalidateAgentState();
      const latestPanel = currentPanel.current;
      if (
        !latestPanel ||
        (latestPanel.type !== 'agentConversation' && latestPanel.type !== 'agentTextInput') ||
        (latestPanel.type === 'agentConversation' && latestPanel.conversationId !== conversationId)
      ) {
        return;
      }
      if (response.proposal) {
        queryClient.setQueryData(['agent', 'proposal', response.proposal.id], {
          proposal: response.proposal,
        });
        if (proposalKind(response.proposal) === 'PLAN') {
          dispatch({
            presentation: 'PLAN',
            proposalId: response.proposal.id,
            type: 'OPEN_AGENT_PROPOSAL',
          });
        } else {
          dispatch({ conversationId, type: 'OPEN_AGENT_CONVERSATION' });
        }
        return;
      }
      dispatch({ conversationId, type: 'OPEN_AGENT_CONVERSATION' });
    },
    [dispatch, invalidateAgentState, openQueuedRequest],
  );

  useEffect(() => {
    const response = requestQuery.data;
    if (!response || !isAgentRequestTerminal(response.status) || !requestId) return;
    if (
      currentPanel.current?.type !== 'agentConversation' ||
      currentPanel.current.requestId !== response.requestId
    )
      return;

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
      if (proposalKind(proposal) === 'PLAN') {
        dispatch({ presentation: 'PLAN', proposalId: proposal.id, type: 'OPEN_AGENT_PROPOSAL' });
      } else {
        dispatch({ conversationId: response.conversationId, type: 'OPEN_AGENT_CONVERSATION' });
      }
      return;
    }
    dispatch({ conversationId: response.conversationId, type: 'OPEN_AGENT_CONVERSATION' });
  }, [dispatch, invalidateAgentState, requestId, requestQuery.data]);

  useEffect(() => {
    if (
      !requestId ||
      !requestQuery.isError ||
      (requestQuery.data && isAgentRequestTerminal(requestQuery.data.status))
    ) {
      return;
    }
    dispatch({ reason: 'SERVICE', type: 'OPEN_AGENT_UNAVAILABLE' });
    void queryClient.invalidateQueries({ queryKey: ['agent', 'smart-inbox'] });
  }, [dispatch, requestId, requestQuery.isError, requestQuery.data]);

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
      submitLock.current ||
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

  const agentPending =
    Boolean(requestId) && (!requestQuery.data || !isAgentRequestTerminal(requestQuery.data.status));
  const interactionPending =
    submitPending ||
    agentPending ||
    answerMutation.isPending ||
    planMutation.isPending ||
    submitTextMutation.isPending ||
    proposalCancelMutation.isPending ||
    proposalConfirmMutation.isPending ||
    proposalEditMutation.isPending;

  const submitText = useCallback(async () => {
    const panel = state.panel;
    const text = draft.trim();
    if (panel?.type !== 'agentTextInput' || !text || submitLock.current) return;
    submitLock.current = true;
    setSubmitPending(true);
    const intent = { operation: 'AGENT_TEXT_SUBMIT', panel, text };
    try {
      const response = await submitTextMutation.mutateAsync({
        idempotencyKey: writeIntents.keyFor(intent),
        target: panel,
        text,
      });
      writeIntents.complete(intent);
      setDraft((current) => (current === draft ? '' : current));
      if (currentPanel.current?.type !== 'agentTextInput') {
        await invalidateAgentState();
      } else if ('outcome' in response) {
        await handleAnswerResponse(response, panel.conversationId ?? '');
      } else {
        openQueuedRequest(response);
      }
    } catch (error) {
      handleAgentError(error);
    } finally {
      submitLock.current = false;
      setSubmitPending(false);
    }
  }, [
    draft,
    handleAgentError,
    handleAnswerResponse,
    invalidateAgentState,
    openQueuedRequest,
    state.panel,
    submitTextMutation,
    writeIntents,
  ]);

  const submitConversationText = useCallback(async () => {
    const panel = state.panel;
    if (panel?.type !== 'agentConversation' || interactionPending || submitLock.current) return;
    const memoryKey = conversationDraftKey(userId, panel.conversationId);
    const draftAtSubmit =
      conversationDrafts[panel.conversationId] ?? conversationDraftMemory.get(memoryKey) ?? '';
    const text = draftAtSubmit.trim();
    if (!text) return;
    const pendingQuestion = presentAgentMessages(messagesQuery.data?.items ?? [])
      .slice()
      .reverse()
      .find(
        (message) =>
          message.role === 'QUESTION' && message.allowFreeText && !message.answerDisabled,
      );
    const actionId = pendingQuestion
      ? undefined
      : (replyTarget.current[panel.conversationId] ??
        [...(messagesQuery.data?.items ?? [])]
          .reverse()
          .find(
            (message) =>
              message.proposalId &&
              conversationProposals[message.proposalId]?.presentation === 'ACTION' &&
              conversationProposals[message.proposalId]?.status === 'AWAITING_CONFIRMATION',
          )?.proposalId);
    const action = actionId ? conversationProposals[actionId] : undefined;
    if (actionId) replyTarget.current[panel.conversationId] = actionId;
    const target = {
      conversationId: panel.conversationId,
      ...(pendingQuestion?.version
        ? { replyToMessageId: pendingQuestion.id, replyToVersion: pendingQuestion.version }
        : {}),
    };
    const intent = { operation: 'AGENT_TEXT_SUBMIT', target, text };
    submitLock.current = true;
    setSubmitPending(true);
    try {
      if (action?.status === 'AWAITING_CONFIRMATION') {
        const cancelIntent = {
          operation: 'AGENT_PROPOSAL_CANCEL',
          proposalId: action.id,
          version: action.version,
        };
        try {
          const cancelled = await proposalCancelMutation.mutateAsync({
            idempotencyKey: writeIntents.keyFor(cancelIntent),
            proposal: action,
          });
          writeIntents.complete(cancelIntent);
          queryClient.setQueryData(['agent', 'proposal', action.id], cancelled);
          void queryClient.invalidateQueries({ queryKey: ['agent', 'smart-inbox'] });
        } catch (error) {
          await queryClient.invalidateQueries({ queryKey: ['agent', 'proposal', action.id] });
          showAgentFailure(error);
          return;
        }
      }
      const response = await submitTextMutation.mutateAsync({
        idempotencyKey: writeIntents.keyFor(intent),
        target,
        text,
      });
      writeIntents.complete(intent);
      delete replyTarget.current[panel.conversationId];
      if (conversationDraftMemory.get(memoryKey) === draftAtSubmit)
        conversationDraftMemory.delete(memoryKey);
      setConversationDrafts((current) => ({
        ...current,
        [panel.conversationId]:
          current[panel.conversationId] === draftAtSubmit
            ? ''
            : (current[panel.conversationId] ?? ''),
      }));
      setScrollToLatest((current) => current + 1);
      if (
        currentPanel.current?.type !== 'agentConversation' ||
        currentPanel.current.conversationId !== panel.conversationId
      ) {
        await invalidateAgentState();
      } else if ('outcome' in response) {
        await handleAnswerResponse(response, panel.conversationId);
      } else {
        openQueuedRequest(response);
      }
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === 'AGENT_MESSAGE_VERSION_CONFLICT') {
        await messagesQuery.refetch();
      }
      if (
        currentPanel.current?.type === 'agentConversation' &&
        currentPanel.current.conversationId === panel.conversationId
      )
        showAgentFailure(error);
    } finally {
      submitLock.current = false;
      setSubmitPending(false);
    }
  }, [
    conversationDrafts,
    conversationProposals,
    handleAnswerResponse,
    interactionPending,
    invalidateAgentState,
    messagesQuery,
    openQueuedRequest,
    proposalCancelMutation,
    state.panel,
    submitTextMutation,
    writeIntents,
    userId,
  ]);
  const latestSubmitConversationText = useRef(submitConversationText);
  latestSubmitConversationText.current = submitConversationText;

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
      if (version < 1 || submitLock.current) return;
      submitLock.current = true;
      setSubmitPending(true);
      const originPanel = currentPanel.current;
      const source = { messageId, type: 'MESSAGE' as const, version };
      const intent = { operation: 'AGENT_PLAN_GENERATE', source };
      try {
        const response = await planMutation.mutateAsync({
          idempotencyKey: writeIntents.keyFor(intent),
          source,
        });
        writeIntents.complete(intent);
        if (currentPanel.current === originPanel) openQueuedRequest(response);
        else await invalidateAgentState();
      } catch (error) {
        if (currentPanel.current === originPanel) handleAgentError(error);
      } finally {
        submitLock.current = false;
        setSubmitPending(false);
      }
    },
    [handleAgentError, invalidateAgentState, openQueuedRequest, planMutation, writeIntents],
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
        await queryClient.invalidateQueries({ queryKey: ['agent', 'proposal', proposal.id] });
        throw error;
      }
    },
    [proposalEditMutation, updateProposalCache, writeIntents],
  );

  const closeProposal = useCallback(async () => {
    // Closing an in-flight write must not bump the source version used by regeneration.
    if (submitLock.current || proposalEditMutation.isPending) {
      proposalExitHandled.current = true;
      closePanel();
      return;
    }
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
    proposalEditMutation.isPending,
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

  const executeProposal = useCallback(
    async (proposal: PublicActionProposal, closeAfterExecution: boolean) => {
      if (submitLock.current || proposal.status !== 'AWAITING_CONFIRMATION') return;
      submitLock.current = true;
      setSubmitPending(true);
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
          showAgentFailure(
            new ApiRequestError({
              code: response.execution.error.code,
              message: response.execution.error.message,
              status: 409,
            }),
          );
          await invalidateAgentState();
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
        if (
          closeAfterExecution &&
          currentPanel.current?.type === 'agentProposal' &&
          currentPanel.current.proposalId === proposal.id
        ) {
          proposalExitHandled.current = true;
          closePanel();
        }
      } catch (error) {
        showAgentFailure(error);
        void queryClient.invalidateQueries({ queryKey: ['agent', 'proposal', proposal.id] });
      } finally {
        submitLock.current = false;
        setSubmitPending(false);
      }
    },
    [
      closePanel,
      dispatch,
      invalidateAgentState,
      proposalConfirmMutation,
      refreshTasksAndProjects,
      updateProposalCache,
      writeIntents,
    ],
  );
  const confirmProposal = useCallback(async () => {
    const proposal = proposalQuery.data?.proposal;
    if (proposal) await executeProposal(proposal, true);
  }, [executeProposal, proposalQuery.data?.proposal]);

  const regeneratePlan = useCallback(async () => {
    const proposal = proposalQuery.data?.proposal;
    if (!proposal || submitLock.current) return;
    submitLock.current = true;
    setSubmitPending(true);
    const originPanel = currentPanel.current;
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
      if (currentPanel.current === originPanel) {
        proposalExitHandled.current = true;
        openQueuedRequest(response);
      } else await invalidateAgentState();
    } catch (error) {
      if (currentPanel.current === originPanel) handleAgentError(error);
    } finally {
      submitLock.current = false;
      setSubmitPending(false);
    }
  }, [
    invalidateAgentState,
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
          try {
            const response = await scheduleApi.getActionProposal(item.action.proposalId);
            queryClient.setQueryData(['agent', 'proposal', response.proposal.id], response);
            if (response.proposal.presentation === 'PLAN') {
              dispatch({
                presentation: 'PLAN',
                proposalId: response.proposal.id,
                type: 'OPEN_AGENT_PROPOSAL',
              });
            } else {
              dispatch({
                conversationId: response.proposal.conversationId,
                ...(item.action.messageId ? { focusMessageId: item.action.messageId } : {}),
                type: 'OPEN_AGENT_CONVERSATION',
              });
            }
          } catch (error) {
            showAgentFailure(error);
          }
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
  const proposalPending =
    submitPending ||
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
        actionCards={Object.fromEntries(
          Object.entries(conversationProposals)
            .filter(([, value]) => value.presentation === 'ACTION')
            .map(([id, value]) => [id, presentActionCard(value, projects, timeZone)]),
        )}
        draft={
          conversationDrafts[activeConversationId] ??
          conversationDraftMemory.get(conversationDraftKey(userId, activeConversationId)) ??
          ''
        }
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
        onDraftChange={(value) => {
          conversationDraftMemory.set(conversationDraftKey(userId, activeConversationId), value);
          setConversationDrafts((current) => ({ ...current, [activeConversationId]: value }));
        }}
        onFreeText={() => {
          if (typeof document !== 'undefined') {
            document
              .querySelector<HTMLTextAreaElement>('.agentConversationComposer textarea')
              ?.focus();
          }
        }}
        onGeneratePlan={(messageId, version) => void generatePlanFromMessage(messageId, version)}
        onContinueAction={(proposalId) => {
          replyTarget.current[activeConversationId] = proposalId;
          if (typeof document !== 'undefined') {
            document
              .querySelector<HTMLTextAreaElement>('.agentConversationComposer textarea')
              ?.focus();
          }
        }}
        onConfirmAction={(proposalId) => {
          const selected = conversationProposals[proposalId];
          if (selected) void executeProposal(selected, false);
        }}
        onRemoveActionItem={(proposalId, mutationId) => {
          const selected = conversationProposals[proposalId];
          if (selected?.actionCode === 'ORGANIZE_TASKS') {
            void editProposal(selected, { mutationId, type: 'REMOVE_MUTATION' }).catch(
              () => undefined,
            );
          }
        }}
        onOpenProposal={(proposalId) =>
          dispatch({ presentation: 'PLAN', proposalId, type: 'OPEN_AGENT_PROPOSAL' })
        }
        pending={interactionPending}
        planProposalIds={Object.values(conversationProposals)
          .filter((value) => value.presentation === 'PLAN')
          .map((value) => value.id)}
        proposalErrors={conversationProposalIds.filter(
          (_, index) => conversationProposalQueries[index]?.isError,
        )}
        onRetryProposal={(proposalId) => {
          const index = conversationProposalIds.indexOf(proposalId);
          if (index >= 0) void conversationProposalQueries[index]?.refetch();
        }}
        onSubmit={() => void latestSubmitConversationText.current()}
        scrollToLatest={scrollToLatest}
        undoToast={
          undoReceipt ? (
            <UndoToast
              disabled={undoPending}
              message={`已删除“${undoReceipt.taskTitle}”`}
              onUndo={onUndo}
            />
          ) : null
        }
      />
    );
  } else if (state.panel?.type === 'agentProposal') {
    if (proposalPresentation && proposal) {
      panels = (
        <AgentProposalSheet
          disabled={proposalPending}
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
