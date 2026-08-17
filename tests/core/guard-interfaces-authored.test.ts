/**
 * THE INTERFACES TAB READS BOTH HALVES of the catalog.
 *
 * `guard/interfaces.json` is derived and holds `cli` + `api` only — the two
 * surfaces anything derives. Every web surface in existence is hand-authored and
 * lives in the committed `guard/interfaces.authored.json`. A view composed from
 * the derived half alone shows a repo that has no web surface at all, which is
 * the visible half of the same loss the split was made to stop.
 *
 * The second property here is the one the merge deliberately does NOT solve with
 * `source`: that field says how one AREA was DERIVED (`tree` vs the `probes`
 * ladder), so a hand-authored surface has no answer to give and claims none. What
 * distinguishes "a human wrote this" from "the derivation found nothing" is the
 * pair of facts the view already carries — the surface's interface count, and each
 * row's `origin`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { guardAuthoredInterfacesPath, guardInterfacesPath } from '@truecourse/guard-runner';
import type { InterfacesFile } from '../../packages/shared/src/index';
import { GuardInterfacesViewSchema } from '../../packages/shared/src/index';
import { readGuardInterfaces, readGuardInterfaceRaw } from '../../packages/core/src/commands/guard-read';

let repo: string;

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-iface-view-'));
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

const DERIVED_CLI = {
  id: 'cli/tasks-add',
  type: 'cli' as const,
  title: 'tasks add',
  entry: { command: ['tasks', 'add'] },
  steps: [{ kind: 'invoke' as const, command: ['tasks', 'add'], flags: [] }],
  fingerprint: 'sha256:derived-cli',
};

const DERIVED_API = {
  id: 'api/post-tasks',
  type: 'api' as const,
  title: 'POST /tasks',
  entry: { method: 'POST', path: '/tasks' },
  steps: [{ kind: 'request' as const, method: 'POST', path: '/tasks' }],
  fingerprint: 'sha256:derived-api',
};

/** The shape no derivation writes: a web task, its place, and where it leads. */
const AUTHORED_WEB = {
  id: 'web/silence-rule',
  type: 'web' as const,
  title: 'Silence a rule',
  entry: { method: 'GET', path: '/repos/{repoId}' },
  steps: [{ kind: 'activate' as const, target: 'button "Rules"' }],
  at: 'repo-report',
  to: 'rules-dialog',
  fingerprint: 'sha256:authored-web',
};

/** The places `web/silence-rule` names — a file's `at`/`to` resolve in its own registry. */
const WEB_RESOURCES = {
  web: [
    { id: 'repo-report', kind: 'screen' as const, title: 'the repository report' },
    { id: 'rules-dialog', kind: 'dialog' as const, title: 'the Rules dialog' },
  ],
};

/** A hand-written override of a DERIVED entry — same id, better words. */
const AUTHORED_API = { ...DERIVED_API, title: 'create a task', group: 'tasks' };

function catalog(over: Partial<InterfacesFile>): InterfacesFile {
  return {
    version: 2,
    generatedAt: '2026-08-17T00:00:00.000Z',
    recipeFingerprint: 'sha256:recipe',
    interfaces: [],
    ...over,
  } as InterfacesFile;
}

function write(file: string, content: InterfacesFile): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(content, null, 2));
}

describe('the Interfaces view over a split catalog', () => {
  it('shows the authored surfaces beside the derived ones, each saying where it came from', async () => {
    write(
      guardInterfacesPath(repo),
      catalog({ interfaces: [DERIVED_CLI, DERIVED_API], source: { cli: 'tree', api: 'tree' } }),
    );
    write(
      guardAuthoredInterfacesPath(repo),
      catalog({ interfaces: [AUTHORED_WEB, AUTHORED_API], resources: WEB_RESOURCES }),
    );

    const view = await readGuardInterfaces(repo);
    expect(() => GuardInterfacesViewSchema.parse(view)).not.toThrow();

    // The web surface is only in the authored half — it must still be in the view.
    expect(view.interfaces.map((j) => [j.id, j.origin])).toEqual([
      ['cli/tasks-add', 'derived'],
      ['api/post-tasks', 'authored'],
      ['web/silence-rule', 'authored'],
    ]);
    // The authored override wins outright, in the derived list's own position.
    expect(view.interfaces.find((j) => j.id === 'api/post-tasks')!.title).toBe('create a task');
    expect(view.totals.interfaces).toBe(3);
    // The authored file's registry travels too, or `at`/`to` name nothing.
    expect(view.resources!.web!.map((r) => r.id)).toEqual(['repo-report', 'rules-dialog']);
  });

  it('tells a hand-written surface from a derivation that found nothing', async () => {
    write(guardInterfacesPath(repo), catalog({ interfaces: [DERIVED_CLI], source: { cli: 'probes' } }));
    write(guardAuthoredInterfacesPath(repo), catalog({ interfaces: [AUTHORED_WEB], resources: WEB_RESOURCES }));

    const view = await readGuardInterfaces(repo);
    const surface = (id: string) => view.surfaces.find((s) => s.surface === id)!;

    // Derived: a source, because a derivation ran and says which ladder it took.
    expect(surface('cli')).toMatchObject({ interfaces: 1, detected: true, source: 'probes' });
    // Hand-written: detected, and claiming NO derivation — `source` cannot describe
    // an area a human wrote, and the merge refuses to invent a value that could.
    expect(surface('web')).toMatchObject({ interfaces: 1, detected: true });
    expect('source' in surface('web')).toBe(false);
    // Nothing derived AND nothing authored: undetected, and equally sourceless. The
    // interface count is what separates this from the row above.
    expect(surface('api')).toMatchObject({ interfaces: 0, detected: false });
    expect('source' in surface('api')).toBe(false);

    // Per ROW the answer is exact even inside one area, which no per-area value could say.
    expect(view.interfaces.find((j) => j.id === 'cli/tasks-add')).toMatchObject({
      source: 'probes',
      origin: 'derived',
    });
    expect(view.interfaces.find((j) => j.id === 'web/silence-rule')!.origin).toBe('authored');
    expect('source' in view.interfaces.find((j) => j.id === 'web/silence-rule')!).toBe(false);
  });

  it('reads an authored-only repo — a catalog can exist before anything was ever mapped', async () => {
    write(guardAuthoredInterfacesPath(repo), catalog({ interfaces: [AUTHORED_WEB], resources: WEB_RESOURCES }));

    const view = await readGuardInterfaces(repo);
    expect(view.mapped).toBe(true);
    expect(view.interfaces.map((j) => j.id)).toEqual(['web/silence-rule']);
  });

  it('is the empty Map-CTA state when NEITHER half exists', async () => {
    const view = await readGuardInterfaces(repo);
    expect(view.mapped).toBe(false);
    expect(view.interfaces).toEqual([]);
  });
});

describe('the raw interface source over a split catalog', () => {
  it('slices whichever file actually holds the entry, as its own bytes', async () => {
    write(guardInterfacesPath(repo), catalog({ interfaces: [DERIVED_CLI] }));
    write(guardAuthoredInterfacesPath(repo), catalog({ interfaces: [AUTHORED_WEB], resources: WEB_RESOURCES }));

    const derived = await readGuardInterfaceRaw(repo, 'cli/tasks-add');
    expect(derived!.file).toBe('.truecourse/guard/interfaces.json');
    expect(JSON.parse(derived!.content).id).toBe('cli/tasks-add');

    const authored = await readGuardInterfaceRaw(repo, 'web/silence-rule');
    expect(authored!.file).toBe('.truecourse/guard/interfaces.authored.json');
    expect(JSON.parse(authored!.content)).toEqual(AUTHORED_WEB);
    // The raw reading is the bytes on disk, never a re-serialization of the merge —
    // so the stamped `origin` the view carries is NOT in the file's own text.
    expect('origin' in JSON.parse(authored!.content)).toBe(false);

    expect(await readGuardInterfaceRaw(repo, 'cli/nope')).toBeNull();
  });

  it('shows the AUTHORED bytes when both halves name one id — the half the view rendered', async () => {
    write(guardInterfacesPath(repo), catalog({ interfaces: [DERIVED_API] }));
    write(guardAuthoredInterfacesPath(repo), catalog({ interfaces: [AUTHORED_API] }));

    const raw = await readGuardInterfaceRaw(repo, 'api/post-tasks');
    expect(raw!.file).toBe('.truecourse/guard/interfaces.authored.json');
    expect(JSON.parse(raw!.content).title).toBe('create a task');
  });
});
