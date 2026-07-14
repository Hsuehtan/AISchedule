import { Children, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tarojs/components', () => ({
  Button: 'button',
  Text: 'span',
  View: 'div',
}));

import {
  BottomSheet,
  Dialog,
  ElectricButton,
  SmartInboxCard,
  TaskRow,
  UndoToast,
  cycleModalFocus,
  electricInkTokens,
} from './index';

describe('Electric Ink design system', () => {
  it('locks the Production V3 visual constants', () => {
    expect(electricInkTokens.color).toEqual(
      expect.objectContaining({
        ink: '#101420',
        action: '#00D8FF',
        tint: '#E1F9FF',
        screen: '#F6F9FF',
        paper: '#FFFFFF',
        canvas: '#DDE7F2',
      }),
    );
    expect(electricInkTokens.layout.referenceWidth).toBe(390);
    expect(electricInkTokens.layout.referenceHeight).toBe(844);
    expect(electricInkTokens.layout.contentWidth).toBe(354);
    expect(electricInkTokens.layout.minimumHitArea).toBeGreaterThanOrEqual(44);
    expect(electricInkTokens.component.taskRowHeight).toBe(76);
  });

  it('renders semantic, traceable controls for the fixture shell', () => {
    const button = renderToStaticMarkup(<ElectricButton ariaLabel="登录">登录</ElectricButton>);
    const inbox = renderToStaticMarkup(<SmartInboxCard onOrganize={() => undefined} />);
    const task = renderToStaticMarkup(
      <TaskRow
        id="task_weekly_report"
        meta="明天截止 · 20:00 提醒"
        onOpen={() => undefined}
        priority="medium"
        project="工作"
        projectColor="purple"
        time="09:30"
        title="写周报"
      />,
    );
    const pendingTask = renderToStaticMarkup(
      <TaskRow
        disabled
        id="task_pending"
        meta="无截止时间 · 无提醒"
        priority="low"
        project="未归属"
        projectColor="cyan"
        time="待定"
        title="买牛奶"
      />,
    );

    expect(button).toContain('aria-label="登录"');
    expect(inbox).toContain('Smart Inbox');
    expect(inbox).toContain('一键整理');
    expect(task).toContain('data-task-id="task_weekly_report"');
    expect(task).toContain('aria-label="完成待办：写周报"');
    expect(task).toContain('aria-label="编辑待办：写周报"');
    expect(task).toContain('ei-task-row__open');
    expect(task).toContain('ei-task-row__project');
    expect(task).toContain('ei-project-color--purple');
    expect(task).toContain('ei-priority--medium');
    expect(task).not.toContain('ei-priority--purple');
    expect(pendingTask).toContain('aria-disabled="true"');
    expect(pendingTask).toContain('disabled=""');
  });

  it('only forwards the disabled prop to TaskRow controls when the task is disabled', () => {
    const activeTask = TaskRow({
      id: 'task_active',
      meta: '无截止时间 · 无提醒',
      onComplete: () => undefined,
      onOpen: () => undefined,
      priority: 'medium',
      project: '工作',
      projectColor: 'pink',
      time: '明天',
      title: '可见标题',
    });
    const disabledTask = TaskRow({
      disabled: true,
      id: 'task_disabled',
      meta: '无截止时间 · 无提醒',
      onComplete: () => undefined,
      onOpen: () => undefined,
      priority: 'low',
      project: '生活',
      projectColor: 'teal',
      time: '待定',
      title: '禁用标题',
    });

    const activeControls = Children.toArray(
      (activeTask.props as { children?: ReactNode }).children,
    );
    const disabledControls = Children.toArray(
      (disabledTask.props as { children?: ReactNode }).children,
    );

    expect(activeControls).toHaveLength(2);
    expect(disabledControls).toHaveLength(2);
    for (const control of activeControls) {
      expect(isValidElement(control)).toBe(true);
      if (isValidElement<{ disabled?: boolean }>(control)) {
        expect(control.props).not.toHaveProperty('disabled');
      }
    }
    for (const control of disabledControls) {
      expect(isValidElement(control)).toBe(true);
      if (isValidElement<{ disabled?: boolean }>(control)) {
        expect(control.props.disabled).toBe(true);
      }
    }
  });

  it('renders accessible overlay primitives', () => {
    const sheet = renderToStaticMarkup(
      <BottomSheet description="辅助说明" title="想让我帮你做什么？">
        Sheet content
      </BottomSheet>,
    );
    const dialog = renderToStaticMarkup(
      <Dialog onClose={() => undefined} title="确认 AI 操作">
        Dialog content
      </Dialog>,
    );
    const toast = renderToStaticMarkup(
      <UndoToast message="已完成「写周报」" onUndo={() => undefined} />,
    );

    expect(sheet).toContain('role="dialog"');
    expect(sheet).toContain('aria-modal="true"');
    expect(sheet).toContain('data-focus-managed="true"');
    expect(sheet).toContain('data-modal-focus-id=');
    expect(dialog).toContain('aria-label="关闭确认 AI 操作"');
    expect(toast).toContain('role="status"');
    expect(toast).toContain('撤销');
  });

  it('wraps keyboard focus at both ends of a modal', () => {
    const first = { focus: vi.fn() };
    const middle = { focus: vi.fn() };
    const last = { focus: vi.fn() };
    const focusable = [first, middle, last];

    expect(cycleModalFocus(focusable, last, false)).toBe(true);
    expect(first.focus).toHaveBeenCalledOnce();
    expect(cycleModalFocus(focusable, first, true)).toBe(true);
    expect(last.focus).toHaveBeenCalledOnce();
    expect(cycleModalFocus(focusable, middle, false)).toBe(false);
  });

  it('disables repeated undo while the write is pending', () => {
    const toast = renderToStaticMarkup(
      <UndoToast disabled message="已删除「写周报」" onUndo={() => undefined} />,
    );

    expect(toast).toContain('disabled=""');
  });
});
