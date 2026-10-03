import { createServer } from 'node:http';

const port = Number(process.env.AGENT_STUB_PORT ?? 14001);
const serviceToken = process.env.AGENT_SERVICE_TOKEN;

if (!serviceToken) throw new Error('AGENT_SERVICE_TOKEN is required for the E2E Agent stub');

function json(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-length': Buffer.byteLength(payload),
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(payload);
}

function taskDraft(index) {
  return {
    clientRef: `draft_${index.toString(16).padStart(16, '0')}`,
    title: index === 1 ? '整理需求清单' : '完成方案评审',
    description: null,
    priority: index === 1 ? 'HIGH' : 'MEDIUM',
    scheduledAt: null,
    deadlineAt: null,
    reminderAt: null,
  };
}

function resultFor(request) {
  const messages = Array.isArray(request.messages) ? request.messages : [];
  const lastMessage = messages.at(-1)?.content ?? '';
  const candidates = Array.isArray(request.candidates) ? request.candidates : [];
  const taskCandidates = candidates.filter((candidate) => candidate.kind === 'TASK');
  const projectCandidates = candidates.filter((candidate) => candidate.kind === 'PROJECT');

  if (request.capabilityCode === 'agent.planGeneration') {
    const existingProject = projectCandidates[0];
    return {
      type: 'PLAN',
      title: 'Agent 测试计划',
      project: existingProject
        ? { type: 'EXISTING', candidateRef: existingProject.candidateRef }
        : { type: 'NEW', name: 'Agent 计划' },
      tasks: [taskDraft(1), taskDraft(2)],
    };
  }

  if (lastMessage.includes('需要澄清')) {
    return {
      type: 'CLARIFICATION',
      question: '你希望优先处理哪一类事情？',
      options: [
        { optionId: 'opt_0000000000000001', label: '工作', nextStep: 'AGENT_STANDARD' },
        { optionId: 'opt_0000000000000002', label: '生活', nextStep: 'DETERMINISTIC' },
      ],
      allowFreeText: true,
    };
  }

  if (lastMessage.includes('候选') && taskCandidates.length >= 2) {
    return {
      type: 'CANDIDATES',
      question: '你指的是哪一项待办？',
      options: taskCandidates.slice(0, 2).map((candidate, index) => ({
        optionId: `opt_${(index + 1).toString(16).padStart(16, '0')}`,
        candidateRef: candidate.candidateRef,
        label: candidate.label,
      })),
    };
  }

  if (lastMessage.includes('整理未归属') && taskCandidates[0] && projectCandidates[0]) {
    return {
      type: 'ACTION_PROPOSAL',
      actionCode: 'ORGANIZE_TASKS',
      summary: '将未归属待办整理到项目',
      mutations: taskCandidates.slice(0, 20).map((candidate) => ({
        operation: 'ORGANIZE_TASK',
        targetRef: candidate.candidateRef,
        projectRef: projectCandidates[0].candidateRef,
        expectedVersion: candidate.version,
      })),
    };
  }

  if (lastMessage.includes('完成待办') && taskCandidates[0]) {
    return {
      type: 'ACTION_PROPOSAL',
      actionCode: 'COMPLETE_TASK',
      summary: `完成「${taskCandidates[0].label}」`,
      mutations: [
        {
          operation: 'COMPLETE_TASK',
          targetRef: taskCandidates[0].candidateRef,
          expectedVersion: taskCandidates[0].version,
        },
      ],
    };
  }

  if (lastMessage.includes('删除待办') && taskCandidates[0]) {
    return {
      type: 'ACTION_PROPOSAL',
      actionCode: 'DELETE_TASK',
      summary: `删除「${taskCandidates[0].label}」`,
      mutations: [
        {
          operation: 'DELETE_TASK',
          targetRef: taskCandidates[0].candidateRef,
          expectedVersion: taskCandidates[0].version,
        },
      ],
    };
  }

  if (lastMessage.includes('验证上下文')) {
    return {
      type: 'REPLY',
      text:
        messages.some((message) => message.content.includes('这件事需要澄清')) &&
        messages.some((message) => message.content.includes('第一轮补充'))
          ? '已关联前文的澄清和第一轮补充。'
          : '上下文缺失。',
      offerPlan: false,
    };
  }

  return {
    type: 'REPLY',
    text: '我已经理解你的目标，可以继续为你生成计划。',
    offerPlan: true,
  };
}

const server = createServer((request, response) => {
  if (request.method === 'GET' && request.url?.startsWith('/internal/health/')) {
    json(response, 200, { status: 'ok' });
    return;
  }

  if (
    request.method !== 'POST' ||
    !['/internal/v1/agent/execute', '/internal/v2/agent/execute'].includes(request.url)
  ) {
    json(response, 404, { error: { code: 'NOT_FOUND', message: 'Not found' } });
    return;
  }
  if (request.headers.authorization !== `Bearer ${serviceToken}`) {
    json(response, 401, { error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
    return;
  }

  const chunks = [];
  let size = 0;
  request.on('data', (chunk) => {
    size += chunk.length;
    if (size <= 256 * 1024) chunks.push(chunk);
  });
  request.on('end', async () => {
    if (size > 256 * 1024) {
      json(response, 413, { error: { code: 'REQUEST_TOO_LARGE', message: 'Too large' } });
      return;
    }
    try {
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (input.contractVersion === '2.0') {
        const read = async (resource, limit) => {
          const reply = await fetch(
            `${process.env.AGENT_CONTEXT_URL}/internal/v2/agent/context/read`,
            {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${process.env.AGENT_CONTEXT_SERVICE_TOKEN}`,
              },
              body: JSON.stringify({ requestId: input.requestId, resource, limit }),
            },
          );
          if (!reply.ok) throw new Error('context unavailable');
          return reply.json();
        };
        input.messages = (await read('MESSAGES', 20)).messages.reverse();
        input.candidates = [
          ...(await read('TASKS', 50)).candidates,
          ...(await read('PROJECTS', 30)).candidates,
        ];
      }
      json(response, 200, {
        contractVersion: input.contractVersion,
        requestId: input.requestId,
        resolved: {
          provider: 'DEEPSEEK',
          model: 'e2e-stub',
          promptVersion: 'e2e-v1',
          providerSchemaVersion: 'e2e-v1',
          repairAttempts: 0,
        },
        result: resultFor(input),
      });
    } catch {
      json(response, 422, { error: { code: 'VALIDATION_ERROR', message: 'Invalid request' } });
    }
  });
});

server.listen(port, '127.0.0.1');

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
