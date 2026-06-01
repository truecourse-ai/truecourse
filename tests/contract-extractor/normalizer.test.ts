import { describe, it, expect } from 'vitest';
import {
  normalizeEntityRefs,
  normalizeRawPredicates,
  dedupArtifacts,
  assignDeterministicIdentities,
  normalizeMergedArtifacts,
} from '../../packages/contract-extractor/src/normalizer.js';
import type { MergedArtifact } from '../../packages/contract-extractor/src/merger.js';

/**
 * Deterministic post-merge normalization tests. The fixes are
 * comparator-bound: the verifier needs canonical entity refs to resolve
 * cross-references, structured predicates to detect column-level drift,
 * and a single artifact per constraint so markers map 1:1.
 */

function fragment(kind: string, identity: string, tcSource: string): MergedArtifact {
  return {
    kind,
    identity,
    winning: {
      kind,
      identity,
      tcSource,
      origin: { source: 'test.md', section: '', lines: [1, 1] },
      obligationKeys: [],
      reason: '',
    },
    winningRank: 0,
    overridden: [],
    sameRankConflicts: [],
  };
}

// ---------------------------------------------------------------------------
// Entity-ref canonicalization
// ---------------------------------------------------------------------------

describe('normalizeEntityRefs', () => {
  it('rewrites lowercase plural refs to the declared PascalCase singular entity', () => {
    const order = fragment('Entity', 'Order', 'entity Order {\n  field id: string\n}');
    const rule = fragment(
      'QueryRule',
      'orders.tenant-scope',
      'query-rule orders.tenant-scope {\n  entity Entity:orders\n  required { eq orders.tenantId "<param>" }\n}',
    );
    const { rewritten } = normalizeEntityRefs([order, rule]);
    expect(rewritten).toBe(1);
    expect(rule.winning.tcSource).toContain('entity Entity:Order');
    expect(rule.winning.tcSource).not.toContain('Entity:orders');
  });

  it('handles snake_case plural (loyalty_tiers → LoyaltyTier)', () => {
    const ent = fragment('Entity', 'LoyaltyTier', 'entity LoyaltyTier { field code: string }');
    const rule = fragment(
      'QueryRule',
      'loyalty-tiers.allowed',
      'query-rule loyalty-tiers.allowed {\n  entity Entity:loyalty_tiers\n}',
    );
    const { rewritten } = normalizeEntityRefs([ent, rule]);
    expect(rewritten).toBe(1);
    expect(rule.winning.tcSource).toContain('Entity:LoyaltyTier');
  });

  it('leaves already-canonical refs untouched (idempotent)', () => {
    const ent = fragment('Entity', 'Customer', 'entity Customer {}');
    const rule = fragment(
      'QueryRule',
      'customers.x',
      'query-rule customers.x { entity Entity:Customer }',
    );
    const before = rule.winning.tcSource;
    const { rewritten } = normalizeEntityRefs([ent, rule]);
    expect(rewritten).toBe(0);
    expect(rule.winning.tcSource).toBe(before);
  });

  it('does not rewrite when no declared entity normalizes to the ref', () => {
    const ent = fragment('Entity', 'Order', 'entity Order {}');
    const rule = fragment(
      'QueryRule',
      'r',
      'query-rule r { entity Entity:Widgets }', // no Widget entity declared
    );
    const { rewritten } = normalizeEntityRefs([ent, rule]);
    expect(rewritten).toBe(0);
    expect(rule.winning.tcSource).toContain('Entity:Widgets');
  });
});

// ---------------------------------------------------------------------------
// Raw → structured predicate lifting
// ---------------------------------------------------------------------------

describe('normalizeRawPredicates', () => {
  it('lifts `raw "col = <param>"` to `eq col "<param>"`', () => {
    const rule = fragment(
      'QueryRule',
      'orders.tenant-scope',
      'query-rule orders.tenant-scope {\n  entity Entity:Order\n  required {\n    raw "orders.tenantId = <current tenant>"\n  }\n}',
    );
    const { rewritten } = normalizeRawPredicates([rule]);
    expect(rewritten).toBe(1);
    expect(rule.winning.tcSource).toContain('eq orders.tenantId "<param>"');
    expect(rule.winning.tcSource).not.toContain('raw "orders.tenantId');
  });

  it('lifts `raw "col IS NULL"` and `IS NOT NULL`', () => {
    const rule = fragment(
      'QueryRule',
      'r',
      'query-rule r {\n  entity Entity:Order\n  forbidden {\n    raw "orders.deletedAt IS NULL"\n  }\n  required {\n    raw "orders.shippedAt IS NOT NULL"\n  }\n}',
    );
    const { rewritten } = normalizeRawPredicates([rule]);
    expect(rewritten).toBe(2);
    expect(rule.winning.tcSource).toContain('is-null orders.deletedAt');
    expect(rule.winning.tcSource).toContain('is-not-null orders.shippedAt');
  });

  it('lifts `raw "col IN [a, b, c]"` to a structured in-list', () => {
    const rule = fragment(
      'QueryRule',
      'r',
      'query-rule r {\n  entity Entity:Customer\n  required {\n    raw "customers.status IN [active, pending]"\n  }\n}',
    );
    const { rewritten } = normalizeRawPredicates([rule]);
    expect(rewritten).toBe(1);
    expect(rule.winning.tcSource).toContain('in customers.status ["active", "pending"]');
  });

  it('lifts quoted-string literals and numeric values', () => {
    const rule = fragment(
      'QueryRule',
      'r',
      "query-rule r {\n  entity Entity:Order\n  required {\n    raw \"orders.priority = 5\"\n    raw \"orders.region = 'us'\"\n  }\n}",
    );
    const { rewritten } = normalizeRawPredicates([rule]);
    expect(rewritten).toBe(2);
    expect(rule.winning.tcSource).toContain('eq orders.priority 5');
    expect(rule.winning.tcSource).toContain('eq orders.region "us"');
  });

  it('leaves genuinely unparseable expressions as raw', () => {
    const rule = fragment(
      'QueryRule',
      'r',
      'query-rule r {\n  entity Entity:Order\n  required {\n    raw "EXISTS (SELECT 1 FROM audit WHERE ...)"\n  }\n}',
    );
    const before = rule.winning.tcSource;
    const { rewritten } = normalizeRawPredicates([rule]);
    expect(rewritten).toBe(0);
    expect(rule.winning.tcSource).toBe(before);
  });

  it('ignores non-query-rule artifacts even if they contain a "raw" substring', () => {
    const ent = fragment(
      'Entity',
      'Order',
      'entity Order { field raw_payload: string }',
    );
    const before = ent.winning.tcSource;
    normalizeRawPredicates([ent]);
    expect(ent.winning.tcSource).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Query-rule dedup
// ---------------------------------------------------------------------------

describe('dedupArtifacts', () => {
  it('collapses two query-rules with identical (entity, predicates) under different identities', () => {
    const a = fragment(
      'QueryRule',
      'orders.tenant-scope',
      'query-rule orders.tenant-scope {\n  entity Entity:Order\n  required { eq orders.tenantId "<param>" }\n}',
    );
    const b = fragment(
      'QueryRule',
      'orders.tenant-scoped',
      'query-rule orders.tenant-scoped {\n  entity Entity:Order\n  required { eq orders.tenantId "<param>" }\n}',
    );
    const { artifacts, removed } = dedupArtifacts([a, b]);
    expect(removed).toBe(1);
    expect(artifacts).toHaveLength(1);
    // Shorter identity wins.
    expect(artifacts[0].identity).toBe('orders.tenant-scope');
  });

  it('keeps rules with different predicate sets', () => {
    const a = fragment(
      'QueryRule',
      'orders.tenant',
      'query-rule orders.tenant {\n  entity Entity:Order\n  required { eq orders.tenantId "<param>" }\n}',
    );
    const b = fragment(
      'QueryRule',
      'orders.no-soft-delete',
      'query-rule orders.no-soft-delete {\n  entity Entity:Order\n  forbidden { is-null orders.deletedAt }\n}',
    );
    const { artifacts, removed } = dedupArtifacts([a, b]);
    expect(removed).toBe(0);
    expect(artifacts).toHaveLength(2);
  });

  it('does not touch non-query-rule artifacts', () => {
    const ent = fragment('Entity', 'Order', 'entity Order {}');
    const rule = fragment(
      'QueryRule',
      'r',
      'query-rule r { entity Entity:Order required { eq orders.id "<param>" } }',
    );
    const { artifacts, removed } = dedupArtifacts([ent, rule]);
    expect(removed).toBe(0);
    expect(artifacts).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Deterministic identity assignment
// ---------------------------------------------------------------------------

describe('assignDeterministicIdentities', () => {
  it('derives ForbiddenArtifact identity from (category, pattern)', () => {
    const fa = fragment(
      'ForbiddenArtifact',
      'prod-debug-flag', // arbitrary LLM label
      'forbidden-artifact prod-debug-flag {\n  category env-var\n  pattern "PROD_DEBUG"\n}',
    );
    const { renamed } = assignDeterministicIdentities([fa]);
    expect(renamed).toBe(1);
    expect(fa.identity).toBe('env-var.prod-debug');
    expect(fa.winning.tcSource).toContain('forbidden-artifact env-var.prod-debug {');
  });

  it('derives QueryRule identity from entity + predicate signature', () => {
    const qr = fragment(
      'QueryRule',
      'orders.whatever',
      'query-rule orders.whatever {\n  entity Entity:Order\n  required { eq orders.tenantId "<param>" }\n}',
    );
    assignDeterministicIdentities([qr]);
    expect(qr.identity).toBe('order.eq-tenantid');
    expect(qr.winning.tcSource).toContain('query-rule order.eq-tenantid {');
  });

  it('forbidden dedup collapses two artifacts with the same (category, pattern)', () => {
    // Two LLM labels for the same forbidden env-var → after dedup, one;
    // after identity assignment they would otherwise both become
    // `env-var.prod-debug` and collide.
    const a = fragment('ForbiddenArtifact', 'prod-debug', 'forbidden-artifact prod-debug {\n  category env-var\n  pattern "PROD_DEBUG"\n}');
    const b = fragment('ForbiddenArtifact', 'prod-debug-flag', 'forbidden-artifact prod-debug-flag {\n  category env-var\n  pattern "PROD_DEBUG"\n}');
    const { artifacts, removed } = dedupArtifacts([a, b]);
    expect(removed).toBe(1);
    expect(artifacts).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Orchestrator — entity-refs first, then raw lifting, then dedup
// ---------------------------------------------------------------------------

describe('normalizeMergedArtifacts (pipeline)', () => {
  it('canonicalizes entity refs first so dedup sees the same key', () => {
    const ent = fragment('Entity', 'Order', 'entity Order {}');
    // Two rules: one with `Entity:orders` + raw predicate; another with
    // canonical `Entity:Order` + structured predicate. Without normalize,
    // they look different. After normalize, they dedup.
    const a = fragment(
      'QueryRule',
      'orders.tenant-scoped',
      'query-rule orders.tenant-scoped {\n  entity Entity:orders\n  required {\n    raw "orders.tenantId = <current tenant>"\n  }\n}',
    );
    const b = fragment(
      'QueryRule',
      'orders.tenant-scope',
      'query-rule orders.tenant-scope {\n  entity Entity:Order\n  required { eq orders.tenantId "<param>" }\n}',
    );
    const { artifacts, stats } = normalizeMergedArtifacts([ent, a, b]);
    expect(stats.entityRefsRewritten).toBe(1);
    expect(stats.rawPredicatesLifted).toBe(1);
    expect(stats.artifactsDeduplicated).toBe(1);
    expect(stats.identitiesAssigned).toBeGreaterThanOrEqual(1);
    // One query-rule remains, carrying the deterministic content-derived
    // identity (entity slug + predicate signature), not either LLM label.
    const remaining = artifacts.filter((x) => x.kind === 'QueryRule');
    expect(remaining).toHaveLength(1);
    expect(remaining[0].identity).toBe('order.eq-tenantid');
  });
});
