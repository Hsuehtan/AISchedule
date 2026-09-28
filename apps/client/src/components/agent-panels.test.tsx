import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { projectIdSchema } from '@ai-schedule/contracts';

vi.mock('@tarojs/components', () => ({
  Button: 'taro-button-core',
  Input: 'taro-input-core',
  Picker: 'taro-picker-core',
  Text: 'span',
  Textarea: 'taro-textarea-core',
  View: 'div',
}));

import {
  AgentConversationDialog,
  AgentProposalItemEditor,
  AgentProposalSheet,
  AgentTextInputSheet,
  AgentUnavailableSheet,
} from './agent-panels';

const projectId = projectIdSchema.parse('018f47be-1972-7d58-9d67-4ddc5eb78a60');

describe('production Agent panels', () => {
  it('renders a bounded plain-text composer without pricing controls', () => {
    const markup = renderToStaticMarkup(
      <AgentTextInputSheet
        disabled={false}
        onChange={() => undefined}
        onClose={() => undefined}
        onSubmit={() => undefined}
        value="整理这周的工作"
      />,
    );

    expect(markup).toContain('maxlength="500"');
    expect(markup).toContain('整理这周的工作');
    expect(markup).toContain('发送给 Agent');
    expect(markup).not.toMatch(/积分|Token|模型|价格/);
  });

  it('renders model content as escaped plain text and candidate option ids as controls', () => {
    const markup = renderToStaticMarkup(
      <AgentConversationDialog
        focusMessageId="m2"
        messages={[
          { content: '<img src=x onerror=alert(1)>', id: 'm1', role: 'ASSISTANT' },
          {
            allowFreeText: true,
            content: '你指的是哪一项？',
            id: 'm2',
            options: [{ label: '写周报', meta: '工作 · 明天截止', optionId: 'ref_abc' }],
            role: 'QUESTION',
            version: 2,
          },
        ]}
        onAnswer={() => undefined}
        onDraftChange={() => undefined}
        onClose={() => undefined}
        onFreeText={() => undefined}
        onGeneratePlan={() => undefined}
        onOpenProposal={() => undefined}
        onSubmit={() => undefined}
        pending={false}
        draft="补充说明"
      />,
    );

    expect(markup).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(markup).not.toContain('<img src=x');
    expect(markup).toContain('aria-label="选择写周报"');
    expect(markup).toContain('补充说明');
    expect(markup).toContain('agentMessageFocused');
    expect(markup).toContain('agentConversationComposer');
    expect(markup).toContain('aria-label="继续告诉 Agent 的内容"');
    expect(markup).toContain('aria-label="发送给 Agent"');
    expect(markup).not.toContain('继续对话');
    expect(markup).not.toContain('data-agent-message-id');
    expect(markup).not.toContain('ref_abc');
  });

  it('only offers plan generation when the persisted reply permits it', () => {
    const renderReply = (canGeneratePlan: boolean) =>
      renderToStaticMarkup(
        <AgentConversationDialog
          messages={[
            {
              canGeneratePlan,
              content: '回复',
              id: 'm1',
              role: 'ASSISTANT',
            },
          ]}
          onAnswer={() => undefined}
          onDraftChange={() => undefined}
          onClose={() => undefined}
          onFreeText={() => undefined}
          onGeneratePlan={() => undefined}
          onOpenProposal={() => undefined}
          onSubmit={() => undefined}
          pending={false}
          draft=""
        />,
      );

    expect(renderReply(false)).not.toContain('根据这条回复生成计划');
    expect(renderReply(true)).toContain('根据这条回复生成计划');
  });

  it('shows progress and prevents duplicate answers while a request is running', () => {
    const markup = renderToStaticMarkup(
      <AgentConversationDialog
        messages={[
          {
            allowFreeText: true,
            answerDisabled: true,
            content: '什么时候开始？',
            id: 'm1',
            options: [{ label: '今天', optionId: 'today' }],
            role: 'QUESTION',
            version: 1,
          },
        ]}
        onAnswer={() => undefined}
        onDraftChange={() => undefined}
        onClose={() => undefined}
        onFreeText={() => undefined}
        onGeneratePlan={() => undefined}
        onOpenProposal={() => undefined}
        onSubmit={() => undefined}
        pending
        draft="下一条"
      />,
    );

    expect(markup).toContain('Agent 正在处理');
    expect(markup).toContain('disabled="true"');
    expect(markup).toContain('下一条');
  });

  it('renders editable plan rows and a direct atomic-confirm action', () => {
    const markup = renderToStaticMarkup(
      <AgentProposalSheet
        disabled={false}
        kind="PLAN"
        onCancel={() => undefined}
        onClose={() => undefined}
        onConfirm={() => undefined}
        onRemoveItem={() => undefined}
        onRegenerate={() => undefined}
        onSaveItem={() => undefined}
        proposal={{
          id: 'p1',
          items: [
            {
              deadlineAt: '',
              editable: true,
              id: 'i1',
              priority: 'HIGH',
              project: { projectId, type: 'EXISTING' },
              projectName: '面试',
              reminderAt: '',
              scheduledAt: '',
              title: '整理项目经历',
            },
            {
              deadlineAt: '',
              editable: true,
              id: 'i2',
              priority: 'LOW',
              project: { projectId, type: 'EXISTING' },
              projectName: '面试',
              reminderAt: '',
              scheduledAt: '',
              title: '模拟回答',
            },
          ],
          summary: '产品经理面试计划',
          version: 3,
        }}
        projects={[{ id: projectId, name: '面试' }]}
        timeZone="Asia/Shanghai"
      />,
    );

    expect(markup).toContain('创建 2 项');
    expect(markup).toContain('编辑整理项目经历');
    expect(markup).toContain('再改一下');
    expect(markup).not.toContain('二次确认');
  });

  it('offers every approved plan field and mutation removal in the local editor', () => {
    const markup = renderToStaticMarkup(
      <AgentProposalItemEditor
        disabled={false}
        item={{
          deadlineAt: '',
          editable: true,
          id: 'i1',
          priority: 'MEDIUM',
          project: { type: 'NONE' },
          projectName: '未归属',
          reminderAt: '',
          scheduledAt: '',
          title: '准备自我介绍',
        }}
        onCancel={() => undefined}
        onRemove={() => undefined}
        onSave={() => undefined}
        projects={[{ id: projectId, name: '面试' }]}
        timeZone="Asia/Shanghai"
      />,
    );

    expect(markup).toContain('aria-label="计划项标题"');
    expect(markup).toContain('所属项目');
    expect(markup).toContain('优先级');
    expect(markup).toContain('计划时间');
    expect(markup).toContain('截止时间');
    expect(markup).toContain('提醒时间');
    expect(markup).toContain('删除此项');
    expect(markup).toContain('保存此项');
  });

  it('keeps non-create actions read-only while still allowing atomic confirmation', () => {
    const markup = renderToStaticMarkup(
      <AgentProposalSheet
        disabled={false}
        kind="ACTION"
        onCancel={() => undefined}
        onClose={() => undefined}
        onConfirm={() => undefined}
        onRegenerate={() => undefined}
        onRemoveItem={() => undefined}
        onSaveItem={() => undefined}
        proposal={{
          id: 'p-action',
          items: [
            {
              deadlineAt: '',
              editable: false,
              id: 'i-action',
              priority: 'HIGH',
              project: { projectId, type: 'EXISTING' },
              projectName: '面试',
              reminderAt: '',
              scheduledAt: '',
              title: '完成项目复盘',
            },
          ],
          summary: '完成待办',
          version: 1,
        }}
        projects={[{ id: projectId, name: '面试' }]}
        timeZone="Asia/Shanghai"
      />,
    );

    expect(markup).toContain('确认执行');
    expect(markup).toContain('待确认');
    expect(markup).not.toContain('编辑完成项目复盘');
  });

  it('does not offer or accept an unassigned project for plan drafts', () => {
    const item = {
      deadlineAt: '',
      editable: true,
      id: 'i1',
      priority: 'MEDIUM' as const,
      project: { type: 'NONE' as const },
      projectName: '请选择项目',
      reminderAt: '',
      scheduledAt: '',
      title: '准备自我介绍',
    };
    const editorMarkup = renderToStaticMarkup(
      <AgentProposalItemEditor
        allowUnassignedProject={false}
        disabled={false}
        item={item}
        onCancel={() => undefined}
        onRemove={() => undefined}
        onSave={() => undefined}
        projects={[{ id: projectId, name: '面试' }]}
        timeZone="Asia/Shanghai"
      />,
    );
    const proposalMarkup = renderToStaticMarkup(
      <AgentProposalSheet
        disabled={false}
        kind="PLAN"
        onCancel={() => undefined}
        onClose={() => undefined}
        onConfirm={() => undefined}
        onRegenerate={() => undefined}
        onRemoveItem={() => undefined}
        onSaveItem={() => undefined}
        proposal={{ id: 'p1', items: [item], summary: '计划', version: 1 }}
        projects={[{ id: projectId, name: '面试' }]}
        timeZone="Asia/Shanghai"
      />,
    );

    expect(editorMarkup).toContain('请选择项目');
    expect(editorMarkup).not.toContain('未归属');
    expect(editorMarkup).toMatch(/aria-label="保存此项"[^>]*disabled="true"/);
    expect(proposalMarkup).toMatch(/aria-label="创建 1 项"[^>]*disabled="true"/);
  });

  it('distinguishes quota exhaustion from service and deferred voice states', () => {
    expect(
      renderToStaticMarkup(<AgentUnavailableSheet onClose={() => undefined} reason="QUOTA" />),
    ).toContain('明天可继续');
    expect(
      renderToStaticMarkup(<AgentUnavailableSheet onClose={() => undefined} reason="SERVICE" />),
    ).toContain('智能处理暂不可用');
    expect(
      renderToStaticMarkup(
        <AgentUnavailableSheet onClose={() => undefined} reason="VOICE_DEFERRED" />,
      ),
    ).toContain('语音输入暂不可用');
  });
});
