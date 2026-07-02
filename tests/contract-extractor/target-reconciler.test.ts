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

  it('caches each cluster (runner called once per cluster across two passes)', async () => {
    let calls = 0;
    const runner: ReconcileRunner = async () => {
      calls++;
      return { merges: {} };
    };
    // Two same-kind targets sharing a token ("outbox") form ONE candidate cluster.
    const byArea = [
      { area: area('core/architecture'), targets: [t('ArchitectureDecision', 'outbox-pattern'), t('ArchitectureDecision', 'transactional-outbox')] },
    ];
    await reconcileTargets(scope, byArea, { runner });
    await reconcileTargets(scope, byArea, { runner });
    expect(calls).toBe(1); // first pass reconciles the cluster; second pass is a cache hit
  });

  it('never calls the LLM for targets that cannot merge (distinct kinds / no shared token)', async () => {
    let calls = 0;
    const runner: ReconcileRunner = async () => {
      calls++;
      return { merges: {} };
    };
    // Two distinct entities with no shared token → no candidate cluster → no LLM.
    const byArea = [{ area: area('core/model'), targets: [t('Entity', 'Order'), t('Entity', 'Customer')] }];
    const out = await reconcileTargets(scope, byArea, { runner });
    expect(calls).toBe(0);
    expect(allTargets(out)).toEqual(['Entity:Customer', 'Entity:Order']);
  });

  it('assigns a shared target to the lexicographically-smallest area (deterministic origin)', async () => {
    const shared = t('ArchitectureDecision', 'outbox');
    const homeOf = (out: { area: AreaGenInput; targets: TargetSpec[] }[]) =>
      out.find((p) => p.targets.length > 0)!.area.areaId;
    // Same two areas, opposite input orders — the origin must NOT depend on order.
    const out1 = await reconcileTargets(scope, [{ area: area('core/zeta'), targets: [shared] }, { area: area('core/alpha'), targets: [shared] }], { enabled: false });
    const out2 = await reconcileTargets(scope, [{ area: area('core/alpha'), targets: [shared] }, { area: area('core/zeta'), targets: [shared] }], { enabled: false });
    expect(homeOf(out1)).toBe('core/alpha');
    expect(homeOf(out2)).toBe('core/alpha');
  });

  it('per-cluster cache: changing one cluster does not re-reconcile the others', async () => {
    const calls: string[][] = [];
    const runner: ReconcileRunner = async (input) => {
      calls.push(input.targets.map((x) => `${x.kind}:${x.identity}`).sort());
      return { merges: {} };
    };
    const auth = (ids: string[]) => ({ area: area('core/auth'), targets: ids.map((i) => t('AuthRequirement', i)) });
    const arch = (ids: string[]) => ({ area: area('core/architecture'), targets: ids.map((i) => t('ArchitectureDecision', i)) });

    // Two independent clusters: an auth one (…-bearer-jwt) and an arch one (…-outbox).
    await reconcileTargets(scope, [auth(['bearer-jwt', 'customer-bearer-jwt']), arch(['outbox-pattern', 'transactional-outbox'])], { runner });
    expect(calls).toHaveLength(2); // both clusters reconciled once

    calls.length = 0;
    // Add a member to ONLY the auth cluster; the arch cluster is byte-identical.
    await reconcileTargets(scope, [auth(['bearer-jwt', 'customer-bearer-jwt', 'booking-bearer-jwt']), arch(['outbox-pattern', 'transactional-outbox'])], { runner });
    // The arch cluster is a cache hit → only the changed auth cluster re-runs.
    expect(calls).toHaveLength(1);
    expect(calls[0].every((k) => k.startsWith('AuthRequirement'))).toBe(true);
  });
});
