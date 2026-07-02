/**
 * Repair correctness: every pass parse-gates what it accepts, and pass 0 can
 * accept the "inexpressible" downgrade.
 *
 *   - Pass 1 (missing) rejects a non-parsing fix, retries with the parser error
 *     fed back, accepts once it parses, and SKIPS after exhaustion (never adds a
 *     body `validateMerged` would hard-drop — the reference just stays unresolved).
 *   - Pass 2 (incomplete) keeps the previous winning when no fix ever parses
 *     (incomplete beats dropped).
 *   - Pass 0 downgrades a malformed artifact whose clause has no encoding in its
 *     kind to a PARSING UnenforceableObligation (re-keyed, would survive
 *     validation) — the real incident shape — and falls back to `repairFailReason`
 *     tagging when the downgrade key already exists (never worse than today).
 *
 * The LLM is stubbed (no live calls) to isolate the repair LOGIC.
 */
import { describe, it, expect } from 'vitest';
import { repair } from '../../packages/contract-extractor/src/repair.js';
import { validateMerged } from '../../packages/contract-extractor/src/validator.js';
import { parseTcFile } from '../../packages/contract-verifier/src/parser-ohm/index.js';
import { resolve } from '../../packages/contract-verifier/src/resolver/index.js';
import type { MergedArtifact } from '../../packages/contract-extractor/src/merger.js';
import type { SpecSlice } from '../../packages/contract-extractor/src/types.js';
import type { LlmTransport } from '@truecourse/shared/llm';

function artifact(kind: string, identity: string, tcSource: string): MergedArtifact {
  return {
    kind,
    identity,
    winning: {
      kind,
      identity,
      tcSource,
      origin: { source: 'docs/x.md', section: 'x', lines: [1, 2] },
      obligationKeys: [],
    },
    winningRank: 1,
    overridden: [],
    sameRankConflicts: [],
  };
}

function unresolvedCount(artifacts: MergedArtifact[]): number {
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

// ---------------------------------------------------------------------------
// Pass 1 — parse-gates the missing-artifact fix
// ---------------------------------------------------------------------------

const FORMULA_TC = `formula order.total-cents {
  origin "docs/x.md" "Pricing" 235..250
  output Entity:Order field totalCents
  inputs [
    Entity:Order.subtotalCents,
    Entity:Order.discountCents
  ]
  expression "subtotalCents - discountCents"
  computed-at order-creation
  immutable-after-creation
}
`;

const VALID_ENTITY_TC = `entity Order {
  origin "docs/x.md" "Order / fields" 1..10
  field id: uuid { immutable }
  field totalCents: integer >= 0 { immutable }
  field subtotalCents: integer >= 0 { immutable }
  field discountCents: integer >= 0 { immutable }
}
`;

// A body the strict grammar rejects — the "fix" that must NOT be accepted.
const BROKEN_ENTITY_TC = `entity Order {
  origin "docs/x.md" "Order / fields" 1..10
  this is not a valid clause
}
`;

const orderSlice: SpecSlice = {
  id: 'orders/order',
  specPath: 'docs/x.md',
  headingPath: ['orders', 'Order'],
  lineRange: [1, 50],
  text: '# orders\n\n## Order / fields\nfields: id, totalCents, subtotalCents, discountCents\n',
  headingLevel: 1,
};

function entityResponse(tcSource: string): string {
  return JSON.stringify({
    fragments: [
      {
        kind: 'Entity',
        identity: 'Order',
        tcSource,
        origin: { source: 'docs/x.md', section: 'Order / fields', lines: [1, 10] },
        obligationKeys: [],
      },
    ],
  });
}

describe('repair pass 1 — parse-gates the backfilled artifact', () => {
  it('rejects a non-parsing fix, retries with the error fed back, then accepts once it parses', async () => {
    let calls = 0;
    let sawFedBackError = false;
    const transport: LlmTransport = async (req) => {
      if (!req.id.includes('Entity:Order')) return JSON.stringify({ fragments: [] });
      calls += 1;
      const retry = req.user.includes('failed to parse');
      if (retry) sawFedBackError = true;
      return entityResponse(retry ? VALID_ENTITY_TC : BROKEN_ENTITY_TC);
    };

    const artifacts = [artifact('Formula', 'order.total-cents', FORMULA_TC)];
    expect(unresolvedCount(artifacts)).toBeGreaterThan(0);

    const outcome = await repair(artifacts, [orderSlice], { transport });

    expect(calls).toBeGreaterThanOrEqual(2); // first broken, retried
    expect(sawFedBackError).toBe(true); // the retry carried the parser error
    // The VALID entity was incorporated and every reference now resolves…
    const order = outcome.artifacts.find((a) => a.kind === 'Entity' && a.identity === 'Order');
    expect(order?.winning.tcSource).toBe(VALID_ENTITY_TC);
    expect(unresolvedCount(outcome.artifacts)).toBe(0);
  });

  it('skips (never adds the artifact) when the fix never parses', async () => {
    let calls = 0;
    const transport: LlmTransport = async (req) => {
      if (!req.id.includes('Entity:Order')) return JSON.stringify({ fragments: [] });
      calls += 1;
      return entityResponse(BROKEN_ENTITY_TC); // never parses
    };

    const artifacts = [artifact('Formula', 'order.total-cents', FORMULA_TC)];
    const outcome = await repair(artifacts, [orderSlice], { transport });

    expect(calls).toBe(3); // all attempts exhausted
    // No Entity:Order was added — a broken body would be hard-dropped by the
    // validator; leaving the reference unresolved is the softer, better outcome.
    expect(outcome.artifacts.some((a) => a.kind === 'Entity' && a.identity === 'Order')).toBe(false);
    expect(unresolvedCount(outcome.artifacts)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Pass 2 — keeps the previous winning when the fix never parses
// ---------------------------------------------------------------------------

// Parses, but the conformance linter flags it: a `response 404 on not_found`
// block must take an explicit silent-200 stance (`forbid status 200 …`).
const INCOMPLETE_OP_TC = `operation GET "/api/orders/{id}" {
  origin "docs/x.md" "get order" 1..10
  response 404 on not_found { }
}
`;

const BROKEN_OP_FIX_TC = `operation GET "/api/orders/{id}" {
  origin "docs/x.md" "get order" 1..10
  this is not a valid clause
}
`;

describe('repair pass 2 — keeps the previous winning when the fix never parses', () => {
  it('an incomplete-but-parsing artifact is not replaced by an unparseable fix', async () => {
    const transport: LlmTransport = async (req) => {
      if (req.stage !== 'contract.repair') return JSON.stringify({ fragments: [] });
      return JSON.stringify({
        fragments: [
          {
            kind: 'Operation',
            identity: 'GET /api/orders/{id}',
            tcSource: BROKEN_OP_FIX_TC,
            origin: { source: 'docs/x.md', section: 'get order', lines: [1, 10] },
            obligationKeys: [],
          },
        ],
      });
    };

    const art = artifact('Operation', 'GET /api/orders/{id}', INCOMPLETE_OP_TC);
    // Precondition: the source parses today (it's incomplete, not malformed).
    expect(() => parseTcFile('op.tc', art.winning.tcSource)).not.toThrow();

    const outcome = await repair([art], [orderSlice], { transport });

    // Incomplete beats dropped: the previous (parsing) winning is retained.
    expect(art.winning.tcSource).toBe(INCOMPLETE_OP_TC);
    expect(outcome.issues.some((i) => i.kind === 'incomplete')).toBe(true);
    expect(() => parseTcFile('op.tc', art.winning.tcSource)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Pass 0 — accepts the inexpressible downgrade (the real incident shape)
// ---------------------------------------------------------------------------

// `via service-metadata` / `via response-header` are not legal FldExpChannel
// values (only query-select | api-response), so this fails to parse.
const MALFORMED_FIELD_EXPOSURE_TC = `field-exposure api-version-exposure {
  origin "docs/PRDs/orders_PRDv2.md" "API versioning" 55..59
  field ApiVersion
  via service-metadata
  via response-header
}
`;

// The correct downgrade the model returned on every attempt in the incident:
// same identity, an UnenforceableObligation that captures what could not be encoded.
const OBLIGATION_TC = `unenforceable-obligation api-version-exposure {
  origin "docs/PRDs/orders_PRDv2.md" "API versioning" 55..59
  spec-text "The version identifier v2 is surfaced in service metadata and response headers."
  category api-versioning
  rationale "FieldExposure only supports query-select and api-response channels; service metadata and response-header exposure are not structurally encodable."
}
`;

// specPath + lineRange are aligned to the artifact origin (`docs/x.md`, line 1)
// so `sliceForArtifact` locates it directly for the pass-0 re-prompt.
const versioningSlice: SpecSlice = {
  id: 'core/api-versioning',
  specPath: 'docs/x.md',
  headingPath: ['core', 'API versioning'],
  lineRange: [1, 50],
  text: '# core\n\n## API versioning\nThe API version is surfaced in service metadata and response headers.\n',
  headingLevel: 1,
};

function obligationResponse(): string {
  return JSON.stringify({
    fragments: [
      {
        kind: 'UnenforceableObligation',
        identity: 'api-version-exposure',
        tcSource: OBLIGATION_TC,
        origin: { source: 'docs/PRDs/orders_PRDv2.md', section: 'API versioning', lines: [55, 59] },
        obligationKeys: [],
        reason: 'FieldExposure has no valid via value for service metadata or response headers.',
      },
    ],
  });
}

describe('repair pass 0 — accepts the inexpressible downgrade', () => {
  it('re-keys a malformed artifact to a parsing UnenforceableObligation that survives validation', async () => {
    let calls = 0;
    const transport: LlmTransport = async (req) => {
      if (req.stage !== 'contract.repairParse') return JSON.stringify({ fragments: [] });
      calls += 1;
      return obligationResponse(); // the model returns the obligation on every attempt
    };

    const art = artifact('FieldExposure', 'api-version-exposure', MALFORMED_FIELD_EXPOSURE_TC);
    // Precondition: the FieldExposure body does not parse.
    expect(() => parseTcFile('fe.tc', art.winning.tcSource)).toThrow();

    const outcome = await repair([art], [versioningSlice], { transport });

    // Accepted on the FIRST attempt — no wasted retries (the incident burned three).
    expect(calls).toBe(1);
    // The artifact is RE-KEYED (kind + identity), not just its winning body.
    const result = outcome.artifacts[0];
    expect(result.kind).toBe('UnenforceableObligation');
    expect(result.identity).toBe('api-version-exposure');
    expect(result.repairFailReason).toBeUndefined();
    // …and it now parses and would survive validation (no hard issues).
    expect(() => parseTcFile('ob.tc', result.winning.tcSource)).not.toThrow();
    expect(validateMerged(outcome.artifacts).issues.filter((i) => i.severity === 'hard')).toHaveLength(0);
  });

  it('falls back to repairFailReason tagging when the downgrade key already exists', async () => {
    const transport: LlmTransport = async (req) => {
      if (req.stage !== 'contract.repairParse') return JSON.stringify({ fragments: [] });
      return obligationResponse();
    };

    const malformed = artifact('FieldExposure', 'api-version-exposure', MALFORMED_FIELD_EXPOSURE_TC);
    // An artifact already occupies the downgrade key.
    const existing = artifact('UnenforceableObligation', 'api-version-exposure', OBLIGATION_TC);

    const outcome = await repair([malformed, existing], [versioningSlice], { transport });

    // The malformed artifact is NOT re-keyed (that would collide) — it stays a
    // FieldExposure tagged for the validator, never worse than the status quo.
    const kept = outcome.artifacts.find((a) => a.kind === 'FieldExposure');
    expect(kept).toBeDefined();
    expect(kept?.identity).toBe('api-version-exposure');
    expect(kept?.repairFailReason).toBeTruthy();
    // The pre-existing obligation is untouched.
    const obligations = outcome.artifacts.filter((a) => a.kind === 'UnenforceableObligation');
    expect(obligations).toHaveLength(1);
    expect(obligations[0].winning.tcSource).toBe(OBLIGATION_TC);
  });
});
