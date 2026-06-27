/**
 * Global target reconciliation: de-dups targets across areas deterministically
 * (same identity in N areas → one, in the first area) and collapses SEMANTIC
 * duplicates (different identities, same artifact) via the LLM runner — so each
 * artifact is generated once with a stable identity. This is the over-generation
 * fix; without it, cross-cutting decisions bloat the corpus.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetKvCacheStore } from '@truecourse/llm';
import { reconcileTargets } from '../../packages/contract-extractor/src/index.js';
import type { AreaGenInput, ReconcileRunner, TargetSpec } from '../../packages/contract-extractor/src/index.js';

let scope: string;
beforeEach(() => {
  resetKvCacheStore();
  scope = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-reconcile-'));
});
afterEach(() => {
  fs.rmSync(scope, { recursive: true, force: true });
});

function area(id: string): AreaGenInput {
  const slash = id.indexOf('/');
  return { areaId: id, product: id.slice(0, slash), concern: id.slice(slash + 1), docs: [{ ref: `${id}.md`, content: 'x', lastTouched: '2026-01-01T00:00:00Z', kind: 'prd' }] };
}
const t = (kind: string, identity: string): TargetSpec => ({ kind, identity });
const allTargets = (out: { area: AreaGenInput; targets: TargetSpec[] }[]) =>
  out.flatMap((p) => p.targets.map((x) => `${x.kind}:${x.identity}`)).sort();

describe('reconcileTargets', () => {
  it('de-dups an identical target across areas (kept once, in the first area)', async () => {
    const byArea = [
      { area: area('core/architecture'), targets: [t('ArchitectureDecision', 'outbox'), t('Entity', 'Order')] },
      { area: area('core/messaging'), targets: [t('ArchitectureDecision', 'outbox')] },
    ];
    const out = await reconcileTargets(scope, byArea, { enabled: false }); // deterministic only
    expect(allTargets(out)).toEqual(['ArchitectureDecision:outbox', 'Entity:Order']);
    // outbox stays in the first area (core/architecture), not core/messaging.
    expect(out.find((p) => p.area.areaId === 'core/architecture')!.targets.some((x) => x.identity === 'outbox')).toBe(true);
    expect(out.find((p) => p.area.areaId === 'core/messaging')!.targets).toEqual([]);
  });

  it('collapses SEMANTIC duplicates onto the canonical identity (LLM merge)', async () => {
    const byArea = [
      { area: area('core/architecture'), targets: [t('ArchitectureDecision', 'outbox-pattern')] },
      { area: area('core/persistence'), targets: [t('ArchitectureDecision', 'transactional-outbox')] },
      { area: area('core/messaging'), targets: [t('ArchitectureDecision', 'transactional-outbox-delivery')] },
    ];
    // The real LLM emits keys with the PascalCase kind ("<Kind>:<identity>"),
    // not the lowercased coverage key — sanitize must normalize before matching.
    const runner: ReconcileRunner = async () => ({
      merges: {
        'ArchitectureDecision:outbox-pattern': { kind: 'ArchitectureDecision', identity: 'transactional-outbox' },
        'ArchitectureDecision:transactional-outbox-delivery': { kind: 'ArchitectureDecision', identity: 'transactional-outbox' },
      },
    });
    const out = await reconcileTargets(scope, byArea, { runner });
    // All three collapse to ONE canonical ArchitectureDecision.
    expect(allTargets(out)).toEqual(['ArchitectureDecision:transactional-outbox']);
  });

  it('drops unsafe merges (canonical not in the input target set)', async () => {
    const byArea = [{ area: area('core/auth'), targets: [t('AuthRequirement', 'bearer-jwt'), t('AuthRequirement', 'okta')] }];
    const runner: ReconcileRunner = async () => ({
      merges: { 'AuthRequirement:bearer-jwt': { kind: 'AuthRequirement', identity: 'invented-target' } },
    });
    const out = await reconcileTargets(scope, byArea, { runner });
    // The bad merge is ignored → both originals survive.
    expect(allTargets(out)).toEqual(['AuthRequirement:bearer-jwt', 'AuthRequirement:okta']);
  });

  it('caches the reconciliation (runner called once across two passes)', async () => {
    let calls = 0;
    const runner: ReconcileRunner = async () => {
      calls++;
      return { merges: {} };
    };
    const byArea = [{ area: area('core/a'), targets: [t('Entity', 'A'), t('Entity', 'B')] }];
    await reconcileTargets(scope, byArea, { runner });
    await reconcileTargets(scope, byArea, { runner });
    expect(calls).toBe(1);
  });
});
