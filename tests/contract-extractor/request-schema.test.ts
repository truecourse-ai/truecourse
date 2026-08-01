/**
 * Every contract-extractor stage sends its response schema on the request, so the
 * API transport can enforce the shape via structured output (the cli transport
 * ignores it). Each case also pins the request's prompts to the exported system
 * constant + user builder — the strings the stage fingerprints and cache keys
 * hash — so a schema addition can never move a cache key.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetKvCacheStore } from '@truecourse/llm';
import {
  generateContractsFromCorpus,
  ENUMERATE_SYSTEM_PROMPT,
  EnumerateResultSchema,
  buildEnumerateUserPrompt,
  buildCorpusGenerateUserPrompt,
  EXTRACT_SYSTEM_PROMPT,
  reconcileTargets,
  RECONCILE_SYSTEM_PROMPT,
  buildReconcileUserPrompt,
  judgeGaps,
  GAP_JUDGE_SYSTEM_PROMPT,
  buildGapJudgeUserPrompt,
  REPAIR_FIX_SYSTEM_PROMPT,
} from '../../packages/contract-extractor/src/index.js';
import type {
  AreaGenInput,
  AreaTargets,
  CoverageGap,
  TargetSpec,
} from '../../packages/contract-extractor/src/index.js';
import { repair } from '../../packages/contract-extractor/src/repair.js';
import { ExtractionResultSchema } from '../../packages/contract-extractor/src/types.js';
import type { MergedArtifact } from '../../packages/contract-extractor/src/merger.js';
import type { SpecSlice } from '../../packages/contract-extractor/src/types.js';
import { jsonSchemaHint, type LlmRequest, type LlmTransport } from '@truecourse/shared/llm';

/** A transport that records every request and answers by stage. */
function capture(reply: (req: LlmRequest) => string): {
  transport: LlmTransport;
  reqs: LlmRequest[];
} {
  const reqs: LlmRequest[] = [];
  return {
    reqs,
    transport: async (req) => {
      reqs.push(req);
      return reply(req);
    },
  };
}

/** The request's schema parsed back, with its root object's property names. */
function schemaOf(req: LlmRequest): { root: Record<string, unknown>; props: string[] } {
  expect(typeof req.schema).toBe('string');
  const root = JSON.parse(req.schema as string) as Record<string, unknown>;
  const props = Object.keys((root.properties ?? {}) as Record<string, unknown>).sort();
  return { root, props };
}

const AREA: AreaGenInput = {
  areaId: 'core/orders',
  product: 'core',
  concern: 'orders',
  docs: [
    {
      ref: 'docs/orders.md',
      content: '# Orders\n\nThe Order entity has an id.',
      lastTouched: '2026-01-01T00:00:00Z',
      status: 'shipped',
      kind: 'prd',
    },
  ],
};

const ORDER_TARGET: TargetSpec = { kind: 'Entity', identity: 'Order' };

const ORDER_FRAGMENT = {
  kind: 'Entity',
  identity: 'Order',
  tcSource:
    'entity Order {\n  origin "docs/orders.md" "Order" 1..2\n  field id: string immutable\n}\n',
  origin: { source: 'docs/orders.md', section: 'Order', lines: [1, 2] },
  obligationKeys: [],
};

let repo: string;
beforeEach(() => {
  resetKvCacheStore();
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-ce-req-schema-'));
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('contract.enumerate + contract.extract', () => {
  it('send their result schemas with the unchanged prompts', async () => {
    const { transport, reqs } = capture((req) =>
      req.stage === 'contract.enumerate'
        ? JSON.stringify({ targets: [ORDER_TARGET] })
        : JSON.stringify({ fragments: [ORDER_FRAGMENT] }),
    );

    await generateContractsFromCorpus({
      repoRoot: repo,
      transport,
      corpusInput: [AREA],
      disableTargetReconciliation: true,
      disableGapJudge: true,
      disableExtractCache: true,
      disableManifest: true,
      dryRun: true,
    });

    const enumerate = reqs.filter((r) => r.stage === 'contract.enumerate');
    expect(enumerate).toHaveLength(1);
    expect(enumerate[0].system).toBe(ENUMERATE_SYSTEM_PROMPT);
    expect(enumerate[0].user).toBe(buildEnumerateUserPrompt(AREA));
    expect(enumerate[0].schema).toBe(jsonSchemaHint(EnumerateResultSchema));

    const extract = reqs.filter((r) => r.stage === 'contract.extract');
    expect(extract).toHaveLength(1);
    expect(extract[0].system).toBe(EXTRACT_SYSTEM_PROMPT);
    expect(extract[0].user).toBe(
      buildCorpusGenerateUserPrompt(AREA, [ORDER_TARGET], undefined, undefined, [ORDER_TARGET]),
    );
    expect(extract[0].schema).toBe(jsonSchemaHint(ExtractionResultSchema));
  });
});

describe('contract.reconcile', () => {
  it('sends the merges schema with the unchanged prompts', async () => {
    const t = (identity: string): TargetSpec => ({ kind: 'ArchitectureDecision', identity });
    const byArea: AreaTargets[] = [
      {
        area: { areaId: 'core/architecture', product: 'core', concern: 'architecture', docs: [] },
        targets: [t('outbox-pattern'), t('transactional-outbox')],
      },
    ];
    const { transport, reqs } = capture(() => JSON.stringify({ merges: {} }));

    await reconcileTargets(repo, byArea, { transport });

    expect(reqs).toHaveLength(1);
    expect(reqs[0].system).toBe(RECONCILE_SYSTEM_PROMPT);
    expect(reqs[0].user).toBe(
      buildReconcileUserPrompt({ targets: [t('outbox-pattern'), t('transactional-outbox')] }),
    );
    const { root, props } = schemaOf(reqs[0]);
    expect(root.type).toBe('object');
    expect(props).toEqual(['merges']);
  });
});

describe('contract.gapJudge', () => {
  it('sends the verdicts schema with the unchanged prompts', async () => {
    const gaps: CoverageGap[] = [
      { areaId: AREA.areaId, kind: 'ForbiddenArtifact', identity: 'replace-order-endpoint' },
    ];
    const { transport, reqs } = capture(() => JSON.stringify({ verdicts: {} }));

    await judgeGaps(repo, AREA, gaps, [], { transport });

    expect(reqs).toHaveLength(1);
    expect(reqs[0].system).toBe(GAP_JUDGE_SYSTEM_PROMPT);
    expect(reqs[0].user).toBe(
      buildGapJudgeUserPrompt({
        areaId: AREA.areaId,
        product: AREA.product,
        concern: AREA.concern,
        docs: AREA.docs.map((d) => ({ ref: d.ref, content: d.content })),
        gaps: gaps.map((g) => ({ kind: g.kind, identity: g.identity, hint: g.hint })),
        corpus: [],
      }),
    );
    const { root, props } = schemaOf(reqs[0]);
    expect(root.type).toBe('object');
    expect(props).toEqual(['verdicts']);
  });
});

describe('contract.repair', () => {
  it('sends the extraction-result schema with the unchanged prompts', async () => {
    const malformed: MergedArtifact = {
      kind: 'Entity',
      identity: 'Order',
      winning: {
        kind: 'Entity',
        identity: 'Order',
        tcSource: 'entity Order {\n  this is not a valid clause\n}\n',
        origin: { source: 'docs/orders.md', section: 'Order', lines: [1, 2] },
        obligationKeys: [],
      },
      winningRank: 1,
      overridden: [],
      sameRankConflicts: [],
    };
    const slice: SpecSlice = {
      id: 'orders/order',
      specPath: 'docs/orders.md',
      headingPath: ['orders', 'order'],
      lineRange: [1, 50],
      text: '# Order\nThe Order entity has an id.',
      headingLevel: 1,
    };
    const { transport, reqs } = capture(() => JSON.stringify({ fragments: [ORDER_FRAGMENT] }));

    await repair([malformed], [slice], { transport });

    expect(reqs.length).toBeGreaterThan(0);
    for (const req of reqs) {
      // The repair pass prepends the extraction system prompt so the fixer has the
      // full grammar in context — both halves verbatim.
      expect(req.system).toBe(`${EXTRACT_SYSTEM_PROMPT}\n\n${REPAIR_FIX_SYSTEM_PROMPT}`);
      expect(req.schema).toBe(jsonSchemaHint(ExtractionResultSchema));
    }
  });
});
