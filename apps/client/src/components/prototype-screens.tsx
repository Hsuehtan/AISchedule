import { Button, Input, Text, Textarea, View } from '@tarojs/components';
import {
  AppShell,
  BottomSheet,
  Dialog,
  ElectricButton,
  SmartInboxCard,
  StatusBar,
  TaskRow,
  UndoToast,
  type TaskProjectColor,
} from '@ai-schedule/ui';

import {
  prototypeActionProposal,
  prototypePlan,
  prototypeProjects,
  prototypeTasks,
} from '../prototype-fixtures';
import type { PrototypeScreen } from '../prototype-state';
import './prototype-screens.scss';

type PrototypeScreensProps = {
  onNavigate: (screen: PrototypeScreen) => void;
  screen: PrototypeScreen;
};

type PresentedTask = {
  color: TaskProjectColor;
  meta: string;
  project: string;
  time: string;
};

const taskPresentation: Record<string, PresentedTask> = {
  写周报: {
    color: 'pink',
    meta: '明天截止 · 20:00 提醒',
    project: '工作',
    time: '09:30',
  },
  交物业费: {
    color: 'teal',
    meta: '今天截止 · 无提醒',
    project: '生活',
    time: '今天',
  },
  准备体检表: {
    color: 'purple',
    meta: '周五截止 · 无提醒',
    project: '上学',
    time: '周五',
  },
  买牛奶: {
    color: 'cyan',
    meta: '无 Deadline',
    project: '未归属',
    time: '待定',
  },
  提交报名表: {
    color: 'teal',
    meta: '昨天完成 · 孩子上学',
    project: '生活',
    time: '完成',
  },
};

function LoginScreen({ onLogin }: { onLogin: () => void }) {
  return (
    <AppShell className={'loginScreen'}>
      <StatusBar />
      <View className={'loginHero'}>
        <View aria-hidden className={'brandMark'}>
          ✓
        </View>
        <Text className={'loginTitle'}>把杂事收进今天</Text>
        <Text className={'loginCopy'}>
          一句话创建、拆解、归档项目待办。{`\n`}保持简单，只做真正会用的链路。
        </Text>
      </View>
      <View className={'todayPreview'}>
        <Text className={'previewEyebrow'}>今日编排</Text>
        <Text className={'previewTitle'}>2 件事，已经等你确认</Text>
        <Text className={'previewCopy'}>Smart Inbox 已为你补全时间和项目。</Text>
        <View className={'previewTasks'}>
          <View className={'previewTask'}>写周报</View>
          <View className={`${'previewTask'} ${'previewTaskAction'}`}>交物业费</View>
        </View>
      </View>
      <View className={'loginCard'}>
        <Text className={'formTitle'}>欢迎回来</Text>
        <Text className={'formDescription'}>继续今天的安排</Text>
        <Input aria-label="用户名" className={'loginInput'} maxlength={32} placeholder="用户名" />
        <Input aria-label="密码" className={'loginInput'} password placeholder="密码" />
        <ElectricButton ariaLabel="登录" className={'loginButton'} onClick={onLogin}>
          登录
        </ElectricButton>
        <Button role="button" aria-label="注册新账号" className={'registerLink'} onClick={onLogin}>
          没有账号？注册
        </Button>
      </View>
    </AppShell>
  );
}

function EditorialHeader({ countLabel, title }: { countLabel?: string; title: string }) {
  return (
    <View className={'editorialHeader'}>
      <Text className={'dateLabel'}>{countLabel ?? '6月25日 · 周四'}</Text>
      <Text className={'pageTitle'}>{title}</Text>
    </View>
  );
}

function AddButton({ onClick }: { onClick: () => void }) {
  return (
    <Button role="button" aria-label="新增待办" className={'addButton'} onClick={onClick}>
      +
    </Button>
  );
}

const chips: Array<{ color: TaskProjectColor; id: PrototypeScreen; label: string }> = [
  { color: 'cyan', id: 'all-todos', label: '全部' },
  { color: 'pink', id: 'work-project', label: '工作' },
  { color: 'teal', id: 'all-todos', label: '生活' },
  { color: 'purple', id: 'all-todos', label: '孩子' },
  { color: 'amber', id: 'all-todos', label: '面试' },
];

function ProjectChips({
  active,
  onNavigate,
}: {
  active: string;
  onNavigate: (screen: PrototypeScreen) => void;
}) {
  return (
    <View aria-label="项目筛选" className={'projectChips'} role="group">
      {chips.map((chip) => (
        <Button
          role="button"
          aria-pressed={active === chip.label}
          className={'chipHit'}
          key={chip.label}
          onClick={() => onNavigate(chip.id)}
        >
          <View className={`${'chip'} ${active === chip.label ? 'chipActive' : ''}`}>
            <View aria-hidden className={`projectFilterDot projectFilterDot_${chip.color}`} />
            <Text className={'projectChipLabel'}>{chip.label}</Text>
          </View>
        </Button>
      ))}
    </View>
  );
}

function TaskTimeline({
  empty,
  expanded,
  onComplete,
  onOpenTask,
  onToggleDone,
  workOnly,
}: {
  empty: boolean;
  expanded: boolean;
  onComplete: () => void;
  onOpenTask: () => void;
  onToggleDone: () => void;
  workOnly: boolean;
}) {
  const openTasks = prototypeTasks.filter((task) => {
    if (task.status !== 'TODO') return false;
    if (!workOnly) return true;
    return task.title === '写周报';
  });
  const completedTask = prototypeTasks.find((task) => task.status === 'COMPLETED');

  if (empty) {
    return (
      <View className={'emptyCard'}>
        <View aria-hidden className={'emptyCheck'}>
          ✓
        </View>
        <Text className={'emptyTitle'}>今天的事情都处理好了</Text>
        <Text className={'emptyCopy'}>休息一下，或者把明天的事情提前安排。</Text>
        <ElectricButton ariaLabel="创建一件新事情" onClick={onOpenTask}>
          收进一件新事情
        </ElectricButton>
      </View>
    );
  }

  return (
    <View className={'timeline'}>
      <Text className={'timelineLabel'}>时间线</Text>
      <View className={'taskList'}>
        {openTasks.map((task) => {
          const presentation = taskPresentation[task.title];
          if (!presentation) return null;
          return (
            <TaskRow
              id={task.id}
              key={task.id}
              meta={presentation.meta}
              onComplete={onComplete}
              onOpen={onOpenTask}
              priority={task.priority.toLowerCase() as 'high' | 'medium' | 'low'}
              project={presentation.project}
              projectColor={presentation.color}
              time={presentation.time}
              title={task.title}
            />
          );
        })}
      </View>
      <Button
        role="button"
        aria-expanded={expanded}
        className={'completedFold'}
        onClick={onToggleDone}
      >
        <Text>已完成 1 项</Text>
        <Text>{expanded ? '⌄' : '›'}</Text>
      </Button>
      {expanded && completedTask ? (
        <View className={'completedTask'}>
          <TaskRow
            completed
            id={completedTask.id}
            meta={taskPresentation[completedTask.title]?.meta ?? '已完成'}
            priority={completedTask.priority.toLowerCase() as 'high' | 'medium' | 'low'}
            project={taskPresentation[completedTask.title]?.project ?? '生活'}
            projectColor={taskPresentation[completedTask.title]?.color ?? 'teal'}
            time={taskPresentation[completedTask.title]?.time ?? '完成'}
            title={completedTask.title}
          />
        </View>
      ) : null}
    </View>
  );
}

function CommandComposer({ onText, onVoice }: { onText: () => void; onVoice: () => void }) {
  return (
    <View className={'commandComposer'}>
      <Text aria-hidden className={'composerSpark'}>
        ✦
      </Text>
      <Button
        role="button"
        aria-label="使用文字告诉 Agent"
        className={'composerCopy'}
        onClick={onText}
      >
        <Text className={'composerTitle'}>告诉我下一件事</Text>
        <Text className={'composerHint'}>输入文字，或按住说话</Text>
      </Button>
      <Button role="button" aria-label="打开文字输入" className={'keyboardButton'} onClick={onText}>
        ⌨
      </Button>
      <Button role="button" aria-label="打开语音输入" className={'voiceButton'} onClick={onVoice}>
        ◉
      </Button>
    </View>
  );
}

function TextInputSheet({ onNavigate }: Pick<PrototypeScreensProps, 'onNavigate'>) {
  const examples = [
    '我最近要准备产品经理面试，帮我拆一下',
    '把工作里的周报标记完成',
    '把周报改成高优先级',
  ];
  return (
    <BottomSheet
      description="输入自然语言，Agent 会识别项目和待办操作。"
      title="想让我帮你做什么？"
    >
      <View className={'exampleList'}>
        {examples.map((example) => (
          <Button role="button" className={'examplePrompt'} key={example}>
            {example}
          </Button>
        ))}
      </View>
      <Textarea
        aria-label="告诉 Agent 的内容"
        className={'commandInput'}
        maxlength={500}
        placeholder="输入文字..."
      />
      <View className={'sheetActions'}>
        <ElectricButton
          ariaLabel="取消文字输入"
          onClick={() => onNavigate('all-todos')}
          variant="secondary"
        >
          取消
        </ElectricButton>
        <ElectricButton ariaLabel="发送给 Agent" onClick={() => onNavigate('candidates')}>
          发送
        </ElectricButton>
      </View>
    </BottomSheet>
  );
}

function VoiceInputSheet({ onNavigate }: Pick<PrototypeScreensProps, 'onNavigate'>) {
  return (
    <BottomSheet
      description="语音输入会先转成文字，再进入 Agent 文本处理流程。"
      title="正在聆听..."
    >
      <View aria-label="录音波形" className={'waveform'} role="img">
        {[16, 36, 54, 26, 42, 62, 32, 50, 24, 58, 38, 68, 44].map((height, index) => (
          <View className={'waveBar'} key={`${height}-${index}`} style={{ height }} />
        ))}
      </View>
      <Text className={'voiceHint'}>识别结果</Text>
      <View className={'transcript'}>把工作里的周报标记完成</View>
      <View className={'sheetActions'}>
        <ElectricButton
          ariaLabel="重新录音"
          onClick={() => onNavigate('voice-input')}
          variant="secondary"
        >
          重新说
        </ElectricButton>
        <ElectricButton ariaLabel="确认处理语音" onClick={() => onNavigate('agent-confirm')}>
          确认处理
        </ElectricButton>
      </View>
    </BottomSheet>
  );
}

function CandidateContent({ clarify = false }: { clarify?: boolean }) {
  return (
    <View className={'conversation'}>
      <View className={'userBubble'}>周报处理一下</View>
      <View className={'agentBubble'}>
        <Text className={'messageTag'}>Agent {clarify ? '需要确认' : '找到多个候选'}</Text>
        <Text>{clarify ? '你想让这份周报怎么处理？' : '我还不确定你指的是哪一个周报。'}</Text>
      </View>
      <View className={'candidateCard'}>
        <Text className={'messageTag'}>请选择待办</Text>
        <Button role="button" className={'candidateRow'}>
          <View>
            <Text className={'candidateTitle'}>写周报</Text>
            <Text className={'candidateMeta'}>工作 · 明天截止</Text>
          </View>
          <Text className={'candidateBadge'}>选中</Text>
        </Button>
        <Button role="button" className={'candidateRow'}>
          <View>
            <Text className={'candidateTitle'}>周报模板整理</Text>
            <Text className={'candidateMeta'}>工作 · 无时间</Text>
          </View>
        </Button>
      </View>
    </View>
  );
}

function CandidateDialog({
  clarify = false,
  onNavigate,
}: Pick<PrototypeScreensProps, 'onNavigate'> & { clarify?: boolean }) {
  return (
    <Dialog
      description="对话、澄清、生成操作草稿"
      onClose={() => onNavigate('all-todos')}
      title={clarify ? 'Agent 澄清' : '选择要处理的待办'}
    >
      <CandidateContent clarify={clarify} />
      <View className={'dialogComposer'}>
        <Input aria-label="补充说明" placeholder="继续补充或修正..." />
        <ElectricButton ariaLabel="发送补充说明" onClick={() => onNavigate('agent-confirm')}>
          发送
        </ElectricButton>
      </View>
    </Dialog>
  );
}

function PlanSheet({ onNavigate }: Pick<PrototypeScreensProps, 'onNavigate'>) {
  return (
    <BottomSheet
      className={'planSheet'}
      description="识别到一个新项目，先确认再批量创建。"
      title="计划草稿"
    >
      <View className={'projectSummary'}>
        <Text aria-hidden className={'folderIcon'}>
          □
        </Text>
        <View>
          <Text className={'projectSummaryTitle'}>产品经理面试</Text>
          <Text className={'projectSummaryMeta'}>5 项待办 · 2 项建议高优先级</Text>
        </View>
      </View>
      <View className={'planList'}>
        {prototypePlan.map((item, index) => (
          <View className={'planRow'} key={item.title}>
            <Text className={'planIndex'}>{index + 1}</Text>
            <Text className={'planTitle'}>{item.title}</Text>
            {item.priority !== 'none' ? (
              <Text className={`priorityBadge priorityBadge_${item.priority}`}>
                {item.priority === 'high' ? '高' : item.priority === 'medium' ? '中' : '低'}
              </Text>
            ) : null}
            <Button role="button" aria-label={`编辑${item.title}`} className={'editLink'}>
              编辑
            </Button>
          </View>
        ))}
      </View>
      <View className={'sheetActions'}>
        <ElectricButton ariaLabel="重新生成计划" variant="secondary">
          再改一下
        </ElectricButton>
        <ElectricButton ariaLabel="确认创建五项待办" onClick={() => onNavigate('agent-confirm')}>
          创建 5 项
        </ElectricButton>
      </View>
    </BottomSheet>
  );
}

function AgentConfirmDialog({ onNavigate }: Pick<PrototypeScreensProps, 'onNavigate'>) {
  const mutation = prototypeActionProposal.mutations[0];
  return (
    <Dialog
      description="对话、澄清、生成 Action Draft"
      onClose={() => onNavigate('all-todos')}
      title="确认 Agent 操作"
    >
      <View className={'confirmThread'}>
        <View className={'userBubble'}>周报处理一下</View>
        <View className={'agentBubble'}>
          <Text className={'messageTag'}>Agent 文字回复气泡</Text>
          <Text>好的，我先整理成一个可确认的操作草稿。确认前不会修改待办。</Text>
        </View>
        <View className={'confirmCard'}>
          <Text className={'confirmType'}>类型 3 · Agent 操作确认卡</Text>
          <Text className={'confirmTitle'}>准备执行：新建待办</Text>
          <View className={'confirmDetail'}>
            <Text>操作对象</Text>
            <Text>工作 / 本周周报</Text>
            <Text>字段变化</Text>
            <Text>{mutation?.type === 'CREATE_TASK' ? mutation.input.title : '新增待办'}</Text>
            <Text>展示变化</Text>
            <Text>{prototypeActionProposal.summary}</Text>
          </View>
          <View className={'sheetActions'}>
            <ElectricButton ariaLabel="继续对话" variant="secondary">
              继续对话
            </ElectricButton>
            <ElectricButton
              ariaLabel="确认执行 Agent 操作"
              onClick={() => onNavigate('toast-undo')}
            >
              确认执行
            </ElectricButton>
          </View>
        </View>
      </View>
    </Dialog>
  );
}

function TaskEditSheet({ onNavigate }: Pick<PrototypeScreensProps, 'onNavigate'>) {
  return (
    <BottomSheet description="字段由你最终确认。" title="编辑待办">
      <View className={'formGrid'}>
        <Text>标题</Text>
        <Input aria-label="待办标题" value="写周报" />
        <Text>所属项目</Text>
        <Input aria-label="所属项目" value="工作" />
        <Text>优先级</Text>
        <Input aria-label="优先级" value="高" />
        <Text>描述</Text>
        <Textarea aria-label="待办描述" value="可为空" />
        <Text>截止时间</Text>
        <Input aria-label="截止时间" value="明天截止" />
        <Text>提醒时间</Text>
        <Input aria-label="提醒时间" value="20:00 提醒" />
      </View>
      <View className={'sheetActions'}>
        <ElectricButton ariaLabel="删除待办" variant="danger">
          删除
        </ElectricButton>
        <ElectricButton ariaLabel="保存待办" onClick={() => onNavigate('all-todos')}>
          保存
        </ElectricButton>
      </View>
    </BottomSheet>
  );
}

function ProjectManagementSheet({ onNavigate }: Pick<PrototypeScreensProps, 'onNavigate'>) {
  return (
    <BottomSheet
      className={'projectSheet'}
      description="归档项目后从筛选 Bar 隐藏，但其待办仍可在「全部」看到。"
      title="项目管理"
    >
      <ElectricButton ariaLabel="新建项目" className={'newProject'} variant="ink">
        + 新建项目
      </ElectricButton>
      <View className={'projectRows'}>
        {prototypeProjects.slice(0, 3).map((project) => (
          <View className={'projectRow'} key={project.id}>
            <View aria-hidden className={'projectDot'} />
            <View className={'projectCopy'}>
              <Text>{project.name}</Text>
              <Text>{project.taskCount} 个待办</Text>
            </View>
            <Button role="button" aria-label={`改名${project.name}`}>
              改名
            </Button>
            <Button role="button" aria-label={`归档${project.name}`}>
              归档
            </Button>
          </View>
        ))}
      </View>
      <ElectricButton ariaLabel="完成项目管理" onClick={() => onNavigate('all-todos')}>
        完成
      </ElectricButton>
    </BottomSheet>
  );
}

function QuotaSheet({ onNavigate }: Pick<PrototypeScreensProps, 'onNavigate'>) {
  return (
    <BottomSheet
      className={'quotaSheet'}
      description="用户剩余积分为 0，Agent、语音或其他智能处理暂不可用。"
      title="智能处理暂不可用"
    >
      <View className={'quotaWarning'}>
        <Text>今日智能处理次数已达体验上限</Text>
        <Text>明天可以继续使用。</Text>
      </View>
      <ElectricButton ariaLabel="知道了" onClick={() => onNavigate('all-todos')}>
        知道了
      </ElectricButton>
    </BottomSheet>
  );
}

function ScreenOverlay({ onNavigate, screen }: PrototypeScreensProps) {
  switch (screen) {
    case 'agent-plan':
      return <PlanSheet onNavigate={onNavigate} />;
    case 'text-input':
      return <TextInputSheet onNavigate={onNavigate} />;
    case 'voice-input':
      return <VoiceInputSheet onNavigate={onNavigate} />;
    case 'candidates':
      return <CandidateDialog onNavigate={onNavigate} />;
    case 'agent-clarify':
      return <CandidateDialog clarify onNavigate={onNavigate} />;
    case 'agent-confirm':
      return <AgentConfirmDialog onNavigate={onNavigate} />;
    case 'task-edit':
      return <TaskEditSheet onNavigate={onNavigate} />;
    case 'project-management':
      return <ProjectManagementSheet onNavigate={onNavigate} />;
    case 'quota-limit':
      return <QuotaSheet onNavigate={onNavigate} />;
    default:
      return null;
  }
}

function TodoScreen({ onNavigate, screen }: PrototypeScreensProps) {
  const workOnly = screen === 'work-project';
  const empty = screen === 'empty-state';
  const expanded = screen === 'done-expanded';
  const title = workOnly ? '工作 · 1 件待办' : empty ? '今天已经清空' : '今天先处理 4 件事';

  return (
    <AppShell className={'todoScreen'}>
      <StatusBar />
      <EditorialHeader title={title} />
      <AddButton onClick={() => onNavigate('text-input')} />
      <SmartInboxCard
        onOrganize={() => onNavigate('agent-plan')}
        {...(empty ? { body: '没有待处理建议。明天的事项会在合适时机出现。' } : {})}
      />
      <ProjectChips active={workOnly ? '工作' : '全部'} onNavigate={onNavigate} />
      <TaskTimeline
        empty={empty}
        expanded={expanded}
        onComplete={() => onNavigate('toast-undo')}
        onOpenTask={() => onNavigate('task-edit')}
        onToggleDone={() => onNavigate(expanded ? 'all-todos' : 'done-expanded')}
        workOnly={workOnly}
      />
      {screen === 'toast-undo' ? (
        <UndoToast message="已完成「写周报」" onUndo={() => onNavigate('all-todos')} />
      ) : null}
      <CommandComposer
        onText={() => onNavigate('text-input')}
        onVoice={() => onNavigate('voice-input')}
      />
      <ScreenOverlay onNavigate={onNavigate} screen={screen} />
    </AppShell>
  );
}

export function PrototypeScreens({ onNavigate, screen }: PrototypeScreensProps) {
  if (screen === 'login') {
    return <LoginScreen onLogin={() => onNavigate('all-todos')} />;
  }

  return <TodoScreen onNavigate={onNavigate} screen={screen} />;
}
