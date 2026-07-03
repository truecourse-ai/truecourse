/**
 * Deterministic dangling-reference resolution. The extract LLM sometimes writes a
 * cross-reference from whole cloth — a regenerated `Order` emitting
 * `references Entity:core.customers` while the customer entity is declared
 * `entity Customer`. Reconcile's rewrite only covers references to MERGED
 * enumerated targets, so an invented dangling ref used to sail through as a
 * tolerated soft "unresolved reference" and never got checked at verify.
 * `snapReferencesToDeclared` snaps it onto the declared identity via a
 * three-rung ladder (coverage-key fold → token-multiset → unique token overlap),
 * BEFORE repair, so no LLM re-prompt is wasted generating an artifact that
 * already exists. What can't be snapped falls through to repair (now told the
 * declared identities) and, failing that, today's soft-issue tolerance.
 */
import { describe, it, expect } from 'vitest';
import {
  snapReferencesToDeclared,
  assembleArtifacts,
} from '../../packages/contract-extractor/src/index.js';
import { repair } from '../../packages/contract-extractor/src/repair.js';
import type { MergedArtifact } from '../../packages/contract-extractor/src/merger.js';
import type { Fragment, SpecSlice } from '../../packages/contract-extractor/src/types.js';
import type { LlmTransport } from '@truecourse/shared/llm';

function fragment(kind: string, identity: string, tcSource: string): Fragment {
  return { kind, identity, tcSource, origin: { source: 'docs/spec.md', section: identity, lines: [1, 2] }, obligationKeys: [] };
}

function artifact(kind: string, identity: string, tcSource: string): MergedArtifact {
  return {
    kind,
    identity,
    winning: { ...fragment(kind, identity, tcSource) },
    winningRank: 1,
    overridden: [],
    sameRankConflicts: [],
  };
}

const bodyOf = (arts: MergedArtifact[], identity: string): string =>
  arts.find((a) => a.identity === identity)!.winning.tcSource;

// A minimal, parseable entity. Realistic field shape (matches the reference
// fixtures under tests/fixtures/*-il/reference/contracts/orders/order.tc).
const entity = (identity: string, extra = ''): string =>
  `entity ${identity} {\n  origin "docs/spec.md" "${identity}" 1..4\n  field id: uuid { immutable }\n${extra}}\n`;

/** An entity that references another by a (possibly dangling) `Entity:<id>`. */
const entityRef = (identity: string, refKind: string, refIdentity: string): string =>
  entity(identity, `  field linkId: uuid {\n    references ${refKind}:${refIdentity}\n    immutable\n  }\n`);

describe('snapReferencesToDeclared — the ladder', () => {
  it('unique-token: the observed core.customers → Customer case (declared Customer, invented ref)', () => {
    const arts = [
      artifact('Entity', 'Customer', entity('Customer')),
      artifact('Entity', 'Order', entityRef('Order', 'Entity', 'core.customers')),
    ];
    const snaps = snapReferencesToDeclared(arts);
    expect(snaps).toEqual([
      { from: { kind: 'Entity', identity: 'core.customers' }, to: { kind: 'Entity', identity: 'Customer' }, via: 'unique-token' },
    ]);
    expect(bodyOf(arts, 'Order')).toContain('references Entity:Customer');
    expect(bodyOf(arts, 'Order')).not.toContain('core.customers');
  });

  it('token-set: a reordered/re-punctuated identity snaps to the unique multiset match, even when a token-overlap sibling exists', () => {
    // `billing.invoice` and `billing.receipt` both share the `billing` token, so
    // the unique-token rung is AMBIGUOUS here — only exact token-multiset equality
    // ({billing, invoice}) picks the right one.
    const arts = [
      artifact('Entity', 'billing.invoice', entity('billing.invoice')),
      artifact('Entity', 'billing.receipt', entity('billing.receipt')),
      artifact('Entity', 'Payment', entityRef('Payment', 'Entity', 'invoice-billing')),
    ];
    const snaps = snapReferencesToDeclared(arts);
    expect(snaps).toEqual([
      { from: { kind: 'Entity', identity: 'invoice-billing' }, to: { kind: 'Entity', identity: 'billing.invoice' }, via: 'token-set' },
    ]);
    expect(bodyOf(arts, 'Payment')).toContain('references Entity:billing.invoice');
  });

  it('canonical-fold: a quoted operation reference snaps on benign drift, keeping its quotes', () => {
    const op = `operation GET "/api/orders" {\n  origin "docs/spec.md" "orders" 1..2\n}\n`;
    // An auth requirement selects the op by a lower-cased, trailing-slashed spelling.
    const authRef = `auth-requirement bearer {\n  origin "docs/spec.md" "auth" 1..2\n  scheme Bearer\n  selector operations [Operation:"get /api/orders/"]\n}\n`;
    const arts = [
      artifact('Operation', 'GET /api/orders', op),
      artifact('AuthRequirement', 'bearer', authRef),
    ];
    const snaps = snapReferencesToDeclared(arts);
    expect(snaps).toEqual([
      { from: { kind: 'Operation', identity: 'get /api/orders/' }, to: { kind: 'Operation', identity: 'GET /api/orders' }, via: 'canonical-fold' },
    ]);
    expect(bodyOf(arts, 'bearer')).toContain('Operation:"GET /api/orders"');
    expect(bodyOf(arts, 'bearer')).not.toContain('get /api/orders/');
  });

  it('guarded: two entities of the kind and NO token match → no snap', () => {
    const arts = [
      artifact('Entity', 'Order', entity('Order')),
      artifact('Entity', 'Customer', entity('Customer')),
      artifact('Entity', 'Ledger', entityRef('Ledger', 'Entity', 'legacy.audit-trail')),
    ];
    const before = bodyOf(arts, 'Ledger');
    expect(snapReferencesToDeclared(arts)).toEqual([]);
    expect(bodyOf(arts, 'Ledger')).toBe(before);
  });

  it('guarded: a ref overlapping TWO same-kind candidates is ambiguous → no snap', () => {
    const arts = [
      artifact('Entity', 'Order', entity('Order')),
      artifact('Entity', 'Customer', entity('Customer')),
      artifact('Entity', 'Link', entityRef('Link', 'Entity', 'order.customer.map')),
    ];
    const before = bodyOf(arts, 'Link');
    expect(snapReferencesToDeclared(arts)).toEqual([]);
    expect(bodyOf(arts, 'Link')).toBe(before);
  });

  it('forward refs pass through untouched: an unmodelled kind, and a modelled-but-undeclared kind', () => {
    const arts = [
      artifact('Entity', 'Order', entity('Order')),
      // PerformanceSLA has no lifter; StateMachine has one but none is declared here.
      artifact('Entity', 'Metric', entityRef('Metric', 'PerformanceSLA', 'p99-latency')),
      artifact('Entity', 'Widget', entityRef('Widget', 'StateMachine', 'Order.status')),
    ];
    const metricBefore = bodyOf(arts, 'Metric');
    const widgetBefore = bodyOf(arts, 'Widget');
    expect(snapReferencesToDeclared(arts)).toEqual([]);
    expect(bodyOf(arts, 'Metric')).toBe(metricBefore);
    expect(bodyOf(arts, 'Widget')).toBe(widgetBefore);
  });

  it('is a no-op on a corpus with no dangling references', () => {
    const arts = [
      artifact('Entity', 'Customer', entity('Customer')),
      artifact('Entity', 'Order', entityRef('Order', 'Entity', 'Customer')),
    ];
    const before = bodyOf(arts, 'Order');
    expect(snapReferencesToDeclared(arts)).toEqual([]);
    expect(bodyOf(arts, 'Order')).toBe(before);
  });
});

describe('assemble tail — the observed case end-to-end', () => {
  it('snaps the invented ref, emits a soft note, and spends ZERO repair calls', async () => {
    let repairCalls = 0;
    const transport: LlmTransport = async () => {
      repairCalls++;
      return JSON.stringify({ fragments: [] });
    };
    const ranked = [
      { fragment: fragment('Entity', 'Customer', entity('Customer')), rank: 0 },
      { fragment: fragment('Entity', 'Order', entityRef('Order', 'Entity', 'core.customers')), rank: 0 },
    ];
    const slices: SpecSlice[] = [
      { id: 'orders', specPath: 'docs/spec.md', headingPath: ['Order'], lineRange: [1, 4], text: '# Order', headingLevel: 1 },
    ];

    // Repair is ENABLED (default) — the assertion is that snapping resolves the ref
    // BEFORE repair, so the missing-artifact pass finds nothing to re-prompt.
    const out = await assembleArtifacts(ranked, slices, { transport });

    expect(repairCalls).toBe(0);
    const order = out.artifactsToWrite.find((a) => a.identity === 'Order')!;
    expect(order.winning.tcSource).toContain('references Entity:Customer');
    expect(order.winning.tcSource).not.toContain('core.customers');
    expect(
      out.validationIssues.some(
        (i) => i.severity === 'soft' && i.message.includes('snapped to declared Entity:Customer'),
      ),
    ).toBe(true);
    // The snap made every reference resolve — no leftover soft "doesn't resolve".
    expect(out.validationIssues.some((i) => i.message.includes("doesn't resolve"))).toBe(false);
  });
});

describe('repair — informed missing-artifact re-prompt', () => {
  it('names the declared identities of the referenced kind when snapping could not resolve it', async () => {
    // Account is declared and parses; a formula references a dangling `Entity:mystery`
    // that no deterministic snap resolves. The re-prompt must list `Account` so the
    // model can recognize a mis-reference instead of inventing a duplicate.
    const account = `entity Account {\n  origin "docs/spec.md" "Account" 1..4\n  field id: uuid { immutable }\n}\n`;
    const formula = `formula account.balance {\n  origin "docs/spec.md" "Balance" 1..4\n  output Entity:mystery field balance\n  inputs [Entity:mystery.debits]\n  expression "debits"\n}\n`;
    const arts = [artifact('Entity', 'Account', account), artifact('Formula', 'account.balance', formula)];
    const slices: SpecSlice[] = [
      { id: 'm', specPath: 'docs/spec.md', headingPath: ['mystery'], lineRange: [1, 4], text: '## mystery\nthe mystery entity', headingLevel: 2 },
    ];

    const captured: string[] = [];
    const transport: LlmTransport = async (req) => {
      captured.push(req.user);
      return JSON.stringify({ fragments: [] });
    };
    await repair(arts, slices, { transport });

    expect(
      captured.some(
        (u) => u.includes('Already-declared Entity identities in this corpus') && u.includes('Account'),
      ),
    ).toBe(true);
  });
});
