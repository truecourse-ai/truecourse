/**
 * THE AUTHORED CATALOG REACHES GENERATE — the seam that decides whether a
 * hand-authored surface grounds a single scenario.
 *
 * Before this, `mapInterfacesSafely` reached for the on-disk catalog ONLY when
 * the mapper threw. On a healthy run the mapper's output (cli + api, the only
 * two surfaces anything derives) simply replaced it, so every authored web task
 * disappeared from the run and its flows settled as `no-interface` — silently,
 * with a green mapping. The merge happens on the SUCCESS path now.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mapInterfacesSafely } from '../../packages/guard-generator/src/generate';
import { guardAuthoredInterfacesPath, guardInterfacesPath } from '@truecourse/guard-runner';
import { interfaceFingerprint, type Interface, type InterfaceResource } from '@truecourse/shared';

let repo: string;

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-gen-authored-'));
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

function iface(over: Pick<Interface, 'id' | 'type'> & Partial<Interface>): Interface {
  const base = {
    title: over.id,
    entry: { command: [over.id] },
    steps: [{ kind: 'navigate' as const, route: `/${over.id}` }],
    ...over,
  };
  return { ...base, fingerprint: interfaceFingerprint(base) } as Interface;
}

const CLI = iface({ id: 'cli/add', type: 'cli', entry: { command: ['add'] }, steps: [{ kind: 'invoke', command: ['add'], flags: [] }] });
const WEB = iface({ id: 'web/silence-rule', type: 'web', title: 'silence a rule' });
const WEB_PLACE: InterfaceResource = { id: 'rules-dialog', kind: 'dialog', title: 'the Rules dialog' };

function writeAuthored(interfaces: Interface[], resources?: Record<string, InterfaceResource[]>): void {
  const target = guardAuthoredInterfacesPath(repo);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(
    target,
    JSON.stringify(
      {
        version: 2,
        generatedAt: '2026-08-17T00:00:00.000Z',
        recipeFingerprint: '',
        interfaces,
        ...(resources ? { resources } : {}),
      },
      null,
      2,
    ),
  );
}

describe('mapInterfacesSafely', () => {
  it('merges the authored catalog over a HEALTHY mapping, not only over a failed one', async () => {
    writeAuthored([WEB], { web: [WEB_PLACE] });

    const mapped = await mapInterfacesSafely(repo, async () => ({
      interfaces: [CLI],
      resources: { cli: [{ id: 'tasks', kind: 'command-group', title: 'tasks' }] },
    }));

    expect(mapped.interfaces.map((j) => [j.id, j.origin])).toEqual([
      ['cli/add', 'derived'],
      ['web/silence-rule', 'authored'],
    ]);
    // The places arrive with them, or the authored tasks point at nothing.
    expect(Object.keys(mapped.resources!).sort()).toEqual(['cli', 'web']);
    expect(mapped.resources!.web).toEqual([WEB_PLACE]);
  });

  it('lets an authored entry win outright over the derived one it shadows', async () => {
    const derived = iface({ id: 'api/get-todos', type: 'api', entry: { method: 'GET', path: '/todos' }, steps: [{ kind: 'request', method: 'GET', path: '/todos' }] });
    writeAuthored([{ ...derived, title: 'list every todo' }]);

    const mapped = await mapInterfacesSafely(repo, async () => ({ interfaces: [derived] }));
    expect(mapped.interfaces).toHaveLength(1);
    expect(mapped.interfaces[0]!.title).toBe('list every todo');
    expect(mapped.interfaces[0]!.origin).toBe('authored');
  });

  it('still merges when the mapper throws — the snapshot half degrades, the authored half does not', async () => {
    const snapshot = guardInterfacesPath(repo);
    fs.mkdirSync(path.dirname(snapshot), { recursive: true });
    fs.writeFileSync(
      snapshot,
      JSON.stringify({ version: 2, generatedAt: '2026-08-16T00:00:00.000Z', recipeFingerprint: '', interfaces: [CLI] }),
    );
    writeAuthored([WEB]);

    const mapped = await mapInterfacesSafely(repo, async () => {
      throw new Error('the analyzer choked');
    });
    expect(mapped.interfaces.map((j) => j.id)).toEqual(['cli/add', 'web/silence-rule']);
    expect(mapped.externalServices).toEqual([]);
  });

  it('is unchanged on a repo that authored nothing — the normal case', async () => {
    const mapped = await mapInterfacesSafely(repo, async () => ({ interfaces: [CLI] }));
    expect(mapped.interfaces.map((j) => [j.id, j.origin])).toEqual([['cli/add', 'derived']]);
    expect(mapped.resources).toBeUndefined();
  });
});
