/**
 * The standalone state reconciliation runs as ONE session on the driver it is
 * handed — the run's own provider — never on a process default or a spawned
 * `claude`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { guardAuthoredInterfacesPath, guardInterfacesPath } from '@truecourse/guard-runner';
import { interfaceFingerprint, type Interface, type InterfacesFile } from '../../packages/shared/src/index';
import { runGuardInterfaceReconcile } from '../../packages/core/src/commands/guard-interfaces';
import { STATE_RECONCILE_SESSION_KIND } from '../../packages/core/src/services/interface-author/reconcile';
import { memoryPersistence, outcome, stubDriver, transportFailure } from './spec-scan-session-stub';

const DERIVED: InterfacesFile = {
  version: 2,
  generatedAt: '2026-08-18T00:00:00.000Z',
  recipeFingerprint: 'sha256:recipe',
  interfaces: [],
  resources: { web: [{ id: 'root', kind: 'screen', title: '/', address: '/' }] },
  source: { web: 'tree' },
};

function stamp(iface: Omit<Interface, 'fingerprint'>): Interface {
  return {
    ...iface,
    fingerprint: interfaceFingerprint({ type: iface.type, entry: iface.entry, steps: iface.steps }),
  } as Interface;
}

/** Two states a reader can tell are one world; only the model pass can merge them. */
const AUTHORED: InterfacesFile = {
  version: 2,
  generatedAt: '2026-08-17T00:00:00.000Z',
  recipeFingerprint: 'sha256:recipe',
  interfaces: [
    stamp({
      id: 'web/create-document',
      type: 'web',
      title: 'Create a document',
      entry: { method: 'GET', path: '/' },
      steps: [{ kind: 'activate', target: { role: 'button', name: 'Create' } }],
      at: 'root',
      endState: 'document-created',
    }),
    stamp({
      id: 'web/rename-document',
      type: 'web',
      title: 'Rename a document',
      entry: { method: 'GET', path: '/' },
      steps: [{ kind: 'activate', target: { role: 'button', name: 'Rename' } }],
      at: 'root',
      startingState: 'document-created',
      endState: 'document-saved',
    }),
  ],
  states: {
    web: [
      { id: 'document-created', description: 'A document exists in the account.' },
      { id: 'document-saved', description: 'The document is stored and listed on the home grid.' },
    ],
  },
};

let repo: string;
beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-iface-reconcile-cmd-'));
  fs.mkdirSync(path.dirname(guardInterfacesPath(repo)), { recursive: true });
  fs.writeFileSync(guardInterfacesPath(repo), JSON.stringify(DERIVED));
  fs.writeFileSync(guardAuthoredInterfacesPath(repo), JSON.stringify(AUTHORED));
});
afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

describe('runGuardInterfaceReconcile', () => {
  it('runs ONE tool-less session on the given driver, and applies its groups', async () => {
    const stub = stubDriver(() =>
      outcome({ groups: [{ keep: 'document-created', absorb: ['document-saved'] }] }),
    );
    const { persistence } = memoryPersistence();
    const result = await runGuardInterfaceReconcile({
      repoRoot: repo,
      driver: stub.driver,
      persistence,
    });

    expect(stub.kinds).toEqual([STATE_RECONCILE_SESSION_KIND]);
    expect(stub.calls[0].def.tools).toEqual([]);
    // The whole registry is the briefing — there is nothing to look up.
    expect(stub.calls[0].briefing).toContain('document-created');
    expect(result.status).toBe('reconciled');
    expect(result.merges).toEqual([{ keep: 'document-created', absorb: ['document-saved'] }]);
  });

  it('keeps the deterministic half when the session is lost, and says so', async () => {
    const stub = stubDriver(() => transportFailure());
    const { persistence } = memoryPersistence();
    const result = await runGuardInterfaceReconcile({
      repoRoot: repo,
      driver: stub.driver,
      persistence,
    });
    expect(result.problems.join(' ')).toMatch(/the reconciliation session failed/);
  });
});
