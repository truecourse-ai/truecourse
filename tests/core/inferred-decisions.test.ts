import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { saveSpec } from '@truecourse/core/lib/spec-store';
import { readContractFile } from '@truecourse/core/lib/contract-store';
import { resetInferredActionStore } from '@truecourse/core/lib/inferred-action-store';
import {
  applyInferredActions,
  diffDecisions,
  readInferredDecisions,
  readDismissedDecisions,
  dismissInferredDecision,
  undismissInferredDecision,
  promoteInferredDecision,
  promotedContractPaths,
} from '@truecourse/core/lib/inferred-decisions';

const dec = (kind: string, identity: string, contractPath?: string) => ({ kind, identity, contractPath });
const act = (kind: string, identity: string, status: 'dismissed' | 'promoted') => ({
  kind,
  identity,
  status,
  createdAt: '2026-01-01T00:00:00.000Z',
});

describe('applyInferredActions', () => {
  it('drops dismissed AND promoted (both no longer undocumented); keeps the rest', () => {
    const set = [dec('Operation', 'GET /x'), dec('Enum', 'Role'), dec('Entity', 'Order')];
    const out = applyInferredActions(set, [
      act('Operation', 'GET /x', 'dismissed'),
      act('Entity', 'Order', 'promoted'),
    ]);
    expect(out).toEqual([dec('Enum', 'Role')]);
  });

  it('matches on kind AND identity', () => {
    const out = applyInferredActions([dec('Entity', 'Order'), dec('Enum', 'Order')], [act('Enum', 'Order', 'dismissed')]);
    expect(out).toEqual([dec('Entity', 'Order')]);
  });
});

describe('diffDecisions', () => {
  const tc = (identity: string, body: string, line = 1) =>
    ({
      kind: 'Enum',
      identity,
      tc: `enum ${identity} {\n  // inferred — enum defined in code but documented in no spec\n  inferred-from "src/x.ts" ${line}..${line}\n  confidence high\n  ${body}\n}\n`,
    });

  it('null base ⇒ fellBack with the full head set', () => {
    const head = [tc('Role', 'values [A, B]')];
    const d = diffDecisions(head, null);
    expect(d.fellBack).toBe(true);
    expect(d.added).toEqual(head);
    expect(d.changed).toEqual([]);
  });

  it('added (head-only) and resolved (base-only) by kind+identity', () => {
    const d = diffDecisions([tc('Role', 'values [A]'), tc('New', 'values [X]')], [tc('Role', 'values [A]'), tc('Gone', 'values [Z]')]);
    expect(d.added.map((x) => x.identity)).toEqual(['New']);
    expect(d.resolved.map((x) => x.identity)).toEqual(['Gone']);
    expect(d.changed).toEqual([]);
  });

  it('changed = same identity, contract body differs', () => {
    const d = diffDecisions([tc('Role', 'values [A, B]')], [tc('Role', 'values [A]')]);
    expect(d.changed.map((x) => x.identity)).toEqual(['Role']);
    expect(d.added).toEqual([]);
  });

  it('a moved code location alone is NOT a change (provenance stripped)', () => {
    // identical body, only the inferred-from line numbers differ → not changed.
    const d = diffDecisions([tc('Role', 'values [A]', 99)], [tc('Role', 'values [A]', 12)]);
    expect(d.changed).toEqual([]);
    expect(d.added).toEqual([]);
  });
});

describe('inferred decisions over the file stores (OSS transport)', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-infer-dec-'));
    resetInferredActionStore();
  });
  afterEach(() => {
    resetInferredActionStore();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function seed() {
    await saveSpec({ repoKey: dir, commitSha: '' }, 'inferredDecisions', [
      { kind: 'Entity', identity: 'Order', reason: 'inferred', contractPath: 'data/order.tc' },
      { kind: 'Enum', identity: 'Role', reason: 'inferred', contractPath: 'data/role.tc' },
    ]);
    // The inferred `.tc` the promote reads from.
    const f = path.join(dir, '.truecourse', 'contracts', '_inferred', 'data', 'order.tc');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, 'Entity Order { ... }');
  }

  it('lists the stored set, then dismiss/promote remove items and persist', async () => {
    await seed();
    expect((await readInferredDecisions(dir)).decisions.map((d) => d.identity).sort()).toEqual([
      'Order',
      'Role',
    ]);

    // Promote: writes the `.tc` into authored contracts + records the action.
    expect(await promoteInferredDecision(dir, 'Entity', 'Order')).toBe('ok');
    expect(await readContractFile(dir, 'contracts', 'data/order.tc')).toBe('Entity Order { ... }');
    expect((await readInferredDecisions(dir)).decisions.map((d) => d.identity)).toEqual(['Role']);

    // Dismiss: removes from the visible set too.
    await dismissInferredDecision(dir, 'Enum', 'Role');
    expect((await readInferredDecisions(dir)).decisions).toEqual([]);

    // Persistence: a fresh re-list (re-persisted raw set) still hides both.
    await saveSpec({ repoKey: dir, commitSha: '' }, 'inferredDecisions', [
      { kind: 'Entity', identity: 'Order', contractPath: 'data/order.tc' },
      { kind: 'Enum', identity: 'Role', contractPath: 'data/role.tc' },
    ]);
    expect((await readInferredDecisions(dir)).decisions).toEqual([]);
  });

  it('promote returns not-found / unavailable on bad input', async () => {
    await seed();
    expect(await promoteInferredDecision(dir, 'Entity', 'Nope')).toBe('not-found');
    // Role has a contractPath but no `.tc` seeded → unavailable.
    expect(await promoteInferredDecision(dir, 'Enum', 'Role')).toBe('unavailable');
  });

  it('reports promoted decisions’ contract paths (for the Contracts "inferred" badge)', async () => {
    await seed();
    expect(await promotedContractPaths(dir)).toEqual([]);
    expect(await promoteInferredDecision(dir, 'Entity', 'Order')).toBe('ok');
    expect(await promotedContractPaths(dir)).toEqual(['data/order.tc']);
  });

  it('lists dismissed decisions and restores them back to active', async () => {
    await seed();
    await dismissInferredDecision(dir, 'Enum', 'Role');
    expect((await readDismissedDecisions(dir)).map((d) => d.identity)).toEqual(['Role']);
    expect((await readInferredDecisions(dir)).decisions.map((d) => d.identity)).toEqual(['Order']);

    await undismissInferredDecision(dir, 'Enum', 'Role');
    expect(await readDismissedDecisions(dir)).toEqual([]);
    expect((await readInferredDecisions(dir)).decisions.map((d) => d.identity).sort()).toEqual(['Order', 'Role']);
  });

  it('backfills tc + confidence from the contracts_inferred .tc when stored without them', async () => {
    await saveSpec({ repoKey: dir, commitSha: '' }, 'inferredDecisions', [
      { kind: 'Enum', identity: 'Role', contractPath: 'data/role.tc' },
    ]);
    const f = path.join(dir, '.truecourse', 'contracts', '_inferred', 'data', 'role.tc');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, 'enum Role {\n  confidence medium\n  values [A, B]\n}\n');

    const [d] = (await readInferredDecisions(dir)).decisions;
    expect(d.tc).toContain('values [A, B]');
    expect(d.confidence).toBe('medium');
  });
});
