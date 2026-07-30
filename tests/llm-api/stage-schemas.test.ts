/**
 * The gate on every schema the product actually sends: each real call site is
 * driven with a capturing transport, and the request it produced is driven through
 * the API transport with a capturing model. Two outcomes are allowed and no
 * others — the transport submits a schema that satisfies the strict structured-
 * output rules (see ./strict-assert), or the call site opted out explicitly with
 * `enforceSchema: false` and the call runs in JSON mode.
 *
 * The opt-out list is pinned: a new silent opt-out, or an opted-out schema that
 * became expressible, fails here rather than at a user's provider.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ZodType } from 'zod';
import { jsonSchemaHint, type LlmRequest, type LlmTransport } from '@truecourse/shared/llm';
import { resetKvCacheStore } from '@truecourse/llm';
import { assertOpenAiStrictValid } from './strict-assert.js';

// The transport's model builder is mocked so the real generateText/generateObject
// run offline against a stub (same pattern as transport.test.ts).
const { buildModelMock } = vi.hoisted(() => ({ buildModelMock: vi.fn() }));
vi.mock('../../packages/llm-api/src/model.js', () => ({ buildModel: buildModelMock }));

import { createApiTransport } from '../../packages/llm-api/src/index';

// --- spec-consolidator -------------------------------------------------------
import {
  filterByRelevance,
  tagDocs,
  normalizeVocabulary,
  flagOverlaps,
  verifyFlaggedOverlaps,
} from '../../packages/spec-consolidator/src/index.js';
import type {
  Area,
  DocAreaTags,
  DocCandidate,
  Overlap,
} from '../../packages/spec-consolidator/src/index.js';

// --- contract-extractor ------------------------------------------------------
import {
  generateContractsFromCorpus,
  reconcileTargets,
  judgeGaps,
} from '../../packages/contract-extractor/src/index.js';
import type {
  AreaGenInput,
  AreaTargets,
  CoverageGap,
  TargetSpec,
} from '../../packages/contract-extractor/src/index.js';
import { EnumerateResultSchema } from '../../packages/contract-extractor/src/index.js';
import { ExtractionResultSchema } from '../../packages/contract-extractor/src/types.js';
import { repair } from '../../packages/contract-extractor/src/repair.js';
import type { MergedArtifact } from '../../packages/contract-extractor/src/merger.js';
import type { SpecSlice } from '../../packages/contract-extractor/src/types.js';

// --- guard-generator ---------------------------------------------------------
import {
  spawnExtractRunner,
  spawnGenerateRunner,
  spawnFidelityRunner,
  spawnTriageRunner,
  spawnExemplarRunner,
  spawnClusterRunner,
  spawnRecipeRunner,
} from '../../packages/guard-generator/src/runners.js';
import type {
  AuthorUserContext,
  ExtractUserContext,
  FidelityUserContext,
  RecipeDiscoveryInput,
} from '../../packages/guard-generator/src/prompts.js';
import type { TriageUserContext } from '../../packages/guard-generator/src/triage.js';
import type { ExemplarUserContext } from '../../packages/guard-generator/src/exemplars.js';
import type { ClusterUserContext } from '../../packages/guard-generator/src/cluster.js';
import type { SectionInput } from '../../packages/guard-generator/src/section-plan.js';
import { DocExtractionSchema } from '../../packages/guard-generator/src/schemas.js';

// --- analyze (core cli-provider transport branch) ----------------------------
import { BaseCLIProvider } from '../../packages/core/src/services/llm/cli-provider.js';
import {
  ServiceViolationOutputSchema,
  DatabaseViolationOutputSchema,
  ModuleViolationOutputSchema,
  DiffViolationOutputSchema,
  LifecycleServiceOutputSchema,
  CodeViolationOutputSchema,
  CodeViolationLifecycleOutputSchema,
  FlowEnrichmentOutputSchema,
} from '../../packages/core/src/services/llm/schemas.js';

const cfg = { provider: 'anthropic' as const, model: 'm', apiKey: 'test' };

/** A transport that answers every call with `{}` and records the requests. */
function capture(): { transport: LlmTransport; reqs: LlmRequest[] } {
  const reqs: LlmRequest[] = [];
  return {
    reqs,
    transport: async (req) => {
      reqs.push(req);
      return '{}';
    },
  };
}

/** Reaches the analyze provider's real schema rendering + transport branch. */
class AnalyzeProbe extends BaseCLIProvider {
  get binaryName() {
    return 'claude';
  }
  get baseArgs() {
    return [];
  }
  get modelFlag() {
    return [];
  }
  render(schema: ZodType): string {
    return this.toJsonSchema(schema);
  }
  send(schema: ZodType, label: string): Promise<string> {
    return this.spawnCLI('prompt', this.render(schema), { label });
  }
}

function doc(p: string): DocCandidate {
  const content = `# ${p}\n\nThe service returns a Bearer JWT for ${p}.`;
  return {
    path: p,
    absPath: `/abs/${p}`,
    content,
    kind: 'prd',
    preview: content,
    lastTouched: '2026-01-01T00:00:00Z',
    contentHash: `hash-${p}`,
    size: content.length,
  };
}

const SECTION: SectionInput = {
  doc: 'docs/cli.md',
  anchor: 'version',
  fingerprint: 'sha256:x',
  headingText: 'version',
  level: 2,
  ownText: 'The CLI prints its version.',
  fullText: 'The CLI prints its version.',
  areaTags: [],
};

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
  tcSource: 'entity Order {\n  origin "docs/orders.md" "Order" 1..2\n  field id: string immutable\n}\n',
  origin: { source: 'docs/orders.md', section: 'Order', lines: [1, 2] },
  obligationKeys: [],
};

/** One collected call: the label we report it under plus the real request. */
interface Collected {
  name: string;
  req: LlmRequest;
}

/** Drive every real schema-bearing call site and return the requests they built. */
async function collectRealRequests(repo: string): Promise<Collected[]> {
  const out: Collected[] = [];
  const push = (name: string, reqs: LlmRequest[]) => {
    for (const req of reqs) if (req.schema) out.push({ name, req });
  };

  // spec scan
  {
    const c = capture();
    await filterByRelevance(repo, [doc('docs/orders-prd.md')], { transport: c.transport });
    push('spec.relevance', c.reqs);
  }
  {
    const c = capture();
    await tagDocs(repo, [doc('docs/auth-prd.md')], { transport: c.transport });
    push('spec.areaTag', c.reqs);
  }
  {
    const c = capture();
    const tags = new Map<string, DocAreaTags>([
      ['a.md', { tags: [{ product: 'core', concern: 'booking' }] }],
      ['b.md', { tags: [{ product: 'core', concern: 'appointments' }] }],
    ]);
    await normalizeVocabulary(repo, tags, { transport: c.transport });
    push('spec.vocab', c.reqs);
  }
  {
    const c = capture();
    const a = doc('docs/a.md');
    const b = doc('docs/b.md');
    const area: Area = {
      id: 'core/auth',
      product: 'core',
      concern: 'auth',
      docRefs: [a.path, b.path],
      overlaps: [],
    };
    await flagOverlaps(repo, [area], [a, b], { transport: c.transport });
    push('spec.overlap', c.reqs);
  }
  {
    const c = capture();
    const a = doc('docs/a.md');
    const b = doc('docs/b.md');
    const ov: Overlap = { docs: [a.path, b.path], note: 'token ttl', sections: [], areas: ['core/auth'] };
    await verifyFlaggedOverlaps(repo, new Map([['core/auth', [ov]]]), [a, b], { transport: c.transport });
    push('spec.verifyOverlap', c.reqs);
  }

  // contracts generate
  {
    const reqs: LlmRequest[] = [];
    const transport: LlmTransport = async (req) => {
      reqs.push(req);
      return req.stage === 'contract.enumerate'
        ? JSON.stringify({ targets: [ORDER_TARGET] })
        : JSON.stringify({ fragments: [ORDER_FRAGMENT] });
    };
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
    push('contract.enumerate', reqs.filter((r) => r.stage === 'contract.enumerate'));
    push('contract.extract', reqs.filter((r) => r.stage === 'contract.extract'));
  }
  {
    const c = capture();
    const t = (identity: string): TargetSpec => ({ kind: 'ArchitectureDecision', identity });
    const byArea: AreaTargets[] = [
      {
        area: { areaId: 'core/architecture', product: 'core', concern: 'architecture', docs: [] },
        targets: [t('outbox-pattern'), t('transactional-outbox')],
      },
    ];
    await reconcileTargets(repo, byArea, { transport: c.transport });
    push('contract.reconcile', c.reqs);
  }
  {
    const c = capture();
    const gaps: CoverageGap[] = [
      { areaId: AREA.areaId, kind: 'ForbiddenArtifact', identity: 'replace-order-endpoint' },
    ];
    await judgeGaps(repo, AREA, gaps, [], { transport: c.transport });
    push('contract.gapJudge', c.reqs);
  }
  {
    const reqs: LlmRequest[] = [];
    const transport: LlmTransport = async (req) => {
      reqs.push(req);
      return JSON.stringify({ fragments: [ORDER_FRAGMENT] });
    };
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
    await repair([malformed], [slice], { transport });
    push('contract.repair', reqs.slice(0, 1));
  }

  // guard generate
  {
    const c = capture();
    const extractCtx: ExtractUserContext = {
      doc: 'docs/cli.md',
      outline: [{ anchor: 'version', headingText: 'version', level: 2 }],
      viewText: '## version\nThe CLI prints its version.',
    };
    await spawnExtractRunner({ transport: c.transport })(extractCtx);
    push('guard.extract', c.reqs);
  }
  {
    const c = capture();
    const authorCtx: AuthorUserContext = {
      doc: 'docs/cli.md',
      docContext: 'doc context',
      areaTags: [],
      recipeEntry: ['node', 'bin.mjs'],
      recipeBuild: 'true',
      claims: [{ ref: 'c0', claim: 'prints its version', section: SECTION }],
    };
    const transport: LlmTransport = async (req) => {
      c.reqs.push(req);
      return '[]';
    };
    await spawnGenerateRunner({ transport })(authorCtx);
    push('guard.generate', c.reqs);
  }
  {
    const c = capture();
    const fidelityCtx: FidelityUserContext = {
      doc: 'docs/cli.md',
      sectionHeading: 'version',
      sectionText: 'The CLI prints its version.',
      claim: 'prints its version',
      scenarioYaml: 'title: prints its version\n',
    };
    await spawnFidelityRunner({ transport: c.transport })(fidelityCtx);
    push('guard.fidelity', c.reqs);
  }
  {
    const c = capture();
    const triageCtx: TriageUserContext = {
      doc: 'docs/cli.md',
      sectionHeading: 'version',
      sectionText: 'The CLI prints its version.',
      claim: 'prints its version',
      kind: 'birth',
      scenarioYaml: 'title: prints its version\n',
      step: 1,
      expected: '0.1.0',
      actual: 'command not found',
    };
    await spawnTriageRunner({ transport: c.transport })(triageCtx);
    push('guard.triage', c.reqs);
  }
  {
    const c = capture();
    const exemplarCtx: ExemplarUserContext = {
      kind: 'dialect',
      subject: 'the Postgres SQL dialect',
      claim: 'supports the Postgres dialect',
      count: 3,
    };
    await spawnExemplarRunner({ transport: c.transport })(exemplarCtx);
    push('guard.exemplars', c.reqs);
  }
  {
    const c = capture();
    const clusterCtx: ClusterUserContext = { briefs: ['a', 'b', 'c'] };
    await spawnClusterRunner({ transport: c.transport })(clusterCtx);
    push('guard.cluster', c.reqs);
  }
  {
    const c = capture();
    const recipeInput: RecipeDiscoveryInput = {
      manifests: [{ path: 'package.json', ecosystem: 'node', content: '{"bin":{"tc":"bin.mjs"}}' }],
      presentInputs: ['pnpm-lock.yaml'],
    };
    await spawnRecipeRunner({ transport: c.transport })(recipeInput);
    push('guard.recipe', c.reqs);
  }

  // analyze — the cli-provider's transport branch, one call per output schema
  {
    const c = capture();
    const probe = new AnalyzeProbe(c.transport);
    const schemas: Array<[string, ZodType]> = [
      ['service', ServiceViolationOutputSchema],
      ['database', DatabaseViolationOutputSchema],
      ['module', ModuleViolationOutputSchema],
      ['diff', DiffViolationOutputSchema],
      ['lifecycle', LifecycleServiceOutputSchema],
      ['code', CodeViolationOutputSchema],
      ['code-lifecycle', CodeViolationLifecycleOutputSchema],
      ['flow', FlowEnrichmentOutputSchema],
    ];
    for (const [label, schema] of schemas) {
      c.reqs.length = 0;
      await probe.send(schema as ZodType, label);
      push(`analyze.${label}`, c.reqs);
    }
  }

  return out;
}

/** What the transport sent the model for one request. */
function formatCapturingModel() {
  let responseFormat: { type?: string; schema?: unknown } | undefined;
  return {
    getFormat: () => responseFormat,
    model: {
      specificationVersion: 'v3',
      provider: 'mock',
      modelId: 'mock-model',
      supportedUrls: {},
      async doGenerate(opts: { responseFormat?: { type?: string; schema?: unknown } }) {
        responseFormat = opts.responseFormat;
        return {
          content: [{ type: 'text', text: '{}' }],
          finishReason: 'stop',
          usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
          warnings: [],
        };
      },
      async doStream() {
        throw new Error('doStream not used');
      },
    },
  };
}

/** The stages whose schemas strict structured output cannot express. */
const EXPECTED_OPT_OUTS = [
  'contract.gapJudge', // `verdicts` record
  'contract.reconcile', // `merges` record
  'guard.generate', // bare-array root + setup file/env records
  'guard.recipe', // `env` record
  'spec.vocab', // `products` / `concerns` records
];

let repo: string;
let collected: Collected[];

beforeEach(() => {
  buildModelMock.mockReset();
  resetKvCacheStore();
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-stage-schemas-'));
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('every real stage schema is enforced or explicitly opted out', () => {
  beforeEach(async () => {
    collected = await collectRealRequests(repo);
  });

  it('collects a schema from every stage', () => {
    expect(collected.length).toBeGreaterThanOrEqual(24);
    // Each collected call site contributed exactly one request.
    expect(new Set(collected.map((c) => c.name)).size).toBe(collected.length);
  });

  it('submits a strict-valid schema for every enforced stage', async () => {
    const results: Array<{ name: string; mode: string }> = [];
    for (const { name, req } of collected) {
      const { model, getFormat } = formatCapturingModel();
      buildModelMock.mockReturnValue(model);
      await createApiTransport(cfg)(req);
      const format = getFormat();
      if (req.enforceSchema === false) {
        expect(format?.type, `${name} should run in JSON mode`).toBe('json');
        expect(format?.schema, `${name} should submit no schema`).toBeUndefined();
        results.push({ name, mode: 'json' });
      } else {
        expect(format?.type, `${name} should submit a schema`).toBe('json');
        expect(format?.schema, `${name} should submit a schema`).toBeDefined();
        assertOpenAiStrictValid(format?.schema, name);
        results.push({ name, mode: 'strict' });
      }
    }
    // Nothing was skipped.
    expect(results.length).toBe(collected.length);
  });

  it('pins the opt-out list — a new silent opt-out fails here', () => {
    const optedOut = collected
      .filter((c) => c.req.enforceSchema === false)
      .map((c) => c.name)
      .sort();
    expect(optedOut).toEqual(EXPECTED_OPT_OUTS);
  });

  it('keeps the analyze path fully enforced', () => {
    const analyze = collected.filter((c) => c.name.startsWith('analyze.'));
    expect(analyze).toHaveLength(8);
    for (const { name, req } of analyze) {
      expect(req.enforceSchema, `${name} must stay enforced`).toBeUndefined();
    }
  });
});

/** A model that answers with exactly `text`. */
function textModel(text: string) {
  return {
    specificationVersion: 'v3',
    provider: 'mock',
    modelId: 'mock-model',
    supportedUrls: {},
    async doGenerate() {
      return {
        content: [{ type: 'text', text }],
        finishReason: 'stop',
        usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
        warnings: [],
      };
    },
    async doStream() {
      throw new Error('doStream not used');
    },
  };
}

/** Run one enforced call whose model answers `reply`; returns the transport's text. */
async function driveWithReply(schema: string, reply: string): Promise<string> {
  buildModelMock.mockReturnValue(textModel(reply));
  return createApiTransport(cfg)({
    id: 'a:b',
    stage: 'roundtrip',
    system: 'S',
    user: 'U',
    responseFormat: 'json',
    schema,
  });
}

// Normalization forces the model to answer `null` for every optional it omits;
// what comes back out of the transport must parse with the UNCHANGED stage Zod,
// which accepts a missing optional but not an explicit null.
describe('the nulls normalization asks for never reach the stage Zod', () => {
  it('strips them from a doc extraction, including inside claims[]', async () => {
    const reply = JSON.stringify({
      claims: [
        {
          claim: 'prints its version',
          driver: 'cli',
          sectionAnchor: 'version',
          reason: 'documented',
          flavor: null,
          example: null,
          examples: null,
          support: { kind: 'dialect', subject: 'postgres', extension: null },
        },
      ],
      untestable: null,
    });

    const out = await driveWithReply(jsonSchemaHint(DocExtractionSchema), reply);
    const raw = JSON.parse(out) as { claims: Array<Record<string, unknown>> };
    expect(raw.claims[0]).not.toHaveProperty('flavor');
    expect(raw.claims[0]).not.toHaveProperty('example');
    expect(raw).not.toHaveProperty('untestable');
    expect((raw.claims[0].support as Record<string, unknown>)).not.toHaveProperty('extension');

    const parsed = DocExtractionSchema.parse(raw);
    expect(parsed.claims).toHaveLength(1);
    expect(parsed.claims[0].flavor).toBeUndefined();
    expect(parsed.untestable).toEqual([]);
  });

  it('lets a `.default()` field fall back to its default', async () => {
    const out = await driveWithReply(
      jsonSchemaHint(EnumerateResultSchema),
      JSON.stringify({ targets: null }),
    );
    expect(JSON.parse(out)).toEqual({});
    expect(EnumerateResultSchema.parse(JSON.parse(out))).toEqual({ targets: [] });
  });

  it('strips optionals nested in an extraction result and keeps the tuple intact', async () => {
    const reply = JSON.stringify({
      fragments: [
        {
          kind: 'Entity',
          identity: 'Order',
          tcSource: 'entity Order {\n}\n',
          origin: { source: 'docs/orders.md', section: 'Order', lines: [1, 2] },
          obligationKeys: null,
          reason: null,
        },
      ],
      notes: null,
    });

    const out = await driveWithReply(jsonSchemaHint(ExtractionResultSchema), reply);
    const parsed = ExtractionResultSchema.parse(JSON.parse(out));
    expect(parsed.fragments[0].obligationKeys).toEqual([]);
    expect(parsed.fragments[0].reason).toBeUndefined();
    expect(parsed.notes).toBeUndefined();
    expect(parsed.fragments[0].origin.lines).toEqual([1, 2]);
  });

  it('keeps a null the stage schema legitimately allows (analyze `nullable: true`)', async () => {
    const schema = new AnalyzeProbe().render(ServiceViolationOutputSchema);
    const reply = JSON.stringify({
      violations: [
        {
          type: 'service',
          title: 't',
          content: 'c',
          severity: 'high',
          targetServiceId: null,
          fixPrompt: null,
          ruleKey: 'rule',
        },
      ],
      serviceDescriptions: [],
    });

    const out = await driveWithReply(schema, reply);
    const parsed = ServiceViolationOutputSchema.parse(JSON.parse(out));
    expect(parsed.violations[0].targetServiceId).toBeNull();
    expect(parsed.violations[0].fixPrompt).toBeNull();
  });
});

describe('an enforced schema strict output cannot express fails loudly', () => {
  it('throws before any model call, naming the path and the opt-out', async () => {
    const { model } = formatCapturingModel();
    buildModelMock.mockReturnValue(model);
    await expect(
      createApiTransport(cfg)({
        id: 'a:b',
        stage: 'guard.recipe',
        system: 'S',
        user: 'U',
        responseFormat: 'json',
        schema:
          '{"type":"object","properties":{"env":{"type":"object","additionalProperties":{"type":"string"}}},"required":["env"],"additionalProperties":false}',
      }),
    ).rejects.toThrow(/properties\.env is a typed record.*enforceSchema: false/s);
  });
});
