import { BottomSheet, ElectricButton, NeutralPressButton } from '@ai-schedule/ui';
import { Input, Picker, Text, View } from '@tarojs/components';
import { useMemo, useState } from 'react';

import type { Project } from '@ai-schedule/contracts';
import type { AgentProposalDraftItem, AgentProposalPresentation } from '../agent-product-model';
import { DateTimePickerField } from './date-time-picker-field';

export type AgentProposalView = AgentProposalPresentation;

export type AgentProposalProjectOption = { id: Project['id']; name: string };

export type AgentProposalSheetProps = {
  disabled: boolean;
  onCancel: () => void;
  onClose: () => void;
  onConfirm: () => void;
  onRemoveItem: (itemId: string) => Promise<void> | void;
  onRegenerate: () => void;
  onSaveItem: (item: AgentProposalDraftItem) => Promise<void> | void;
  proposal: AgentProposalView;
  projects: readonly AgentProposalProjectOption[];
  timeZone: string;
};

const STATUS_LABEL = {
  DRAFT: '待确认',
  AWAITING_CONFIRMATION: '待确认',
  EXECUTING: '执行中',
  EXECUTED: '已执行',
  FAILED: '执行失败',
  CANCELLED: '已取消',
  EXPIRED: '已过期',
  SUPERSEDED: '已替换',
} as const;

const PRIORITY_LABEL = { HIGH: '高', LOW: '低', MEDIUM: '中' } as const;
const PRIORITY_OPTIONS = [
  { label: '高', value: 'HIGH' },
  { label: '中', value: 'MEDIUM' },
  { label: '低', value: 'LOW' },
] as const;

export function AgentProposalItemEditor({
  allowUnassignedProject = true,
  disabled,
  item,
  onCancel,
  onRemove,
  onSave,
  projects,
  timeZone,
}: {
  allowUnassignedProject?: boolean;
  disabled: boolean;
  item: AgentProposalDraftItem;
  onCancel: () => void;
  onRemove: () => Promise<void> | void;
  onSave: (item: AgentProposalDraftItem) => Promise<void> | void;
  projects: readonly AgentProposalProjectOption[];
  timeZone: string;
}) {
  const [draft, setDraft] = useState(item);

  const projectOptions = useMemo(
    () => [
      ...(allowUnassignedProject
        ? [{ label: '未归属', selection: { type: 'NONE' as const } }]
        : [{ label: '请选择项目', selection: null }]),
      ...projects.map((project) => ({
        label: project.name,
        selection: { projectId: project.id, type: 'EXISTING' as const },
      })),
      {
        label: draft.project.type === 'NEW' ? `新项目：${draft.project.name}` : '新建项目…',
        selection: {
          name: draft.project.type === 'NEW' ? draft.project.name : '',
          type: 'NEW' as const,
        },
      },
    ],
    [allowUnassignedProject, draft.project, projects],
  );
  const projectIndex = Math.max(
    0,
    projectOptions.findIndex(({ selection }) => {
      if (!selection) return !allowUnassignedProject && draft.project.type === 'NONE';
      if (selection.type !== draft.project.type) return false;
      if (selection.type === 'EXISTING' && draft.project.type === 'EXISTING') {
        return selection.projectId === draft.project.projectId;
      }
      return true;
    }),
  );
  const priorityIndex = Math.max(
    0,
    PRIORITY_OPTIONS.findIndex((option) => option.value === draft.priority),
  );
  const valid =
    draft.title.trim().length > 0 &&
    draft.title.trim().length <= 200 &&
    (allowUnassignedProject || draft.project.type !== 'NONE') &&
    (draft.project.type !== 'NEW' || draft.project.name.trim().length > 0);

  return (
    <View className="agentPlanEditor">
      <Text className="formLabel">标题</Text>
      <Input
        aria-label="计划项标题"
        className="formControl"
        disabled={disabled}
        maxlength={200}
        onInput={(event) => setDraft((current) => ({ ...current, title: event.detail.value }))}
        value={draft.title}
      />

      <Text className="formLabel">所属项目</Text>
      <Picker
        mode="selector"
        onChange={(event) => {
          const selection = projectOptions[Number(event.detail.value)]?.selection;
          if (!selection) return;
          const projectName =
            selection.type === 'EXISTING'
              ? (projects.find((project) => project.id === selection.projectId)?.name ?? '已有项目')
              : selection.type === 'NEW'
                ? selection.name
                : '未归属';
          setDraft((current) => ({ ...current, project: selection, projectName }));
        }}
        range={projectOptions.map((option) => option.label)}
        value={projectIndex}
      >
        <NeutralPressButton role="button" className="formPicker" tabIndex={0}>
          {projectOptions[projectIndex]?.label ?? '未归属'}
        </NeutralPressButton>
      </Picker>
      {draft.project.type === 'NEW' ? (
        <Input
          aria-label="新项目名称"
          className="formControl"
          disabled={disabled}
          maxlength={40}
          onInput={(event) => {
            const name = event.detail.value;
            setDraft((current) => ({
              ...current,
              project: { name, type: 'NEW' },
              projectName: name,
            }));
          }}
          placeholder="输入新项目名称"
          value={draft.project.name}
        />
      ) : null}

      <Text className="formLabel">优先级</Text>
      <Picker
        mode="selector"
        onChange={(event) => {
          const priority = PRIORITY_OPTIONS[Number(event.detail.value)]?.value ?? 'MEDIUM';
          setDraft((current) => ({ ...current, priority }));
        }}
        range={PRIORITY_OPTIONS.map((option) => option.label)}
        value={priorityIndex}
      >
        <NeutralPressButton role="button" className="formPicker" tabIndex={0}>
          {PRIORITY_OPTIONS[priorityIndex]?.label ?? '中'}
        </NeutralPressButton>
      </Picker>

      {(['scheduledAt', 'deadlineAt', 'reminderAt'] as const).map((fieldName) => {
        const label = {
          deadlineAt: '截止时间',
          reminderAt: '提醒时间',
          scheduledAt: '计划时间',
        }[fieldName];
        return (
          <View className="agentPlanTimeField" key={fieldName}>
            <Text className="formLabel">{label}</Text>
            <DateTimePickerField
              fieldName={fieldName}
              label={label}
              onChange={(value) => setDraft((current) => ({ ...current, [fieldName]: value }))}
              timeZone={timeZone}
              value={draft[fieldName]}
            />
          </View>
        );
      })}

      <View className="agentProposalEditorActions">
        <ElectricButton
          ariaLabel="删除此项"
          disabled={disabled}
          onClick={() => void onRemove()}
          variant="danger"
        >
          删除此项
        </ElectricButton>
        <ElectricButton
          ariaLabel="取消编辑计划项"
          disabled={disabled}
          onClick={onCancel}
          variant="secondary"
        >
          取消
        </ElectricButton>
        <ElectricButton
          ariaLabel="保存此项"
          disabled={disabled || !valid}
          onClick={() => void onSave({ ...draft, title: draft.title.trim() })}
        >
          保存此项
        </ElectricButton>
      </View>
    </View>
  );
}

export function AgentProposalSheet({
  disabled,
  onCancel,
  onClose,
  onConfirm,
  onRemoveItem,
  onRegenerate,
  onSaveItem,
  proposal,
  projects,
  timeZone,
}: AgentProposalSheetProps) {
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const editable = proposal.status === 'AWAITING_CONFIRMATION' || proposal.status === 'DRAFT';
  const recoverable = editable || proposal.status === 'FAILED';
  const statusLabel = STATUS_LABEL[proposal.status];
  const confirmLabel = `创建 ${proposal.items.length} 项`;
  const editingItem =
    (editable ? proposal.items.find((item) => item.id === editingItemId) : null) ?? null;

  return (
    <BottomSheet
      className="agentProposalSheet"
      description={
        editable
          ? '草稿可以编辑；确认后才会写入。'
          : proposal.status === 'FAILED'
            ? '执行失败，请重新生成计划。'
            : statusLabel
      }
      title="计划草稿"
    >
      <NeutralPressButton
        role="button"
        aria-label="关闭 Agent 草稿"
        className="agentPanelClose"
        onClick={onClose}
        tabIndex={0}
      >
        ×
      </NeutralPressButton>
      <View className="agentProposalSummary">
        <Text className="agentProposalTitle">{proposal.summary}</Text>
        <Text className="agentProposalMeta">{proposal.items.length} 项待办</Text>
        {!editable ? <View role="status">{statusLabel}</View> : null}
      </View>
      {editingItem ? (
        <AgentProposalItemEditor
          key={editingItem.id}
          allowUnassignedProject={false}
          disabled={disabled}
          item={editingItem}
          onCancel={() => setEditingItemId(null)}
          onRemove={() => {
            void Promise.resolve()
              .then(() => onRemoveItem(editingItem.id))
              .then(() => setEditingItemId(null))
              .catch(() => undefined);
          }}
          onSave={(item) => {
            void Promise.resolve()
              .then(() => onSaveItem(item))
              .then(() => setEditingItemId(null))
              .catch(() => undefined);
          }}
          projects={projects}
          timeZone={timeZone}
        />
      ) : (
        <View className="agentPlanList">
          {proposal.items.map((item, index) => (
            <View className="agentPlanRow" key={item.id}>
              <Text className="agentPlanIndex">{index + 1}</Text>
              <View className="agentPlanCopy">
                <Text className="agentPlanTitle">{item.title}</Text>
                <Text className="agentPlanMeta">{item.projectName}</Text>
              </View>
              <Text className={`agentPriority agentPriority_${item.priority.toLowerCase()}`}>
                {PRIORITY_LABEL[item.priority]}
              </Text>
              {editable && item.editable ? (
                <NeutralPressButton
                  role="button"
                  aria-label={`编辑${item.title}`}
                  className="agentEditPlanItem"
                  disabled={disabled}
                  onClick={() => setEditingItemId(item.id)}
                  tabIndex={disabled ? -1 : 0}
                >
                  编辑
                </NeutralPressButton>
              ) : (
                <Text className="agentPlanReadOnly">{statusLabel}</Text>
              )}
            </View>
          ))}
        </View>
      )}
      {recoverable ? (
        <View className="agentProposalSecondaryActions">
          {editable ? (
            <ElectricButton
              ariaLabel="取消 Agent 草稿"
              disabled={disabled}
              onClick={onCancel}
              variant="secondary"
            >
              取消草稿
            </ElectricButton>
          ) : null}
          <ElectricButton
            ariaLabel="重新生成计划"
            disabled={disabled || Boolean(editingItem)}
            onClick={onRegenerate}
            variant="secondary"
          >
            再改一下
          </ElectricButton>
        </View>
      ) : null}
      {proposal.status === 'AWAITING_CONFIRMATION' ? (
        <ElectricButton
          ariaLabel={confirmLabel}
          disabled={
            disabled ||
            Boolean(editingItem) ||
            proposal.items.length === 0 ||
            proposal.items.some((item) => item.project.type === 'NONE')
          }
          onClick={onConfirm}
        >
          {disabled ? '处理中…' : confirmLabel}
        </ElectricButton>
      ) : null}
    </BottomSheet>
  );
}
