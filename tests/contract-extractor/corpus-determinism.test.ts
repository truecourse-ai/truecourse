/**
 * The determinism guardrail (fix plan §4): editing ONE doc in ONE area must
 * regenerate only that area and leave every other `.tc` byte-identical. This is
 * the concrete definition of "the churn is fixed" — an unrelated edit no longer
 * rewrites the whole tree. (It asserts unchanged-area stability, not byte
 * stability of the edited area's own body, which the LLM never guarantees.)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetKvCacheStore } from '@truecourse/llm';
import {
  generateContractsFromCorpus,
  type AreaGenInput,
  type EnumerateRunner,
  type GenerateBatchRunner,
  type Fragment,
} from '../../packages/contract-extractor/src/index.js';

let repo: string;
beforeEach(() => {
  resetKvCacheStore();
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-determinism-'));
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

/** Every `.tc` file under a dir → { posix relPath: bytes }. */
function snapshotTc(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string, rel: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else if (e.name.endsWith('.tc')) out[r] = fs.readFileSync(path.join(dir, e.name), 'utf8');
    }
  };
  walk(root, '');
  return out;
}

function entity(src: string, identity: string): Fragment {
  return {
    kind: 'Entity',
    identity,
    tcSource: `entity ${identity} {\n  origin "${src}" "${identity}" 1..2\n  field id: string immutable\n}`,
    origin: { source: src, section: identity, lines: [1, 2] },
    obligationKeys: [],
  };
}

describe('determinism guardrail', () => {
  it('edit one doc → only that area regenerates; every other .tc is byte-identical', async () => {
    // Three independent areas, each owning one entity. The generate stub is
    // deterministic per area (its body embeds the source doc), so any cross-area
    // churn — a regenerate, a rename, or an origin flip — would show up.
    const targetsByArea: Record<string, string> = { 'core/orders': 'Order', 'core/billing': 'Invoice', 'core/auth': 'Account' };
    const corpus = (ordersBody: string): AreaGenInput[] => [
      { areaId: 'core/orders', product: 'core', concern: 'orders', docs: [{ ref: 'orders.md', content: ordersBody, lastTouched: '2026-01-01T00:00:00Z', status: 'shipped', kind: 'prd' }] },
      { areaId: 'core/billing', product: 'core', concern: 'billing', docs: [{ ref: 'billing.md', content: '# Billing\nbody', lastTouched: '2026-02-01T00:00:00Z', status: 'shipped', kind: 'prd' }] },
      { areaId: 'core/auth', product: 'core', concern: 'auth', docs: [{ ref: 'auth.md', content: '# Auth\nbody', lastTouched: '2026-03-01T00:00:00Z', status: 'shipped', kind: 'prd' }] },
    ];
    const enumerateRunner: EnumerateRunner = async ({ area }) => [{ kind: 'Entity', identity: targetsByArea[area.areaId] }];

    const genAreas: string[] = [];
    const generateRunner: GenerateBatchRunner = async ({ area, targets }) => {
      genAreas.push(area.areaId);
      return { fragments: targets.map((t) => entity(area.docs[0].ref, t.identity)) };
    };
    const opts = (ordersBody: string) => ({
      repoRoot: repo,
      corpusInput: corpus(ordersBody),
      enumerateRunner,
      generateRunner,
      disableRepair: true,
      disableGapJudge: true,
    });

    await generateContractsFromCorpus(opts('# Orders\noriginal body'));
    const before = snapshotTc(path.join(repo, '.truecourse', 'contracts'));
    expect(Object.keys(before).length).toBe(3); // order/, invoice/, account/
    genAreas.length = 0;

    // Edit ONLY the orders doc.
    await generateContractsFromCorpus(opts('# Orders\nCHANGED body'));
    const after = snapshotTc(path.join(repo, '.truecourse', 'contracts'));

    // 1) Only the edited area ran the generator; the others hit the extract cache.
    expect([...new Set(genAreas)]).toEqual(['core/orders']);

    // 2) Same set of files (no renames / adds / removes anywhere).
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());

    // 3) Every file NOT owned by the edited area is byte-identical.
    for (const [p, bytes] of Object.entries(before)) {
      if (p.startsWith('order/')) continue; // the edited area's domain
      expect(after[p]).toBe(bytes);
    }
  });
});
