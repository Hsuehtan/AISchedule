import {
  type CreateTaskInput,
  type Project,
  type Task,
  type UpdateTaskInput,
} from '@ai-schedule/contracts';
import { BottomSheet, ElectricButton, NeutralPressButton } from '@ai-schedule/ui';
import { Input, Picker, Text, Textarea, View } from '@tarojs/components';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { ZodError } from 'zod';

import {
  createTaskCreateInput,
  createTaskFormValues,
  createTaskProjectOptions,
  createTaskUpdateInput,
  type TaskFormValues,
} from '../task-form-model';
import { WriteIntentRegistry } from '../write-intent';
import { DateTimePickerField } from './date-time-picker-field';

type TaskFormSheetProps = {
  onClose: () => void;
  onCreate: (input: CreateTaskInput, idempotencyKey: string) => Promise<void>;
  onDelete: (task: Task, idempotencyKey: string) => Promise<void>;
  onUpdate: (taskId: string, input: UpdateTaskInput, idempotencyKey: string) => Promise<void>;
  projects: Project[];
  task: Task | null;
  timeZone: string;
};

const priorityOptions: Array<{ label: string; value: Task['priority'] }> = [
  { label: '高', value: 'HIGH' },
  { label: '中', value: 'MEDIUM' },
  { label: '低', value: 'LOW' },
];

function submissionMessage(error: unknown): string {
  if (error instanceof ZodError) return error.issues[0]?.message ?? '请检查输入';
  return error instanceof Error ? error.message : '保存失败，请稍后重试';
}

export function TaskFormSheet({
  onClose,
  onCreate,
  onDelete,
  onUpdate,
  projects,
  task,
  timeZone,
}: TaskFormSheetProps) {
  const [taskSnapshot] = useState(task);
  const [writeIntents] = useState(() => new WriteIntentRegistry());
  const [isDeleting, setIsDeleting] = useState(false);
  const {
    control,
    formState: { errors, isSubmitting },
    handleSubmit,
    setError,
  } = useForm<TaskFormValues>({ defaultValues: createTaskFormValues(taskSnapshot, timeZone) });

  const submit = handleSubmit(async (values) => {
    try {
      if (taskSnapshot) {
        const input = createTaskUpdateInput(taskSnapshot, values, timeZone);
        if (!input) {
          onClose();
          return;
        }
        const intent = { input, operation: 'TASK_UPDATE', taskId: taskSnapshot.id };
        await onUpdate(taskSnapshot.id, input, writeIntents.keyFor(intent));
        writeIntents.complete(intent);
      } else {
        const input = createTaskCreateInput(values, timeZone);
        const intent = { input, operation: 'TASK_CREATE' };
        await onCreate(input, writeIntents.keyFor(intent));
        writeIntents.complete(intent);
      }
    } catch (error) {
      setError('root', {
        message: submissionMessage(error),
      });
    }
  });
  const projectOptions = createTaskProjectOptions(taskSnapshot, projects);

  return (
    <BottomSheet
      description={
        taskSnapshot
          ? '修改会校验打开表单时的版本，冲突时保留你的输入。'
          : '手工创建不经过 Agent 确认。'
      }
      title={taskSnapshot ? '编辑待办' : '新建待办'}
    >
      <NeutralPressButton
        role="button"
        aria-label="关闭待办编辑"
        className="sheetClose"
        onClick={onClose}
        tabIndex={0}
      >
        ×
      </NeutralPressButton>
      <View className="productionForm">
        <Text className="formLabel">标题</Text>
        <Controller
          control={control}
          name="title"
          render={({ field }) => (
            <Input
              aria-label="待办标题"
              className="formControl"
              maxlength={200}
              onInput={(event) => field.onChange(event.detail.value)}
              placeholder="例如：写周报"
              value={field.value}
            />
          )}
        />
        {errors.title?.message ? <Text className="fieldError">{errors.title.message}</Text> : null}

        <Text className="formLabel">所属项目</Text>
        <Controller
          control={control}
          name="projectId"
          render={({ field }) => {
            const selectedIndex = Math.max(
              0,
              projectOptions.findIndex((project) => project.id === field.value),
            );
            return (
              <Picker
                mode="selector"
                onChange={(event) =>
                  field.onChange(projectOptions[Number(event.detail.value)]?.id ?? '')
                }
                range={projectOptions.map((project) => project.label)}
                value={selectedIndex}
              >
                <NeutralPressButton role="button" className="formPicker" tabIndex={0}>
                  {projectOptions[selectedIndex]?.label ?? '未归属'}
                </NeutralPressButton>
              </Picker>
            );
          }}
        />

        <Text className="formLabel">优先级</Text>
        <Controller
          control={control}
          name="priority"
          render={({ field }) => {
            const selectedIndex = Math.max(
              0,
              priorityOptions.findIndex((option) => option.value === field.value),
            );
            return (
              <Picker
                mode="selector"
                onChange={(event) =>
                  field.onChange(priorityOptions[Number(event.detail.value)]?.value ?? 'MEDIUM')
                }
                range={priorityOptions.map((option) => option.label)}
                value={selectedIndex}
              >
                <NeutralPressButton role="button" className="formPicker" tabIndex={0}>
                  {priorityOptions[selectedIndex]?.label ?? '中'}
                </NeutralPressButton>
              </Picker>
            );
          }}
        />

        <Text className="formLabel">描述</Text>
        <Controller
          control={control}
          name="description"
          render={({ field }) => (
            <Textarea
              aria-label="待办描述"
              className="formControl formTextarea"
              maxlength={2000}
              onInput={(event) => field.onChange(event.detail.value)}
              placeholder="可为空"
              value={field.value}
            />
          )}
        />

        {(['scheduledAt', 'deadlineAt', 'reminderAt'] as const).map((name) => {
          const labels = {
            deadlineAt: '截止时间',
            reminderAt: '提醒时间',
            scheduledAt: '计划时间',
          };
          return (
            <View className="dateTimeField" key={name}>
              <Text className="formLabel">{labels[name]}</Text>
              <Controller
                control={control}
                name={name}
                render={({ field }) => (
                  <DateTimePickerField
                    fieldName={name}
                    label={labels[name]}
                    onChange={field.onChange}
                    timeZone={timeZone}
                    value={field.value}
                  />
                )}
              />
            </View>
          );
        })}
        <Text className="formHint">提醒时间仅保存和展示，本阶段不主动弹出通知。</Text>
        {errors.root?.message ? (
          <Text aria-live="polite" className="formError">
            {errors.root.message}
          </Text>
        ) : null}
      </View>
      <View className={`sheetActions ${taskSnapshot ? 'sheetActionsThree' : ''}`}>
        {taskSnapshot ? (
          <ElectricButton
            ariaLabel={`删除待办：${taskSnapshot.title}`}
            disabled={isSubmitting || isDeleting}
            onClick={() => {
              setIsDeleting(true);
              const intent = {
                operation: 'TASK_DELETE',
                taskId: taskSnapshot.id,
                version: taskSnapshot.version,
              };
              void onDelete(taskSnapshot, writeIntents.keyFor(intent))
                .then(() => writeIntents.complete(intent))
                .catch((error: unknown) => setError('root', { message: submissionMessage(error) }))
                .finally(() => setIsDeleting(false));
            }}
            variant="danger"
          >
            {isDeleting ? '删除中…' : '删除'}
          </ElectricButton>
        ) : null}
        <ElectricButton ariaLabel="取消编辑" onClick={onClose} variant="secondary">
          取消
        </ElectricButton>
        <ElectricButton ariaLabel="保存待办" disabled={isSubmitting} onClick={() => void submit()}>
          {isSubmitting ? '保存中…' : '保存'}
        </ElectricButton>
      </View>
    </BottomSheet>
  );
}
