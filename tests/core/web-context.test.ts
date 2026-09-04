/**
 * THE CONTEXT PASS, over a real working tree — the adapter half of item 105.
 *
 * The RULES of the pack are pinned in `tests/interface-mapper/web-context.test.ts`
 * over synthetic analyses. What this file asserts is the join between the three
 * things the adapter wires together and nothing else can: the tree analysis, the
 * place ids (which must be the same ids the catalog on disk carries, or the pack
 * addresses nobody), and the analyzer's module resolution turning an import
 * SPECIFIER into a file.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deriveWebAuthoringContext } from '../../packages/core/src/services/web-context.service';
import type { InterfacesFile } from '../../packages/shared/src/index';

let repo: string;

const CATALOG: InterfacesFile = {
  version: 2,
  generatedAt: '2026-08-17T00:00:00.000Z',
  recipeFingerprint: 'sha256:recipe',
  interfaces: [
    {
      id: 'api/get-api-tasks',
      type: 'api',
      title: 'list tasks',
      entry: { method: 'GET', path: '/api/tasks' },
      steps: [{ kind: 'request', method: 'GET', path: '/api/tasks' }],
      fingerprint: 'sha256:api-get-tasks',
    },
  ],
};

/** A Next.js app-router tree: two screens, one shared view, one api client. */
function writeApp(): void {
  write('next.config.js', 'module.exports = {}\n');
  write(
    'app/tasks/page.tsx',
    `import { TaskList } from '../../components/task-list'
export default function TasksPage() {
  return <TaskList />
}
`,
  );
  write(
    'components/task-list.tsx',
    `import { listTasks } from '../lib/api-client'
export function TaskList() {
  return <button onClick={() => listTasks()}>Refresh</button>
}
`,
  );
  write(
    'lib/api-client.ts',
    `export async function listTasks() {
  return fetch('/api/tasks')
}
export async function createTask(title: string) {
  return fetch('/api/tasks', { method: 'POST', body: title })
}
`,
  );
}

function write(relative: string, contents: string): void {
  const target = path.join(repo, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

beforeEach(() => {
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tc-web-context-')));
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('deriveWebAuthoringContext', () => {
  it('grounds each derived place in the module that renders it and the api it calls', async () => {
    writeApp();
    const { contexts, files } = await deriveWebAuthoringContext(repo, { catalog: CATALOG });

    expect(files).toBeGreaterThan(0);
    const tasks = contexts.get('tasks');
    expect(tasks?.module).toBe('app/tasks/page.tsx');
    expect(tasks?.renders).toEqual(['components/task-list.tsx']);
    // The api client is in the closure though it is not a view — which is what
    // makes the join reach it. `listTasks` is imported by name, so its request is
    // this place's effect; `createTask`, which nobody imported, is not.
    expect(tasks?.apiEffects).toEqual(['api/get-api-tasks']);
  });

  it('returns an empty pack for a repository with no web places at all', async () => {
    write('src/index.ts', 'export const noop = () => {}\n');
    const { contexts } = await deriveWebAuthoringContext(repo, { catalog: CATALOG });
    expect(contexts.size).toBe(0);
  });
});
