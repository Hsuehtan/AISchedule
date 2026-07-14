import type { Project, PublicUser } from '@ai-schedule/contracts';
import { BottomSheet, ElectricButton } from '@ai-schedule/ui';
import { Button, Input, Text, View } from '@tarojs/components';
import { useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';

import type { AppPanel } from '../app-state';
import { WriteIntentRegistry } from '../write-intent';

type ProjectManagementSheetProps = {
  onArchive: (project: Project, idempotencyKey: string) => Promise<void>;
  onClose: () => void;
  onCreate: (name: string, idempotencyKey: string) => Promise<void>;
  onLogout: () => Promise<void>;
  onOpenArchive: (projectId: string) => void;
  onOpenCreate: () => void;
  onOpenManager: () => void;
  onOpenRename: (projectId: string) => void;
  onRename: (project: Project, name: string, idempotencyKey: string) => Promise<void>;
  panel: AppPanel;
  projects: Project[];
  user: PublicUser;
};

function ProjectNameSheet({
  initialName,
  intentScope,
  onBack,
  onSave,
  title,
}: {
  initialName: string;
  intentScope: string;
  onBack: () => void;
  onSave: (name: string, idempotencyKey: string) => Promise<void>;
  title: string;
}) {
  const intentScopeSnapshot = useRef(intentScope);
  const onSaveSnapshot = useRef(onSave);
  const [writeIntents] = useState(() => new WriteIntentRegistry());
  const {
    control,
    formState: { errors, isSubmitting },
    handleSubmit,
    setError,
  } = useForm<{ name: string }>({ defaultValues: { name: initialName } });
  const submit = handleSubmit(async ({ name }) => {
    const normalized = name.trim();
    if (!normalized || normalized.length > 40) {
      setError('name', { message: '项目名称需为 1-40 个字符' });
      return;
    }
    try {
      const intent = { name: normalized, operation: intentScopeSnapshot.current };
      await onSaveSnapshot.current(normalized, writeIntents.keyFor(intent));
      writeIntents.complete(intent);
    } catch (error) {
      setError('root', {
        message: error instanceof Error ? error.message : '项目保存失败',
      });
    }
  });

  return (
    <BottomSheet description="活跃项目名称不可重复。" title={title}>
      <Button
        role="button"
        aria-label="返回项目管理"
        className="sheetClose"
        onClick={onBack}
        tabIndex={0}
      >
        ×
      </Button>
      <View className="productionForm">
        <Text className="formLabel">项目名称</Text>
        <Controller
          control={control}
          name="name"
          render={({ field }) => (
            <Input
              aria-label="项目名称"
              className="formControl"
              maxlength={40}
              onInput={(event) => field.onChange(event.detail.value)}
              placeholder="例如：工作"
              value={field.value}
            />
          )}
        />
        {errors.name?.message ? <Text className="fieldError">{errors.name.message}</Text> : null}
        {errors.root?.message ? <Text className="formError">{errors.root.message}</Text> : null}
      </View>
      <View className="sheetActions stickyActions">
        <ElectricButton ariaLabel="取消项目编辑" onClick={onBack} variant="secondary">
          取消
        </ElectricButton>
        <ElectricButton ariaLabel="保存项目" disabled={isSubmitting} onClick={() => void submit()}>
          {isSubmitting ? '保存中…' : '保存'}
        </ElectricButton>
      </View>
    </BottomSheet>
  );
}

function ArchiveProjectSheet({
  onArchive,
  onBack,
  project,
}: {
  onArchive: (project: Project, idempotencyKey: string) => Promise<void>;
  onBack: () => void;
  project: Project;
}) {
  const [projectSnapshot] = useState(project);
  const [writeIntents] = useState(() => new WriteIntentRegistry());
  const [actionError, setActionError] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);

  return (
    <BottomSheet
      description="归档后从筛选栏隐藏，原有待办仍在“全部”中保留项目归属。"
      title={`归档“${projectSnapshot.name}”？`}
    >
      <View className="archiveNotice">归档后本阶段不支持在 C 端恢复。</View>
      {actionError ? <Text className="formError">{actionError}</Text> : null}
      <View className="sheetActions stickyActions">
        <ElectricButton ariaLabel="取消归档" onClick={onBack} variant="secondary">
          取消
        </ElectricButton>
        <ElectricButton
          ariaLabel={`确认归档项目：${projectSnapshot.name}`}
          disabled={isWorking}
          onClick={() => {
            setActionError(null);
            setIsWorking(true);
            const intent = {
              operation: 'PROJECT_ARCHIVE',
              projectId: projectSnapshot.id,
              version: projectSnapshot.version,
            };
            void onArchive(projectSnapshot, writeIntents.keyFor(intent))
              .then(() => writeIntents.complete(intent))
              .catch((error: unknown) => {
                setActionError(error instanceof Error ? error.message : '归档失败');
              })
              .finally(() => setIsWorking(false));
          }}
          variant="danger"
        >
          {isWorking ? '归档中…' : '确认归档'}
        </ElectricButton>
      </View>
    </BottomSheet>
  );
}

export function ProjectManagementSheet({
  onArchive,
  onClose,
  onCreate,
  onLogout,
  onOpenArchive,
  onOpenCreate,
  onOpenManager,
  onOpenRename,
  onRename,
  panel,
  projects,
  user,
}: ProjectManagementSheetProps) {
  const [actionError, setActionError] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);

  if (panel.type === 'createProject') {
    return (
      <ProjectNameSheet
        initialName=""
        intentScope="PROJECT_CREATE"
        onBack={onOpenManager}
        onSave={onCreate}
        title="新建项目"
      />
    );
  }

  if (panel.type === 'renameProject') {
    const project = projects.find((item) => item.id === panel.projectId);
    if (!project) return null;
    return (
      <ProjectNameSheet
        initialName={project.name}
        intentScope={`PROJECT_RENAME:${project.id}:${project.version}`}
        onBack={onOpenManager}
        onSave={(name, idempotencyKey) => onRename(project, name, idempotencyKey)}
        title="项目改名"
      />
    );
  }

  if (panel.type === 'archiveProjectConfirm') {
    const project = projects.find((item) => item.id === panel.projectId);
    if (!project) return null;
    return <ArchiveProjectSheet onArchive={onArchive} onBack={onOpenManager} project={project} />;
  }

  return (
    <BottomSheet
      className="projectSheet"
      description="项目颜色自动分配，只表示归属，不代表优先级。"
      title="项目管理"
    >
      <Button
        role="button"
        aria-label="关闭项目管理"
        className="sheetClose"
        onClick={onClose}
        tabIndex={0}
      >
        ×
      </Button>
      <ElectricButton
        ariaLabel="新建项目"
        className="newProject"
        onClick={onOpenCreate}
        variant="ink"
      >
        + 新建项目
      </ElectricButton>
      <View className="projectRows productionProjectRows">
        {projects.length === 0 ? (
          <Text className="projectEmpty">还没有项目，新建后就可以给待办分类。</Text>
        ) : (
          projects.map((project) => (
            <View className="projectRow" key={project.id}>
              <View
                aria-hidden
                className={`projectIdentityDot projectIdentityDot_${project.colorKey}`}
              />
              <View className="projectCopy">
                <Text>{project.name}</Text>
                <Text>{project.taskCount} 个待办</Text>
              </View>
              <Button
                role="button"
                aria-label={`改名项目：${project.name}`}
                onClick={() => onOpenRename(project.id)}
                tabIndex={0}
              >
                改名
              </Button>
              <Button
                role="button"
                aria-label={`归档项目：${project.name}`}
                onClick={() => onOpenArchive(project.id)}
                tabIndex={0}
              >
                归档
              </Button>
            </View>
          ))
        )}
      </View>
      <View className="accountSummary">
        <Text>当前账号</Text>
        <Text>{user.username}</Text>
        <Text>页面昵称：{user.nickname}</Text>
      </View>
      {actionError ? <Text className="formError">{actionError}</Text> : null}
      <View className="sheetActions stickyActions">
        <ElectricButton
          ariaLabel="退出登录"
          disabled={isWorking}
          onClick={() => {
            setActionError(null);
            setIsWorking(true);
            void onLogout()
              .catch((error: unknown) =>
                setActionError(error instanceof Error ? error.message : '退出失败'),
              )
              .finally(() => setIsWorking(false));
          }}
          variant="secondary"
        >
          {isWorking ? '退出中…' : '退出登录'}
        </ElectricButton>
        <ElectricButton ariaLabel="完成项目管理" onClick={onClose}>
          完成
        </ElectricButton>
      </View>
    </BottomSheet>
  );
}
