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
import {
  reconcileTargets,
  planReconcileCalls,
  rewriteReferencesToCanonical,
  coverageKey,
} from '../../packages/contract-extractor/src/index.js';
import type { AreaGenInput, ReconcileResult, ReconcileRunner, TargetSpec } from '../../packages/contract-extractor/src/index.js';

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
const allTargets = (out: ReconcileResult) =>
  out.byArea.flatMap((p) => p.targets.map((x) => `${x.kind}:${x.identity}`)).sort();

describe('reconcileTargets', () => {
  it('de-dups an identical target across areas (kept once, in the first area)', async () => {
    const byArea = [
      { area: area('core/architecture'), targets: [t('ArchitectureDecision', 'outbox'), t('Entity', 'Order')] },
      { area: area('core/messaging'), targets: [t('ArchitectureDecision', 'outbox')] },
    ];
    const out = await reconcileTargets(scope, byArea, { enabled: false }); // deterministic only
    expect(allTargets(out)).toEqual(['ArchitectureDecision:outbox', 'Entity:Order']);
    // outbox stays in the first area (core/architecture), not core/messaging.
    expect(out.byArea.find((p) => p.area.areaId === 'core/architecture')!.targets.some((x) => x.identity === 'outbox')).toBe(true);
    expect(out.byArea.find((p) => p.area.areaId === 'core/messaging')!.targets).toEqual([]);
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
    const homeOf = (out: ReconcileResult) =>
      out.byArea.find((p) => p.targets.length > 0)!.area.areaId;
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

    // Two independent clusters that reach the LLM: the auth members share the
    // `jwt` token but are neither token-multiset-equal nor subset (so the
    // deterministic rules leave them for the model), and the arch cluster likewise.
    await reconcileTargets(scope, [auth(['bearer-jwt', 'jwt-session']), arch(['outbox-pattern', 'transactional-outbox'])], { runner });
    expect(calls).toHaveLength(2); // both clusters reconciled once

    calls.length = 0;
    // Add a member to ONLY the auth cluster; the arch cluster is byte-identical.
    await reconcileTargets(scope, [auth(['bearer-jwt', 'jwt-session', 'jwt-refresh']), arch(['outbox-pattern', 'transactional-outbox'])], { runner });
    // The arch cluster is a cache hit → only the changed auth cluster re-runs.
    expect(calls).toHaveLength(1);
    expect(calls[0].every((k) => k.startsWith('AuthRequirement'))).toBe(true);
  });

  it('incumbent-wins: a lone prior spelling absorbs its cluster with no LLM call', async () => {
    let calls = 0;
    const runner: ReconcileRunner = async () => {
      calls++;
      return { merges: {} };
    };
    // Two AuthRequirement spellings sharing `bearer` but neither token-equal nor
    // subset — normally an LLM judgement. One is the prior (reviewed) spelling.
    const byArea = [{ area: area('core/auth'), targets: [t('AuthRequirement', 'bearer-jwt'), t('AuthRequirement', 'token-bearer')] }];
    const out = await reconcileTargets(scope, byArea, {
      runner,
      priorTargets: [{ kind: 'AuthRequirement', identity: 'bearer-jwt' }],
    });
    expect(calls).toBe(0); // resolved deterministically — the lone incumbent locks it
    expect(allTargets(out)).toEqual(['AuthRequirement:bearer-jwt']);
    expect(out.merges[coverageKey('AuthRequirement', 'token-bearer')]).toEqual({ kind: 'AuthRequirement', identity: 'bearer-jwt' });
  });

  it('token-set-equal duplicates merge deterministically (no LLM)', async () => {
    let calls = 0;
    const runner: ReconcileRunner = async () => {
      calls++;
      return { merges: {} };
    };
    const byArea = [
      { area: area('core/api'), targets: [t('ErrorEnvelope', 'error.envelope.standard')] },
      { area: area('core/errors'), targets: [t('ErrorEnvelope', 'standard-error-envelope')] },
    ];
    const out = await reconcileTargets(scope, byArea, { runner });
    expect(calls).toBe(0);
    // Same token multiset {error, envelope, standard}; canonical = lexicographically smallest.
    expect(allTargets(out)).toEqual(['ErrorEnvelope:error.envelope.standard']);
  });

  it('both spellings incumbent (the observed flip case) → one deterministic canonical, order-independent', async () => {
    let calls = 0;
    const runner: ReconcileRunner = async () => {
      calls++;
      return { merges: {} };
    };
    const byArea = [
      { area: area('core/api'), targets: [t('AuthRequirement', 'auth.bearer.api')] },
      { area: area('core/auth'), targets: [t('AuthRequirement', 'bearer-api')] },
    ];
    const prior = [
      { kind: 'AuthRequirement', identity: 'auth.bearer.api' },
      { kind: 'AuthRequirement', identity: 'bearer-api' },
    ];
    const a = await reconcileTargets(scope, byArea, { runner, priorTargets: prior });
    const b = await reconcileTargets(scope, [byArea[1], byArea[0]], { runner, priorTargets: prior });
    expect(calls).toBe(0);
    // bearer-api ⊂ auth.bearer.api → the more specific superset wins, either order.
    expect(allTargets(a)).toEqual(['AuthRequirement:auth.bearer.api']);
    expect(allTargets(b)).toEqual(['AuthRequirement:auth.bearer.api']);
  });

  it('subset rule fires only for singleton kinds — an Entity subset pair never auto-merges', async () => {
    let calls = 0;
    const runner: ReconcileRunner = async () => {
      calls++;
      return { merges: {} };
    };
    // `order` ⊂ `order-line` as token sets, but distinct entities must NOT merge:
    // Entity isn't a singleton kind, so the LLM is consulted (and here declines).
    const entOut = await reconcileTargets(scope, [{ area: area('core/model'), targets: [t('Entity', 'order'), t('Entity', 'order-line')] }], { runner });
    expect(calls).toBe(1);
    expect(allTargets(entOut)).toEqual(['Entity:order', 'Entity:order-line']);

    calls = 0;
    // The same subset shape on a singleton kind merges with no LLM at all.
    const pagOut = await reconcileTargets(scope, [{ area: area('core/api'), targets: [t('PaginationContract', 'cursor'), t('PaginationContract', 'cursor-pagination')] }], { runner });
    expect(calls).toBe(0);
    expect(allTargets(pagOut)).toEqual(['PaginationContract:cursor-pagination']);
  });
});

describe('rewriteReferencesToCanonical', () => {
  const merges = {
    [coverageKey('ErrorEnvelope', 'standard-error-envelope')]: { kind: 'ErrorEnvelope', identity: 'error.envelope.standard' },
    [coverageKey('Operation', 'POST /api/orders')]: { kind: 'Operation', identity: 'POST /api/v2/orders' },
  };

  it('rewrites a bare reference token to its canonical identity', () => {
    const src = 'auth-requirement bearer {\n  on-violation { body ErrorEnvelope:standard-error-envelope }\n}';
    const out = rewriteReferencesToCanonical(src, merges);
    expect(out).toContain('body ErrorEnvelope:error.envelope.standard');
    expect(out).not.toContain('standard-error-envelope');
  });

  it('rewrites a quoted operation reference, keeping the quotes', () => {
    const src = 'query-rule q {\n  bound-to Operation:"POST /api/orders"\n}';
    expect(rewriteReferencesToCanonical(src, merges)).toContain('Operation:"POST /api/v2/orders"');
  });

  it('never rewrites a reference-looking substring inside a string literal', () => {
    const src = 'auth-requirement bearer {\n  origin "see ErrorEnvelope:standard-error-envelope for details" "s" 1..2\n}';
    expect(rewriteReferencesToCanonical(src, merges)).toBe(src);
  });

  it('never rewrites a partial identity match (a longer field-path reference)', () => {
    const src = 'entity Order {\n  field code references ErrorEnvelope:standard-error-envelope.code\n}';
    expect(rewriteReferencesToCanonical(src, merges)).toContain('ErrorEnvelope:standard-error-envelope.code');
  });

  it('is a no-op when there are no merges', () => {
    const src = 'body ErrorEnvelope:standard-error-envelope';
    expect(rewriteReferencesToCanonical(src, {})).toBe(src);
  });
});

describe('planReconcileCalls', () => {
  it('predicts the exact call count of a cold run, and zero after it', async () => {
    const byArea = [
      // Non-subset, non-token-equal members → the deterministic rules leave both
      // clusters for the LLM, so the plan must count 2 calls.
      { area: area('core/auth'), targets: [t('AuthRequirement', 'bearer-jwt'), t('AuthRequirement', 'jwt-session')] },
      { area: area('core/architecture'), targets: [t('ArchitectureDecision', 'outbox-pattern'), t('ArchitectureDecision', 'transactional-outbox')] },
    ];
    // Cold: two clusters, both cache misses — the run would make 2 calls.
    expect(await planReconcileCalls(scope, byArea)).toEqual({ clusters: 2, misses: 2 });

    let calls = 0;
    const runner: ReconcileRunner = async () => {
      calls++;
      return { merges: {} };
    };
    await reconcileTargets(scope, byArea, { runner });
    expect(calls).toBe(2); // the plan matched reality

    // Warm: same clusters now cached — a re-run makes 0 calls.
    expect(await planReconcileCalls(scope, byArea)).toEqual({ clusters: 2, misses: 0 });
  });

  it('counts no clusters for unmergeable targets', async () => {
    const byArea = [{ area: area('core/model'), targets: [t('Entity', 'Order'), t('Entity', 'Customer')] }];
    expect(await planReconcileCalls(scope, byArea)).toEqual({ clusters: 0, misses: 0 });
  });
});
