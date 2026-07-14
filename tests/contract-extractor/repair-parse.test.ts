/**
 * Parse-repair hardening: a malformed artifact gets re-prompted with the FRESH
 * parser error, retried with model escalation (cheap → strong on the last try),
 * and — if it still won't parse — tagged with `repairFailReason` instead of
 * silently dropped, which `validateMerged` surfaces on the issue. LLM stubbed.
 */
import { describe, it, expect } from 'vitest';
import { repair } from '../../packages/contract-extractor/src/repair.js';
import { validateMerged } from '../../packages/contract-extractor/src/validator.js';
import type { MergedArtifact } from '../../packages/contract-extractor/src/merger.js';
import type { SpecSlice } from '../../packages/contract-extractor/src/types.js';
import type { LlmTransport } from '@truecourse/shared/llm';

const MALFORMED = 'entity Order {\n  this is not a valid clause\n}\n';
const VALID = 'entity Order {\n  origin "docs/x.md" "Order" 1..2\n  field id: string immutable\n}\n';

function malformedOrder(): MergedArtifact {
  return {
    kind: 'Entity',
    identity: 'Order',
    winning: {
      kind: 'Entity',
      identity: 'Order',
      tcSource: MALFORMED,
      origin: { source: 'docs/x.md', section: 'Order', lines: [1, 2] },
      obligationKeys: [],
    },
    winningRank: 1,
    overridden: [],
    sameRankConflicts: [],
  };
}

// A slice the repair pass can locate for Entity:Order (direct specPath match).
const slice: SpecSlice = {
  id: 'orders/order',
  specPath: 'docs/x.md',
  headingPath: ['orders', 'order'],
  lineRange: [1, 50],
  text: '# Order\nThe Order entity has an id.',
  headingLevel: 1,
};

/** A fix fragment (parseable or not) for Entity:Order. */
function fixResponse(tcSource: string): string {
  return JSON.stringify({
    fragments: [
      { kind: 'Entity', identity: 'Order', tcSource, origin: { source: 'docs/x.md', section: 'Order', lines: [1, 2] }, obligationKeys: [] },
    ],
  });
}

describe('parse-repair', () => {
  it('retries with the fresh error and escalates to the strong model on the last attempt', async () => {
    const models: (string | undefined)[] = [];
    let call = 0;
    const transport: LlmTransport = async (req) => {
      if (req.stage !== 'contract.repairParse') return JSON.stringify({ fragments: [] });
      models.push(req.model);
      call += 1;
      return fixResponse(call < 3 ? MALFORMED : VALID); // broken, broken, then valid
    };

    const art = malformedOrder();
    await repair([art], [slice], { transport, model: 'opus', parseModel: 'sonnet' });

    expect(models).toEqual(['sonnet', 'sonnet', 'opus']); // escalation on the final try
    expect(art.winning.tcSource).toBe(VALID); // accepted the parseable fix
    expect(art.repairFailReason).toBeUndefined();
    // …and the validator no longer flags it.
    expect(validateMerged([art]).issues.filter((i) => i.severity === 'hard')).toHaveLength(0);
  });

  it('tags repairFailReason after all attempts fail; the validator surfaces it', async () => {
    const transport: LlmTransport = async (req) => {
      if (req.stage !== 'contract.repairParse') return JSON.stringify({ fragments: [] });
      return fixResponse(MALFORMED); // never fixes it
    };

    const art = malformedOrder();
    await repair([art], [slice], { transport, model: 'opus', parseModel: 'sonnet' });

    expect(art.repairFailReason).toBeTruthy();
    expect(art.winning.tcSource).toBe(MALFORMED); // unchanged — not written

    const issues = validateMerged([art]).issues.filter((i) => i.artifactKey === 'Entity:Order');
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('hard');
    expect(issues[0].repairAttempted).toBe(true);
    expect(issues[0].repairFailReason).toBeTruthy();
  });
});
