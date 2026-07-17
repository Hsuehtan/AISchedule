import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  MAX_PROJECT_CANDIDATES,
  MAX_TASK_CANDIDATES,
  MESSAGE_CONTENT_MAX_BYTES,
  executeRequestSchema,
  executeResponseSchema,
} from './generated/internal-agent-v1.js';

const fixtureRoot = resolve(process.cwd(), 'internal-agent/v1/fixtures');

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(resolve(fixtureRoot, name), 'utf8')) as unknown;
}

type RequestPolicyFixture = {
  candidateKindCases: Array<{
    accepted: boolean;
    name: string;
    projects: number;
    tasks: number;
  }>;
  messageContentCases: Array<{
    accepted: boolean;
    expectedBytes: number;
    messages: Array<{ repeat: number; role: 'ASSISTANT' | 'USER'; suffix: string; unit: string }>;
    name: string;
  }>;
};

type UnicodeLengthFixture = {
  replyTextCases: Array<{
    accepted: boolean;
    expectedCodePoints: number;
    name: string;
    repeat: number;
    suffix: string;
    unit: string;
  }>;
};

const baseRequest = fixture('execute-request.standard.json') as Record<string, unknown>;
const policy = fixture('request-policy-boundaries.json') as RequestPolicyFixture;
const unicodeLengthPolicy = fixture('unicode-length-boundaries.json') as UnicodeLengthFixture;

describe('generated internal Agent v1 contract', () => {
  it.each(['execute-request.standard.json', 'execute-request.plan.json'])(
    'accepts request fixture %s',
    (name) => {
      expect(() => executeRequestSchema.parse(fixture(name))).not.toThrow();
    },
  );

  it.each([
    'execute-response.reply.json',
    'execute-response.clarification.json',
    'execute-response.candidates.json',
    'execute-response.plan.json',
    'execute-response.action-proposal.json',
  ])('accepts response fixture %s', (name) => {
    expect(() => executeResponseSchema.parse(fixture(name))).not.toThrow();
  });

  it('rejects unknown business and billing identifiers', () => {
    const request = fixture('execute-request.standard.json');

    expect(() =>
      executeRequestSchema.parse({ ...(request as object), userId: 'forbidden' }),
    ).toThrow();
    expect(() =>
      executeRequestSchema.parse({ ...(request as object), reservationId: 'forbidden' }),
    ).toThrow();
  });

  it.each(policy.messageContentCases)(
    '$name follows the canonical message byte policy',
    (testCase) => {
      const messages = testCase.messages.map((message) => ({
        role: message.role,
        content: message.unit.repeat(message.repeat) + message.suffix,
      }));
      const bytes = messages.reduce(
        (total, message) => total + new TextEncoder().encode(message.content).byteLength,
        0,
      );

      expect(bytes).toBe(testCase.expectedBytes);
      expect(executeRequestSchema.safeParse({ ...baseRequest, messages }).success).toBe(
        testCase.accepted,
      );
    },
  );

  it.each(policy.candidateKindCases)(
    '$name follows canonical per-kind candidate limits',
    (testCase) => {
      const candidates = [
        ...Array.from({ length: testCase.tasks }, (_, index) => ({
          candidateRef: `cand_${index.toString(16).padStart(32, '0')}`,
          kind: 'TASK',
          label: `任务 ${index}`,
          version: 1,
        })),
        ...Array.from({ length: testCase.projects }, (_, index) => ({
          candidateRef: `cand_${(index + MAX_TASK_CANDIDATES + 1).toString(16).padStart(32, '0')}`,
          kind: 'PROJECT',
          label: `项目 ${index}`,
          version: 1,
        })),
      ];

      expect(executeRequestSchema.safeParse({ ...baseRequest, candidates }).success).toBe(
        testCase.accepted,
      );
    },
  );

  it('generates the locked policy constants from OpenAPI extensions', () => {
    expect(MESSAGE_CONTENT_MAX_BYTES).toBe(12_288);
    expect(MAX_TASK_CANDIDATES).toBe(50);
    expect(MAX_PROJECT_CANDIDATES).toBe(30);
  });

  it.each(unicodeLengthPolicy.replyTextCases)(
    '$name follows JSON Schema Unicode code-point length semantics',
    (testCase) => {
      const response = fixture('execute-response.reply.json') as {
        result: { text: string };
      };
      const text = testCase.unit.repeat(testCase.repeat) + testCase.suffix;
      response.result.text = text;

      expect(Array.from(text)).toHaveLength(testCase.expectedCodePoints);
      expect(executeResponseSchema.safeParse(response).success).toBe(testCase.accepted);
    },
  );
});
