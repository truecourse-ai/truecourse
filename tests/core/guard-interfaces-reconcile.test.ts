/**
 * The standalone state reconciliation runs on the transport it is handed —
 * the run's own provider — never on a process default or a spawned `claude`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { guardAuthoredInterfacesPath, guardInterfacesPath } from '@truecourse/guard-runner';
import type { LlmRequest } from '@truecourse/shared/llm';
import { interfaceFingerprint, type Interface, type InterfacesFile } from '../../packages/shared/src/index';
import { runGuardInterfaceReconcile } from '../../packages/core/src/commands/guard-interfaces';

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
      steps: [{ kind: 'activate', target: 'button "Create"' }],
      at: 'root',
      endState: 'document-created',
    }),
    stamp({
      id: 'web/rename-document',
      type: 'web',
      title: 'Rename a document',
      entry: { method: 'GET', path: '/' },
      steps: [{ kind: 'activate', target: 'button "Rename"' }],
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
  it('asks the given transport, as the state-reconcile stage, and applies its groups', async () => {
    const seen: LlmRequest[] = [];
    const result = await runGuardInterfaceReconcile({
      repoRoot: repo,
      transport: async (req) => {
        seen.push(req);
        return JSON.stringify({ groups: [{ keep: 'document-created', absorb: ['document-saved'] }] });
      },
    });

    expect(seen.map((req) => req.stage)).toEqual(['guard.stateReconcile']);
    expect(result.status).toBe('reconciled');
    expect(result.merges).toEqual([{ keep: 'document-created', absorb: ['document-saved'] }]);
  });
});
