/**
 * THE CONTEXT PASS, over a real working tree — the adapter half.
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
import { mapInterfaces } from '../../packages/core/src/services/interface.service';
import { planWorkItems } from '../../packages/core/src/services/interface-author/author';
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
  it('maps and prepares authoring for a Next.js app with no config file', async () => {
    writeApp();
    fs.unlinkSync(path.join(repo, 'next.config.js'));
    write('package.json', JSON.stringify({ dependencies: { next: '16.0.0' } }));

    const { catalog } = await mapInterfaces(repo, { probeExec: null });
    expect(catalog.resources?.web?.map((place) => place.address)).toEqual(['/tasks']);
    expect(planWorkItems(catalog, null, '').map((item) => item.place.id)).toEqual(['tasks']);
    const { contexts } = await deriveWebAuthoringContext(repo, { catalog });
    expect(contexts.get('tasks')?.module).toBe('app/tasks/page.tsx');
    expect(contexts.get('tasks')?.renders).toEqual(['components/task-list.tsx']);
  });

  it('recognizes only Next.js packages in a mixed monorepo without config files', async () => {
    write('package.json', JSON.stringify({ private: true }));
    write('apps/web/package.json', JSON.stringify({ devDependencies: { next: '16.0.0' } }));
    write('apps/web/src/pages/index.tsx', 'export default function Home() { return <h1>Home</h1> }');
    write('apps/web/src/pages/api/tasks.ts', 'export default function handler() {}');
    write('apps/admin/package.json', JSON.stringify({ dependencies: { react: '19.0.0' } }));
    write('apps/admin/src/pages/Settings.tsx', 'export default function Settings() { return <h1>Settings</h1> }');
    write('apps/broken/package.json', '{');
    write('apps/broken/app/page.tsx', 'export default function Home() { return <h1>Home</h1> }');

    const { catalog } = await mapInterfaces(repo, { probeExec: null });
    expect(catalog.resources?.web?.map((place) => place.address)).toEqual(['/']);
    const { contexts } = await deriveWebAuthoringContext(repo, { catalog });
    expect([...contexts.values()].map((context) => context.module)).toEqual(['apps/web/src/pages/index.tsx']);
  });

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

  it('makes a view two screens render into a shared place, grounded on its own and out of both screens', async () => {
    writeApp();
    write(
      'app/archive/page.tsx',
      `import { TaskList } from '../../components/task-list'
export default function ArchivePage() {
  return <TaskList />
}
`,
    );
    const { contexts, shared, sharedRendered } = await deriveWebAuthoringContext(repo, { catalog: CATALOG });
    expect(shared.map(({ module, title, screens }) => ({ module, title, screens: [...screens].sort() }))).toEqual([
      { module: 'components/task-list.tsx', title: 'task-list', screens: ['archive', 'tasks'] },
    ]);
    const [list] = shared;
    expect(contexts.get(list.id)?.module).toBe('components/task-list.tsx');
    expect(contexts.get(list.id)?.apiEffects).toEqual(['api/get-api-tasks']);
    expect(contexts.get('tasks')?.renders).toEqual([]);
    expect(sharedRendered.get('tasks')).toEqual([list.id]);
    expect(sharedRendered.get('archive')).toEqual([list.id]);
  });

  it("makes a pages-router layout a page picks with `getLayout` a shared place, and what it renders", async () => {
    write('next.config.js', 'module.exports = {}\n');
    write(
      'pages/_app.tsx',
      `export default function App({ Component, pageProps }) {
  const getLayout = Component.getLayout ?? ((page) => page)
  return getLayout(<Component {...pageProps} />)
}
`,
    );
    write(
      'layouts/MainLayout.tsx',
      `import Sidebar from '../components/Sidebar'
export default function MainLayout({ children }) {
  return <div><button onClick={() => window.scrollTo(0, 0)}>Top</button><Sidebar />{children}</div>
}
`,
    );
    write('components/Sidebar.tsx', `export default function Sidebar() {\n  return <nav><button onClick={() => collapse()}>Collapse</button></nav>\n}\n`);
    for (const name of ['links', 'tags']) {
      write(
        `pages/${name}.tsx`,
        `import MainLayout from '../layouts/MainLayout'
export default function Page() {
  return <h1>${name}</h1>
}
Page.getLayout = function getLayout(page) {
  return <MainLayout>{page}</MainLayout>
}
`,
      );
    }
    const { shared, sharedRendered } = await deriveWebAuthoringContext(repo, { catalog: CATALOG });
    expect(shared.map(({ module, screens }) => ({ module, screens: [...screens].sort() }))).toEqual([
      { module: 'components/Sidebar.tsx', screens: ['links', 'tags'] },
      { module: 'layouts/MainLayout.tsx', screens: ['links', 'tags'] },
    ]);
    expect([...(sharedRendered.get('links') ?? [])].sort()).toEqual(shared.map((component) => component.id).sort());
  });

  it('makes the `_app` every pages-router page is wrapped in a shared place', async () => {
    write('next.config.js', 'module.exports = {}\n');
    write(
      'pages/_app.tsx',
      `export default function App({ Component, pageProps }) {
  return <main><button onClick={() => dismissAll()}>Dismiss</button><Component {...pageProps} /></main>
}
`,
    );
    write('pages/links.tsx', 'export default function Links() { return <h1>Links</h1> }\n');
    write('pages/tags.tsx', 'export default function Tags() { return <h1>Tags</h1> }\n');
    const { shared } = await deriveWebAuthoringContext(repo, { catalog: CATALOG });
    expect(shared.map(({ module, screens }) => ({ module, screens: [...screens].sort() }))).toEqual([
      { module: 'pages/_app.tsx', screens: ['links', 'tags'] },
    ]);
  });

  it('makes a nested app-router layout a shared place of the pages under it', async () => {
    write('next.config.js', 'module.exports = {}\n');
    write('app/layout.tsx', 'export default function Root({ children }) { return <html><body>{children}</body></html> }\n');
    write(
      'app/(main)/layout.tsx',
      `export default function MainLayout({ children }) {
  return <div><button onClick={() => openSearch()}>Search</button>{children}</div>
}
`,
    );
    write('app/(main)/links/page.tsx', 'export default function Links() { return <h1>Links</h1> }\n');
    write('app/(main)/tags/page.tsx', 'export default function Tags() { return <h1>Tags</h1> }\n');
    const { shared } = await deriveWebAuthoringContext(repo, { catalog: CATALOG });
    expect(shared.map(({ module, screens }) => ({ module, screens: [...screens].sort() }))).toEqual([
      { module: 'app/(main)/layout.tsx', screens: ['links', 'tags'] },
    ]);
  });

  it('lists a shared component rendered through an intermediate module for the screen', async () => {
    write('next.config.js', 'module.exports = {}\n');
    write('components/LinkCard.tsx', `export default function LinkCard() {\n  return <div><button onClick={() => pin()}>Pin</button></div>\n}\n`);
    write('components/Links.tsx', `import LinkCard from './LinkCard'\nexport default function Links() {\n  return <ul><LinkCard /></ul>\n}\n`);
    for (const name of ['collections', 'pinned']) {
      write(`pages/${name}.tsx`, `import Links from '../components/Links'\nexport default function Page() {\n  return <Links />\n}\n`);
    }
    const { shared, sharedRendered } = await deriveWebAuthoringContext(repo, { catalog: CATALOG });
    const card = shared.find((component) => component.module === 'components/LinkCard.tsx');
    expect(card).toBeDefined();
    expect(sharedRendered.get('collections')).toContain(card?.id);
  });

  it('returns an empty pack for a repository with no web places at all', async () => {
    write('src/index.ts', 'export const noop = () => {}\n');
    const { contexts } = await deriveWebAuthoringContext(repo, { catalog: CATALOG });
    expect(contexts.size).toBe(0);
  });
});
