import type {
  CreateTaskInput,
  Project,
  Task,
  TaskListResponse,
  UpdateTaskInput,
} from '@ai-schedule/contracts';
import {
  AppShell,
  BottomSheet,
  ElectricButton,
  NeutralPressButton,
  SmartInboxCard,
  StatusBar,
  TaskRow,
  UndoToast,
} from '@ai-schedule/ui';
import { useInfiniteQuery, useMutation, useQuery, type InfiniteData } from '@tanstack/react-query';
import { Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ApiRequestError } from '../api-client';
import { useAuthBoundary } from '../auth-boundary-context';
import type { AppPanel } from '../app-state';
import { useAppState } from '../app-state-context';
import { queryClient, scheduleApi } from '../app-runtime';
import { presentTask } from '../task-presentation';
import { WriteIntentRegistry } from '../write-intent';
import { ProjectManagementSheet } from './project-management-sheet';
import { TaskFormSheet } from './task-form-sheet';
import { useAgentProduct } from './use-agent-product';
import './prototype-screens.scss';
import './production-screens.scss';

function flattenTasks(data: InfiniteData<TaskListResponse, string | null> | undefined): Task[] {
  return data?.pages.flatMap((page) => page.items) ?? [];
}

function projectPanel(panel: AppPanel | null): panel is Extract<
  AppPanel,
  {
    type: 'archiveProjectConfirm' | 'createProject' | 'projectManager' | 'renameProject';
  }
> {
  return (
    panel?.type === 'projectManager' ||
    panel?.type === 'createProject' ||
    panel?.type === 'renameProject' ||
    panel?.type === 'archiveProjectConfirm'
  );
}

function showFailure(error: unknown) {
  void Taro.showToast({
    duration: 2200,
    icon: 'none',
    title: error instanceof ApiRequestError ? error.message : '操作失败，请稍后重试',
  });
}

function isPanelHistoryState(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>)['aiSchedulePanel'] === true
  );
}

function dateLabel(timeZone: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    day: 'numeric',
    month: 'long',
    timeZone,
    weekday: 'short',
  }).format(new Date());
}

export function TaskHomeScreen() {
  const { markAuthenticated, transitionToGuest } = useAuthBoundary();
  const { dispatch, state } = useAppState();
  const [writeIntents] = useState(() => new WriteIntentRegistry());
  const panelRef = useRef(state.panel);
  const previousPanelRef = useRef(state.panel);
  panelRef.current = state.panel;

  const accountQueriesEnabled = state.session !== 'guest';
  const meQuery = useQuery({
    enabled: accountQueriesEnabled,
    queryFn: () => scheduleApi.me(),
    queryKey: ['users', 'me'],
  });
  const projectsQuery = useQuery({
    enabled: accountQueriesEnabled,
    queryFn: () => scheduleApi.listProjects({ limit: 100, status: 'ACTIVE' }),
    queryKey: ['projects', 'ACTIVE'],
  });
  const selectedProjectId = state.filter.type === 'project' ? state.filter.projectId : undefined;
  const todoQuery = useInfiniteQuery<
    TaskListResponse,
    Error,
    InfiniteData<TaskListResponse, string | null>,
    [string, string, string],
    string | null
  >({
    enabled: accountQueriesEnabled,
    getNextPageParam: (lastPage) => lastPage.pageInfo.nextCursor,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      scheduleApi.listTasks({
        ...(pageParam ? { cursor: pageParam } : {}),
        ...(selectedProjectId ? { projectId: selectedProjectId } : {}),
        limit: 50,
        status: 'TODO',
      }),
    queryKey: ['tasks', 'TODO', selectedProjectId ?? 'all'],
  });
  const completedQuery = useInfiniteQuery<
    TaskListResponse,
    Error,
    InfiniteData<TaskListResponse, string | null>,
    [string, string, string],
    string | null
  >({
    enabled: accountQueriesEnabled && state.completedExpanded,
    getNextPageParam: (lastPage) => lastPage.pageInfo.nextCursor,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      scheduleApi.listTasks({
        ...(pageParam ? { cursor: pageParam } : {}),
        ...(selectedProjectId ? { projectId: selectedProjectId } : {}),
        limit: 50,
        status: 'COMPLETED',
      }),
    queryKey: ['tasks', 'COMPLETED', selectedProjectId ?? 'all'],
  });

  const projects = projectsQuery.data?.items ?? [];
  const todoTasks = flattenTasks(todoQuery.data);
  const completedTasks = flattenTasks(completedQuery.data);
  const editingTaskId = state.panel?.type === 'editTask' ? state.panel.taskId : null;
  const cachedSelectedTask = useMemo(() => {
    if (!editingTaskId) return null;
    return [...todoTasks, ...completedTasks].find((task) => task.id === editingTaskId) ?? null;
  }, [completedTasks, editingTaskId, todoTasks]);
  const selectedTaskQuery = useQuery({
    enabled: accountQueriesEnabled && Boolean(editingTaskId) && !cachedSelectedTask,
    queryFn: () => scheduleApi.task(editingTaskId ?? ''),
    queryKey: ['tasks', 'detail', editingTaskId],
  });
  const selectedTask = cachedSelectedTask ?? selectedTaskQuery.data?.task ?? null;

  useEffect(() => {
    if (state.session === 'booting' && meQuery.data) markAuthenticated();
  }, [markAuthenticated, meQuery.data, state.session]);

  const refreshTasksAndProjects = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['tasks'] }),
      queryClient.invalidateQueries({ queryKey: ['projects'] }),
      queryClient.invalidateQueries({ queryKey: ['agent', 'smart-inbox'] }),
    ]);
  }, []);

  const closePanel = useCallback(() => {
    if (typeof window !== 'undefined' && isPanelHistoryState(window.history.state)) {
      window.history.back();
      return;
    }
    dispatch({ type: 'CLOSE_PANEL' });
  }, [dispatch]);

  const agentProduct = useAgentProduct({
    accountEnabled: accountQueriesEnabled,
    closePanel,
    projects,
    refreshTasksAndProjects,
    ...(selectedProjectId ? { selectedProjectId } : {}),
    timeZone: meQuery.data?.timezone ?? 'Asia/Shanghai',
    ...(meQuery.data?.id ? { userId: meQuery.data.id } : {}),
  });

  useEffect(() => {
    const wasOpen = previousPanelRef.current !== null;
    const isOpen = state.panel !== null;
    if (!wasOpen && isOpen && typeof window !== 'undefined') {
      window.history.pushState(
        { ...window.history.state, aiSchedulePanel: true },
        '',
        window.location.href,
      );
    }
    previousPanelRef.current = state.panel;
  }, [state.panel]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handlePopState = (event: PopStateEvent) => {
      if (!panelRef.current) return;
      // A panel history sentinel belongs to the in-page sheet model, not Taro's page router.
      // Capture it before Taro's bubbling listener can remount the current page.
      event.stopImmediatePropagation();
      dispatch({ type: 'CLOSE_PANEL' });
    };
    window.addEventListener('popstate', handlePopState, true);
    return () => window.removeEventListener('popstate', handlePopState, true);
  }, []);

  useEffect(() => {
    const receipt = state.deleteUndoReceipt;
    if (!receipt) return undefined;
    const remaining = Math.max(0, new Date(receipt.expiresAt).getTime() - Date.now());
    const timeout = setTimeout(() => dispatch({ type: 'CLEAR_DELETE_UNDO' }), remaining);
    return () => clearTimeout(timeout);
  }, [state.deleteUndoReceipt]);

  const completeMutation = useMutation({
    mutationFn: ({
      idempotencyKey,
      intent,
    }: {
      idempotencyKey: string;
      intent: { operation: string; taskId: string; version: number };
    }) => scheduleApi.completeTask(intent.taskId, intent.version, idempotencyKey),
    onError: showFailure,
    onSuccess: (_response, { intent }) => {
      writeIntents.complete(intent);
      void refreshTasksAndProjects();
    },
  });
  const restoreMutation = useMutation({
    mutationFn: ({
      idempotencyKey,
      intent,
    }: {
      idempotencyKey: string;
      intent: { operation: string; taskId: string; version: number };
    }) => scheduleApi.restoreTask(intent.taskId, intent.version, idempotencyKey),
    onError: showFailure,
    onSuccess: (_response, { intent }) => {
      writeIntents.complete(intent);
      void refreshTasksAndProjects();
    },
  });
  const createMutation = useMutation({
    mutationFn: ({ input, idempotencyKey }: { input: CreateTaskInput; idempotencyKey: string }) =>
      scheduleApi.createTask(input, idempotencyKey),
  });
  const updateMutation = useMutation({
    mutationFn: ({
      idempotencyKey,
      input,
      taskId,
    }: {
      idempotencyKey: string;
      input: UpdateTaskInput;
      taskId: string;
    }) => scheduleApi.updateTask(taskId, input, idempotencyKey),
  });
  const deleteMutation = useMutation({
    mutationFn: ({ idempotencyKey, task }: { idempotencyKey: string; task: Task }) =>
      scheduleApi.deleteTask(task.id, task.version, idempotencyKey),
  });
  const undoMutation = useMutation({
    mutationFn: ({
      idempotencyKey,
      intent,
    }: {
      idempotencyKey: string;
      intent: { operation: string; operationId: string };
    }) => scheduleApi.executeUndo(intent.operationId, idempotencyKey),
    onError: (error) => {
      if (error instanceof ApiRequestError && error.status < 500) {
        dispatch({ type: 'CLEAR_DELETE_UNDO' });
      }
      showFailure(error);
    },
    onSuccess: (_response, { intent }) => {
      writeIntents.complete(intent);
      dispatch({ type: 'CLEAR_DELETE_UNDO' });
      void refreshTasksAndProjects();
    },
  });
  const createProjectMutation = useMutation({
    mutationFn: ({ idempotencyKey, name }: { idempotencyKey: string; name: string }) =>
      scheduleApi.createProject({ name }, idempotencyKey),
  });
  const renameProjectMutation = useMutation({
    mutationFn: ({
      idempotencyKey,
      name,
      project,
    }: {
      idempotencyKey: string;
      name: string;
      project: Project;
    }) =>
      scheduleApi.updateProject(
        project.id,
        { changes: { name }, version: project.version },
        idempotencyKey,
      ),
  });
  const archiveProjectMutation = useMutation({
    mutationFn: ({ idempotencyKey, project }: { idempotencyKey: string; project: Project }) =>
      scheduleApi.archiveProject(project.id, { version: project.version }, idempotencyKey),
  });

  if (meQuery.isPending || projectsQuery.isPending || todoQuery.isPending) {
    return (
      <AppShell className="bootScreen">
        <View aria-busy="true" className="bootCard">
          <Text className="bootTitle">正在整理今天</Text>
          <Text className="bootCopy">读取你的待办和项目…</Text>
        </View>
      </AppShell>
    );
  }

  if (meQuery.isError || projectsQuery.isError || todoQuery.isError || !meQuery.data) {
    return (
      <AppShell className="bootScreen">
        <View className="bootCard">
          <Text className="bootTitle">暂时无法读取待办</Text>
          <Text className="bootCopy">你的输入不会丢失，请检查网络后重试。</Text>
          <ElectricButton
            ariaLabel="重试读取待办"
            onClick={() => {
              void Promise.all([meQuery.refetch(), projectsQuery.refetch(), todoQuery.refetch()]);
            }}
          >
            重试
          </ElectricButton>
        </View>
      </AppShell>
    );
  }

  const counts = todoQuery.data?.pages[0]?.counts ?? { completed: 0, todo: 0 };
  const activeProject = selectedProjectId
    ? projects.find((project) => project.id === selectedProjectId)
    : undefined;
  const pageTitle = activeProject
    ? `${activeProject.name} · ${counts.todo} 件待办`
    : counts.todo > 0
      ? `今天先处理 ${counts.todo} 件事`
      : '今天已经清空';
  const timeZone = meQuery.data.timezone;

  return (
    <AppShell className="todoScreen productionTodoScreen">
      <StatusBar />
      <View className="productionScroll">
        <View className="editorialHeader">
          <Text className="dateLabel">{dateLabel(timeZone)}</Text>
          <Text className="pageTitle">{pageTitle}</Text>
        </View>
        <NeutralPressButton
          role="button"
          aria-label="新增待办"
          className="addButton"
          onClick={() => dispatch({ type: 'OPEN_CREATE_TASK' })}
          tabIndex={0}
        >
          +
        </NeutralPressButton>
        <SmartInboxCard
          actionAriaLabel={agentProduct.smartInbox.actionAriaLabel}
          actionLabel={agentProduct.smartInbox.actionLabel}
          body={agentProduct.smartInbox.body}
          collapsed={agentProduct.smartInbox.collapsed}
          onAction={agentProduct.smartInbox.onAction}
          onToggleCollapsed={agentProduct.smartInbox.onToggleCollapsed}
        />
        <View aria-label="项目筛选" className="projectChips" role="group">
          <NeutralPressButton
            role="button"
            aria-pressed={state.filter.type === 'all'}
            className="chipHit"
            onClick={() => dispatch({ type: 'SELECT_ALL' })}
            tabIndex={0}
          >
            <View className={`chip ${state.filter.type === 'all' ? 'chipActive' : ''}`}>
              <View aria-hidden className="projectFilterDot projectFilterDot_cyan" />
              <Text className="projectChipLabel">全部</Text>
            </View>
          </NeutralPressButton>
          {projects.map((project) => (
            <NeutralPressButton
              role="button"
              aria-pressed={
                state.filter.type === 'project' && state.filter.projectId === project.id
              }
              className="chipHit"
              key={project.id}
              onClick={() => dispatch({ type: 'SELECT_PROJECT', projectId: project.id })}
              tabIndex={0}
            >
              <View
                className={`chip ${
                  state.filter.type === 'project' && state.filter.projectId === project.id
                    ? 'chipActive'
                    : ''
                }`}
              >
                <View
                  aria-hidden
                  className={`projectFilterDot projectFilterDot_${project.colorKey}`}
                />
                <Text className="projectChipLabel">{project.name}</Text>
              </View>
            </NeutralPressButton>
          ))}
          <NeutralPressButton
            role="button"
            aria-label="管理项目"
            className="chipHit manageProjectsChip"
            onClick={() => dispatch({ type: 'OPEN_PROJECT_MANAGER' })}
            tabIndex={0}
          >
            <View className="chip">
              <Text className="projectChipLabel">管理</Text>
            </View>
          </NeutralPressButton>
        </View>
        <View className="timeline productionTimeline">
          <Text className="timelineLabel">时间线</Text>
          {todoTasks.length === 0 ? (
            <View className="emptyCard productionEmptyCard">
              <View aria-hidden className="emptyCheck">
                ✓
              </View>
              <Text className="emptyTitle">这个范围暂无待办</Text>
              <Text className="emptyCopy">可以手工创建一件新事情。</Text>
              <ElectricButton
                ariaLabel="创建一件新事情"
                onClick={() => dispatch({ type: 'OPEN_CREATE_TASK' })}
              >
                收进一件新事情
              </ElectricButton>
            </View>
          ) : (
            <View className="taskList">
              {todoTasks.map((task) => {
                const presentation = presentTask(task, timeZone);
                return (
                  <TaskRow
                    disabled={
                      completeMutation.isPending &&
                      completeMutation.variables.intent.taskId === task.id
                    }
                    id={task.id}
                    key={task.id}
                    meta={presentation.meta}
                    onComplete={() => {
                      const intent = {
                        operation: 'TASK_COMPLETE',
                        taskId: task.id,
                        version: task.version,
                      };
                      completeMutation.mutate({
                        idempotencyKey: writeIntents.keyFor(intent),
                        intent,
                      });
                    }}
                    onOpen={() => dispatch({ type: 'OPEN_EDIT_TASK', taskId: task.id })}
                    priority={presentation.priority}
                    project={presentation.project.name}
                    projectColor={presentation.project.color}
                    time={presentation.time}
                    title={task.title}
                  />
                );
              })}
            </View>
          )}
          {todoQuery.hasNextPage ? (
            <NeutralPressButton
              role="button"
              className="loadMore"
              disabled={todoQuery.isFetchingNextPage}
              onClick={() => void todoQuery.fetchNextPage()}
              tabIndex={todoQuery.isFetchingNextPage ? -1 : 0}
            >
              {todoQuery.isFetchingNextPage ? '加载中…' : '加载更多'}
            </NeutralPressButton>
          ) : null}
          <NeutralPressButton
            role="button"
            aria-expanded={state.completedExpanded}
            className="completedFold"
            onClick={() => dispatch({ type: 'TOGGLE_COMPLETED' })}
            tabIndex={0}
          >
            <Text>已完成 {counts.completed} 项</Text>
            <Text>{state.completedExpanded ? '⌄' : '›'}</Text>
          </NeutralPressButton>
          {state.completedExpanded ? (
            <View className="completedTaskList">
              {completedQuery.isPending ? (
                <Text className="inlineStatus">正在读取已完成待办…</Text>
              ) : completedQuery.isError ? (
                <NeutralPressButton
                  role="button"
                  className="loadMore"
                  onClick={() => void completedQuery.refetch()}
                  tabIndex={0}
                >
                  重试读取已完成
                </NeutralPressButton>
              ) : (
                completedTasks.map((task) => {
                  const presentation = presentTask(task, timeZone);
                  return (
                    <TaskRow
                      completed
                      disabled={
                        restoreMutation.isPending &&
                        restoreMutation.variables.intent.taskId === task.id
                      }
                      id={task.id}
                      key={task.id}
                      meta={presentation.meta}
                      onComplete={() => {
                        const intent = {
                          operation: 'TASK_RESTORE',
                          taskId: task.id,
                          version: task.version,
                        };
                        restoreMutation.mutate({
                          idempotencyKey: writeIntents.keyFor(intent),
                          intent,
                        });
                      }}
                      onOpen={() => dispatch({ type: 'OPEN_EDIT_TASK', taskId: task.id })}
                      priority={presentation.priority}
                      project={presentation.project.name}
                      projectColor={presentation.project.color}
                      time={presentation.time}
                      title={task.title}
                    />
                  );
                })
              )}
              {completedQuery.hasNextPage ? (
                <NeutralPressButton
                  role="button"
                  className="loadMore"
                  disabled={completedQuery.isFetchingNextPage}
                  onClick={() => void completedQuery.fetchNextPage()}
                  tabIndex={completedQuery.isFetchingNextPage ? -1 : 0}
                >
                  {completedQuery.isFetchingNextPage ? '加载中…' : '加载更多已完成'}
                </NeutralPressButton>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>
      {state.deleteUndoReceipt ? (
        <UndoToast
          disabled={undoMutation.isPending}
          message={`已删除“${state.deleteUndoReceipt.taskTitle}”`}
          onUndo={() => {
            const operationId = state.deleteUndoReceipt?.operationId;
            if (!operationId) return;
            const intent = { operation: 'TASK_DELETE_UNDO', operationId };
            undoMutation.mutate({ idempotencyKey: writeIntents.keyFor(intent), intent });
          }}
        />
      ) : null}
      <View className="commandComposer">
        <Text aria-hidden className="composerSpark">
          ✦
        </Text>
        <NeutralPressButton
          role="button"
          aria-label="使用文字告诉 Agent"
          className="composerCopy"
          onClick={agentProduct.openTextInput}
          tabIndex={0}
        >
          <Text className="composerTitle">告诉我下一件事</Text>
          <Text className="composerHint">输入文字，确认后再写入待办</Text>
        </NeutralPressButton>
        <NeutralPressButton
          role="button"
          aria-label="打开文字输入"
          className="keyboardButton"
          onClick={agentProduct.openTextInput}
          tabIndex={0}
        >
          ⌨
        </NeutralPressButton>
        <NeutralPressButton
          role="button"
          aria-label="打开语音输入"
          className="voiceButton"
          onClick={agentProduct.openVoiceDeferred}
          tabIndex={0}
        >
          ◉
        </NeutralPressButton>
      </View>
      {state.panel?.type === 'createTask' ? (
        <TaskFormSheet
          onClose={closePanel}
          onCreate={async (input, idempotencyKey) => {
            await createMutation.mutateAsync({ idempotencyKey, input });
            await refreshTasksAndProjects();
            closePanel();
          }}
          onDelete={() => Promise.resolve()}
          onUpdate={() => Promise.resolve()}
          projects={projects}
          task={null}
          timeZone={timeZone}
        />
      ) : null}
      {state.panel?.type === 'editTask' ? (
        selectedTask ? (
          <TaskFormSheet
            onClose={closePanel}
            onCreate={() => Promise.resolve()}
            onDelete={async (task, idempotencyKey) => {
              const response = await deleteMutation.mutateAsync({ idempotencyKey, task });
              dispatch({
                receipt: {
                  expiresAt: response.undoOperation.expiresAt,
                  operationId: response.undoOperation.id,
                  taskTitle: task.title,
                },
                type: 'SHOW_DELETE_UNDO',
              });
              queryClient.removeQueries({
                exact: true,
                queryKey: ['tasks', 'detail', task.id],
              });
              closePanel();
              await refreshTasksAndProjects();
            }}
            onUpdate={async (taskId, input, idempotencyKey) => {
              await updateMutation.mutateAsync({ idempotencyKey, input, taskId });
              await refreshTasksAndProjects();
              closePanel();
            }}
            projects={projects}
            task={selectedTask}
            timeZone={timeZone}
          />
        ) : selectedTaskQuery.isError ? (
          <BottomSheet description="该待办可能已发生变化。" title="无法打开待办">
            <View className="sheetActions">
              <ElectricButton ariaLabel="关闭待办编辑" onClick={closePanel} variant="secondary">
                关闭
              </ElectricButton>
              <ElectricButton
                ariaLabel="重试读取待办"
                onClick={() => void selectedTaskQuery.refetch()}
              >
                重试
              </ElectricButton>
            </View>
          </BottomSheet>
        ) : (
          <BottomSheet description="正在读取最新版本。" title="编辑待办">
            <Text className="inlineStatus">加载中…</Text>
          </BottomSheet>
        )
      ) : null}
      {projectPanel(state.panel) ? (
        <ProjectManagementSheet
          onArchive={async (project, idempotencyKey) => {
            await archiveProjectMutation.mutateAsync({ idempotencyKey, project });
            await refreshTasksAndProjects();
            dispatch({ type: 'PROJECT_ARCHIVED', projectId: project.id });
          }}
          onClose={closePanel}
          onCreate={async (name, idempotencyKey) => {
            await createProjectMutation.mutateAsync({ idempotencyKey, name });
            await refreshTasksAndProjects();
            dispatch({ type: 'OPEN_PROJECT_MANAGER' });
          }}
          onLogout={async () => {
            await scheduleApi.logout();
            await transitionToGuest();
          }}
          onOpenArchive={(projectId) => dispatch({ type: 'OPEN_ARCHIVE_PROJECT', projectId })}
          onOpenCreate={() => dispatch({ type: 'OPEN_CREATE_PROJECT' })}
          onOpenManager={() => dispatch({ type: 'OPEN_PROJECT_MANAGER' })}
          onOpenRename={(projectId) => dispatch({ type: 'OPEN_RENAME_PROJECT', projectId })}
          onRename={async (project, name, idempotencyKey) => {
            await renameProjectMutation.mutateAsync({ idempotencyKey, name, project });
            await refreshTasksAndProjects();
            dispatch({ type: 'OPEN_PROJECT_MANAGER' });
          }}
          panel={state.panel}
          projects={projects}
          user={meQuery.data}
        />
      ) : null}
      {agentProduct.panels}
    </AppShell>
  );
}
