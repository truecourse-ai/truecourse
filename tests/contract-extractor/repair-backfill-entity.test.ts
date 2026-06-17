/**
 * Repro: a generated corpus references Entity:Order (a formula's inputs, a query's
 * entity binding) but the Entity:Order contract itself wasn't emitted. The repair
 * pass MUST detect the gap, re-prompt, and incorporate the produced entity so the
 * references resolve. The LLM is stubbed (faithful) to isolate the repair LOGIC
 * from model variance — if this fails, the bug is in our code, not the model.
 */

import { describe, it, expect } from 'vitest';
import { parseTcFile } from '../../packages/contract-verifier/src/parser-ohm/index.js';
import { resolve } from '../../packages/contract-verifier/src/resolver/index.js';
import {
  repair,
  detectMissingArtifacts,
  findSliceForMissing,
} from '../../packages/contract-extractor/src/repair.js';
import type { MergedArtifact } from '../../packages/contract-extractor/src/merger.js';
import type { SpecSlice } from '../../packages/contract-extractor/src/types.js';
import type { LlmTransport } from '@truecourse/shared/llm';

const FORMULA_TC = `formula order.total-cents {
  origin "docs/PRDs/orders_PRDv2.md" "Pricing" 235..250
  output Entity:Order field totalCents
  inputs [
    Entity:Order.subtotalCents,
    Entity:Order.discountCents,
    Entity:Order.taxCents
  ]
  expression "subtotalCents - discountCents + taxCents"
  computed-at order-creation
  immutable-after-creation
}
`;

const QUERY_TC = `query-rule order.eq-tenantid {
  origin "docs/PRDs/orders_PRDv2.md" "Data access rules" 300..300
  entity Entity:Order
  required {
    eq orders.tenantId "<current tenant>"
  }
}
`;

// The faithful entity the spec implies: `placedAt`/`updatedAt` are ISO timestamps,
// which the model writes as `timestamp`. Under the strict grammar that type token
// must parse or the WHOLE entity is silently dropped and the references stay broken.
const ENTITY_ORDER_TC = `entity Order {
  origin "docs/PRDs/orders_PRDv2.md" "Order / fields" 1..10
  field id: uuid { immutable }
  field totalCents: integer >= 0 { immutable }
  field customerId: uuid { immutable }
  field placedAt: timestamp { immutable }
  field updatedAt: timestamp
}
`;

function artifact(kind: string, identity: string, tcSource: string): MergedArtifact {
  return {
    kind,
    identity,
    winning: {
      kind,
      identity,
      tcSource,
      origin: { source: 'docs/PRDs/orders_PRDv2.md', section: 'x', lines: [1, 1] },
      obligationKeys: [],
    },
    winningRank: 1,
    overridden: [],
    sameRankConflicts: [],
  };
}

const slice = (module: string, topic: string, text: string): SpecSlice => ({
  id: `${module}/${topic}`,
  specPath: `.truecourse/specs/claims.json#${module}/${topic}`,
  headingPath: [module, topic],
  lineRange: [1, 50],
  text,
  headingLevel: 1,
});

// A faithful model: when asked to produce the missing Entity:Order, it returns a
// valid entity built from the slice's field list (exactly what we expect).
const FAITHFUL_LLM: LlmTransport = async (req) => {
  // The missing-artifact key is the resolver's canonical PascalCase form
  // (`Entity:Order`) — the same identity the extractor and resolver share.
  if (req.id.endsWith(':Entity:Order')) {
    return JSON.stringify({
      fragments: [
        {
          // The real model returns the PascalCase ArtifactKind it sees in the
          // re-prompt ("Referenced as Entity:Order"); the pipeline keeps it.
          kind: 'Entity',
          identity: 'Order',
          tcSource: ENTITY_ORDER_TC,
          origin: { source: 'docs/PRDs/orders_PRDv2.md', section: 'Order / fields', lines: [1, 10] },
          obligationKeys: [],
        },
      ],
    });
  }
  return JSON.stringify({ fragments: [] });
};

function unresolvedCount(artifacts: MergedArtifact[]): number {
  // Mirror resolveCorpus: an artifact whose tcSource doesn't parse is dropped (so a
  // grammar-rejected entity simply isn't in the index, and its refs stay unresolved).
  const files = [];
  for (const a of artifacts) {
    try {
      files.push(parseTcFile(`<${a.identity}>`, a.winning.tcSource));
    } catch {
      /* unparseable → dropped, exactly as the real pipeline does */
    }
  }
  return resolve(files).unresolvedRefs.length;
}

describe('repair — backfills a referenced-but-missing entity (end-to-end logic)', () => {
  it('produces Entity:Order from the re-prompt and resolves all references', async () => {
    const artifacts = [
      artifact('Formula', 'order.total-cents', FORMULA_TC),
      artifact('QueryRule', 'order.eq-tenantid', QUERY_TC),
    ];
    const slices = [
      slice('_shared', 'data', '# _shared — data\n\n## DiscountTiers / discount map\nfields: bronze, silver, gold\n'),
      slice('orders', 'data', '# orders — data\n\n## Order / fields\nfields: subtotalCents, discountCents, taxCents, totalCents, customerId\n'),
    ];

    expect(unresolvedCount(artifacts)).toBeGreaterThan(0); // Entity:Order* unresolved up front

    const outcome = await repair(artifacts, slices, { transport: FAITHFUL_LLM });

    // The entity must be incorporated into the repaired corpus under the
    // canonical PascalCase kind (one identity per artifact, resolver-keyed)…
    expect(outcome.artifacts.some((a) => a.kind === 'Entity' && a.identity === 'Order')).toBe(true);
    // …the missing-artifact issue is keyed the same canonical way…
    expect(outcome.issues.some((i) => i.kind === 'missing' && i.artifactKey === 'Entity:Order')).toBe(true);
    // …and every reference must now resolve.
    expect(unresolvedCount(outcome.artifacts)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Field-path targets fold to the parent entity
// ---------------------------------------------------------------------------

describe('detectMissingArtifacts — folds Entity field paths to the parent', () => {
  it('a formula referencing Entity:Order.<field> yields one target, not one per field', () => {
    // FORMULA_TC references Entity:Order (output) + Entity:Order.subtotalCents /
    // .discountCents / .taxCents (inputs); QUERY_TC binds Entity:Order. The field
    // paths aren't artifacts — they must collapse to the single producible target.
    const res = resolve([parseTcFile('f.tc', FORMULA_TC), parseTcFile('q.tc', QUERY_TC)]);
    const missing = detectMissingArtifacts(res);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({ kind: 'missing', artifactKey: 'Entity:Order' });
  });
});

// ---------------------------------------------------------------------------
// Slice selection prefers the slice that DECLARES the artifact
// ---------------------------------------------------------------------------

const CUSTOMERS_DECOY = slice(
  'customers',
  'data',
  '# customers — data\n\n## Customer / fields\nThe customer entity and its data shape; each record links to an order.\nfields: id, email, tier\n',
);
const ORDERS_DEFINING = slice(
  'orders',
  'data',
  '# orders — data\n\n## Order / fields\nfields: subtotalCents, discountCents, taxCents, totalCents, customerId\n',
);

describe('findSliceForMissing — prefers the slice that declares the subject', () => {
  it('returns the Order-declaring slice over a keyword-dense Customer slice', () => {
    // The decoy hits more generic Entity keywords (entity, data shape, record,
    // order) than the declaring slice — old density scoring picked it and the
    // model answered "no Order here". The declaring slice must win.
    expect(findSliceForMissing('Entity:Order', [CUSTOMERS_DECOY, ORDERS_DEFINING])).toBe(
      ORDERS_DEFINING,
    );
  });
});

// A model that only produces the entity when handed the slice that actually
// declares Order (its content names the Order fields). If repair mis-selects the
// Customer slice, the prompt lacks that content and no entity comes back.
const SLICE_SENSITIVE_LLM: LlmTransport = async (req) => {
  if (req.id.endsWith(':Entity:Order') && req.user.includes('subtotalCents')) {
    return JSON.stringify({
      fragments: [
        {
          kind: 'Entity',
          identity: 'Order',
          tcSource: ENTITY_ORDER_TC,
          origin: { source: 'docs/PRDs/orders_PRDv2.md', section: 'Order / fields', lines: [1, 10] },
          obligationKeys: [],
        },
      ],
    });
  }
  return JSON.stringify({ fragments: [] });
};

describe('repair — selects the declaring slice end-to-end', () => {
  it('produces Entity:Order (not an obligation) even when a denser Customer slice is present', async () => {
    const artifacts = [
      artifact('Formula', 'order.total-cents', FORMULA_TC),
      artifact('QueryRule', 'order.eq-tenantid', QUERY_TC),
    ];
    const outcome = await repair(artifacts, [CUSTOMERS_DECOY, ORDERS_DEFINING], {
      transport: SLICE_SENSITIVE_LLM,
    });
    expect(outcome.artifacts.some((a) => a.kind === 'Entity' && a.identity === 'Order')).toBe(true);
    expect(unresolvedCount(outcome.artifacts)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Repair REPLACES a broken (unparseable) artifact — it doesn't just backfill
// genuinely-absent ones. This is the real-world cascade: an extracted Order
// entity carried a clause the strict grammar rejects (`validation >= 0`), so it
// never reached the resolved index; repair detected `Entity:Order` "missing"
// and produced a valid one, but the old dedup skipped it because the key already
// existed — leaving the broken copy to be dropped downstream and re-opening
// every `Entity:Order(.field)` reference.
// ---------------------------------------------------------------------------

const BROKEN_ORDER_TC = `entity Order {
  origin "docs/PRDs/orders_PRDv2.md" "Order" 1..10
  field id: uuid { immutable }
  field totalCents: integer {
    validation >= 0
  }
}
`;

describe('repair — replaces a broken artifact with the valid repair output', () => {
  it('a malformed Entity:Order is replaced (not skipped), resolving all references', async () => {
    const artifacts = [
      artifact('Entity', 'Order', BROKEN_ORDER_TC), // present but UNPARSEABLE
      artifact('Formula', 'order.total-cents', FORMULA_TC),
      artifact('QueryRule', 'order.eq-tenantid', QUERY_TC),
    ];
    // The broken Order never reaches the index, so its references are unresolved.
    expect(unresolvedCount(artifacts)).toBeGreaterThan(0);

    const outcome = await repair(artifacts, [ORDERS_DEFINING], { transport: FAITHFUL_LLM });

    // Exactly one Entity:Order remains, and it's the VALID repair output — the
    // broken `validation >= 0` copy was replaced, not left to be dropped.
    const orders = outcome.artifacts.filter((a) => a.kind === 'Entity' && a.identity === 'Order');
    expect(orders).toHaveLength(1);
    expect(orders[0].winning.tcSource).not.toContain('validation >= 0');
    expect(unresolvedCount(outcome.artifacts)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Pass 0: re-prompt a MALFORMED artifact with the parser error and fix the
// syntax in place. This is construct-agnostic — it triggers on any artifact
// that fails to parse, not just referenced/missing ones. Real case: the model
// wrote `request { path { id: uuid required } }` (a nested block) instead of the
// grammar's flat `request { path-param id: uuid }`, so the whole operation was
// dropped. Repair feeds the parser error back and accepts only a result that
// now parses.
// ---------------------------------------------------------------------------

const BROKEN_OP_TC = `operation POST "/api/orders/{id}/pay" {
  origin "docs/PRDs/orders_PRDv2.md" "pay" 1..10
  request {
    path { id: uuid required }
  }
  response 2xx on success {
    effect emits Effect:order.paid
  }
}
`;
const FIXED_OP_TC = `operation POST "/api/orders/{id}/pay" {
  origin "docs/PRDs/orders_PRDv2.md" "pay" 1..10
  request {
    path-param id: uuid
  }
  response 2xx on success {
    effect emits Effect:order.paid
  }
}
`;

// The model returns the corrected operation only when re-prompted with the parse
// error (proving the fix is driven by the parser feedback, not a blind retry).
const SYNTAX_FIX_LLM: LlmTransport = async (req) => {
  if (req.id.includes('/api/orders/{id}/pay') && req.user.includes('failed to parse')) {
    return JSON.stringify({
      fragments: [
        {
          kind: 'Operation',
          identity: 'POST /api/orders/{id}/pay',
          tcSource: FIXED_OP_TC,
          origin: { source: 'docs/PRDs/orders_PRDv2.md', section: 'pay', lines: [1, 10] },
          obligationKeys: [],
        },
      ],
    });
  }
  return JSON.stringify({ fragments: [] });
};

describe('repair — re-prompts a malformed artifact and replaces it once it parses', () => {
  it('fixes an operation that used `path {}` instead of `path-param`', async () => {
    const artifacts = [artifact('Operation', 'POST /api/orders/{id}/pay', BROKEN_OP_TC)];
    // sliceForArtifact matches on the origin source path embedded in the slice text.
    const slices = [
      slice('orders', 'endpoints', '# orders — endpoints\n\n## POST /api/orders/:id/pay\nSource: docs/PRDs/orders_PRDv2.md\n'),
    ];

    // Up front the operation is unparseable, so it can't be parsed at all.
    expect(() => parseTcFile('op.tc', artifacts[0].winning.tcSource)).toThrow();

    const outcome = await repair(artifacts, slices, { transport: SYNTAX_FIX_LLM });

    const ops = outcome.artifacts.filter(
      (a) => a.kind === 'Operation' && a.identity === 'POST /api/orders/{id}/pay',
    );
    expect(ops).toHaveLength(1);
    // Replaced with the corrected syntax, and it now parses cleanly.
    expect(ops[0].winning.tcSource).toContain('path-param id: uuid');
    expect(ops[0].winning.tcSource).not.toContain('path { id');
    expect(() => parseTcFile('op.tc', ops[0].winning.tcSource)).not.toThrow();
  });
});
