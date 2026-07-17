import { readdir, readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { DatabaseModule } from './database.module.js';
import { DatabaseUnitOfWork, UNIT_OF_WORK } from './unit-of-work.js';

describe('UnitOfWork application boundary', () => {
  it('exposes the application UnitOfWork token as an alias of the database adapter', () => {
    const module = DatabaseModule.register('postgresql://unused');

    expect(module.providers).toEqual(
      expect.arrayContaining([{ provide: UNIT_OF_WORK, useExisting: DatabaseUnitOfWork }]),
    );
    expect(module.exports).toEqual(expect.arrayContaining([UNIT_OF_WORK]));
  });

  it('prevents Agent implementations from importing database infrastructure', async () => {
    const agentDirectory = new URL('../../modules/agent/', import.meta.url);
    const files = await implementationFiles(agentDirectory);

    const violations: string[] = [];
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      for (const forbidden of [
        '@ai-schedule/db',
        'DatabaseService',
        'DatabaseUnitOfWork',
        '.clientFor(',
      ]) {
        if (source.includes(forbidden)) violations.push(`${file.pathname}: ${forbidden}`);
      }
    }

    expect(violations).toEqual([]);
  });

  it('keeps task and project reads behind transaction-scoped module ports', async () => {
    const persistence = await readFile(
      new URL('../agent/prisma-agent.persistence.ts', import.meta.url),
      'utf8',
    );

    expect(persistence).not.toMatch(/transaction\.(?:task|project)\b/);
    expect(persistence).not.toMatch(/database\.client\.(?:task|project)\b/);
  });
});

async function implementationFiles(directory: URL): Promise<URL[]> {
  const files: URL[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const url = new URL(entry.name, directory);
    if (entry.isDirectory()) {
      files.push(...(await implementationFiles(new URL(`${entry.name}/`, directory))));
    } else if (
      entry.isFile() &&
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.spec.ts')
    ) {
      files.push(url);
    }
  }
  return files;
}
