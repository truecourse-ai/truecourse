/**
 * The gate on every schema the product actually sends: each real call site is
 * driven with a capturing transport, and the request it produced is driven through
 * the API transport with a capturing model. Two outcomes are allowed and no
 * others — the transport submits a schema that satisfies the strict structured-
 * output rules (see ./strict-assert), or the call site opted out explicitly with
 * `enforceSchema: false` and the call runs in JSON mode.
 *
 * The opt-out list is pinned: a new silent opt-out, or an opted-out schema that
 * became expressible, fails here rather than at a user's provider. Every stage
 * schema — opted out or not — must also be OBJECT-rooted, since JSON mode can
 * return nothing else.
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

// --- spec scan ---------------------------------------------------------------
// The five spec stages are AGENT SESSIONS now: they build no
// `LlmRequest`, so they contribute nothing to the request sweep below. Their
// outcome schemas ride the session driver's toolset instead, and are checked
// object-rooted in their own describe at the end of this file.
import { DocVerdictSchema } from '../../packages/core/src/services/spec-scan/curate-doc';
import { AreaSettlementSchema } from '../../packages/core/src/services/spec-scan/settle-areas';
import { OverlapOutcomeSchema } from '../../packages/core/src/services/spec-scan/overlap';
import { ScanScopeOutcomeSchema } from '../../packages/core/src/services/spec-scan/orchestrate';
import type { DocCandidate } from '../../packages/spec-consolidator/src/index.js';

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
import { DocExtractionSchema } from '../../packages/guard-generator/src/schemas.js';
import {
  spawnExtractRunner,
  spawnFlowsRunner,
  spawnFlowsEpicRunner,
  spawnMatchRunner,
  spawnGenerateRunner,
  spawnFidelityRunner,
  spawnTriageRunner,
  spawnSeedRunner,
  spawnRecipeRunner,
} from '../../packages/guard-generator/src/runners.js';
import type {
  AuthorUserContext,
  FidelityUserContext,
  FlowsUserContext,
  FlowsEpicUserContext,
  MatchUserContext,
  RecipeDiscoveryInput,
  SeedDraftInput,
} from '../../packages/guard-generator/src/prompts.js';
import type { TriageUserContext } from '../../packages/guard-generator/src/triage.js';

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

  // guard generate — every stage's real runner, driven with a minimal context
  {
    const c = capture();
    const t = { transport: c.transport };
    const flow = { id: 'checkout', title: 'A shopper checks out', goal: 'buy a thing' };

    await spawnExtractRunner(t)({
      doc: 'docs/cli.md',
      outline: [{ anchor: 'version', headingText: 'version', level: 2 }],
      viewText: '## version\n`relkit --version` prints the version.',
    });
    push('guard.extract', c.reqs.splice(0));

    const flowsCtx: FlowsUserContext = {
      areaId: 'core/checkout',
      claims: [
        { doc: 'docs/cli.md', anchor: 'version', claim: 'prints the version', driver: 'cli', required: true },
      ],
      docs: [{ doc: 'docs/cli.md', outline: [{ anchor: 'version', headingText: 'version', level: 2 }] }],
    };
    await spawnFlowsRunner(t)(flowsCtx);
    push('guard.flows', c.reqs.splice(0));

    const epicCtx: FlowsEpicUserContext = {
      digests: [
        {
          ref: 'F1',
          areaId: 'core/checkout',
          title: flow.title,
          goal: flow.goal,
          milestones: [{ doc: 'docs/cli.md', anchor: 'version', claimTitle: 'prints the version' }],
        },
      ],
    };
    await spawnFlowsEpicRunner(t)(epicCtx);
    push('guard.flows.epic', c.reqs.splice(0));

    const matchCtx: MatchUserContext = {
      flow,
      milestones: [{ order: 1, claim: 'prints the version' }],
      surface: 'cli',
      journeys: [{ id: 'j1', title: 'version', entry: 'relkit --version', steps: ['invoke relkit --version'] }],
    };
    await spawnMatchRunner(t)(matchCtx);
    push('guard.match', c.reqs.splice(0));

    const authorCtx: AuthorUserContext = {
      flow,
      milestones: [
        {
          order: 1,
          claim: 'prints the version',
          doc: 'docs/cli.md',
          sectionHeading: 'version',
          sectionText: '`relkit --version` prints the version.',
          realization: ['run --version'],
        },
      ],
      journeyPath: ['j1'],
      areaTags: ['core/checkout'],
      driver: 'cli',
      recipeEntry: ['node', 'dist/cli.js'],
      recipeBuild: 'pnpm build',
    };
    const author = spawnGenerateRunner(t);
    await author(authorCtx);
    push('guard.generate', c.reqs.splice(0));
    await author({ ...authorCtx, driver: 'api', recipeServe: ['node', 'dist/server.js'] });
    push('guard.generate.api', c.reqs.splice(0));

    const fidelityCtx: FidelityUserContext = {
      flow,
      milestones: [
        {
          order: 1,
          claim: 'prints the version',
          doc: 'docs/cli.md',
          sectionHeading: 'version',
          sectionText: '`relkit --version` prints the version.',
        },
      ],
      scenarioYaml: 'id: checkout.cli.1\ntitle: prints the version\n',
    };
    await spawnFidelityRunner(t)(fidelityCtx);
    push('guard.fidelity', c.reqs.splice(0));

    const triageCtx: TriageUserContext = {
      flow,
      surface: 'cli',
      doc: 'docs/cli.md',
      sectionHeading: 'version',
      sectionText: '`relkit --version` prints the version.',
      milestones: [{ order: 1, claim: 'prints the version', failed: true }],
      scenarioYaml: 'id: checkout.cli.1\n',
      step: 1,
      expected: 'exit 0',
      actual: 'exit 1',
    };
    await spawnTriageRunner(t)(triageCtx);
    push('guard.triage', c.reqs.splice(0));

    const seedCtx: SeedDraftInput = {
      driver: 'pg',
      databaseType: 'postgres',
      tables: [{ name: 'users', columns: [{ name: 'id', type: 'uuid', isPrimaryKey: true }] }],
      relations: [],
      connectionEnv: ['DATABASE_URL'],
      appImports: ['pg'],
      blocked: [{ flow: 'a signed-in user lists todos', needs: ['credentials'] }],
      ecosystem: 'node',
      suggestedPath: 'scripts/guard-seed.mjs',
    };
    await spawnSeedRunner(t)(seedCtx);
    push('guard.seed', c.reqs.splice(0));

    const recipeCtx: RecipeDiscoveryInput = {
      packageJson: '{"name":"relkit","bin":{"relkit":"dist/cli.js"}}',
      presentInputs: ['package.json'],
    };
    await spawnRecipeRunner(t)(recipeCtx);
    push('guard.recipe', c.reqs.splice(0));
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
  'guard.generate', // a scenario's `setup.files` / `setup.env` records
  'guard.generate.api', // the same schema, api driver
  'guard.recipe', // `env` / `servers` records
  'guard.seed', // `provides.credentials` / `provides.fixtures` records
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
    // 22 since the five spec stages became agent sessions — they build
    // no LlmRequest at all. A NEW schema-bearing call site still has to raise it.
    expect(collected.length).toBeGreaterThanOrEqual(22);
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

  it('roots EVERY stage schema in an object, opted out or not', () => {
    for (const { name, req } of collected) {
      const schema = JSON.parse(req.schema as string) as Record<string, unknown>;
      // JSON mode (the opt-out path) can only return an object, so an array- or
      // scalar-rooted contract is unanswerable there — no stage may ship one.
      expect(schema.type, `${name} must send an object-rooted schema`).toBe('object');
    }
  });

  it('pins the opt-out list — a new silent opt-out fails here', () => {
    const optedOut = collected
      .filter((c) => c.req.enforceSchema === false)
      .map((c) => c.name)
      .sort();
    expect(optedOut).toEqual(EXPECTED_OPT_OUTS);
  });

  // A guard stage that sends no schema would silently fall back to free-form JSON
  // on the API transport — the failure mode this list exists to prevent.
  it('carries a schema on EVERY guard generate stage', () => {
    const guard = collected.filter((c) => c.name.startsWith('guard.')).map((c) => c.name);
    expect(guard.sort()).toEqual([
      'guard.extract',
      'guard.fidelity',
      'guard.flows',
      'guard.flows.epic',
      'guard.generate',
      'guard.generate.api',
      'guard.match',
      'guard.recipe',
      'guard.seed',
      'guard.triage',
    ]);
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
  it('strips them from a doc extraction', async () => {
    const reply = JSON.stringify({
      claims: [
        {
          claim: 'prints its version',
          driver: 'cli',
          sectionAnchor: 'version',
          reason: 'documented',
        },
      ],
      untestable: null,
    });

    const out = await driveWithReply(jsonSchemaHint(DocExtractionSchema), reply);
    const raw = JSON.parse(out) as { claims: Array<Record<string, unknown>> };
    expect(raw).not.toHaveProperty('untestable');

    const parsed = DocExtractionSchema.parse(raw);
    expect(parsed.claims).toHaveLength(1);
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

// The opt-out buys out of strict enforcement, never of the object root: JSON mode
// answers with a JSON object, so an array-rooted contract could never be satisfied —
// on ANY provider. It throws before the call instead of failing on every reply.
describe('a non-object-rooted schema fails loudly on the JSON-mode path too', () => {
  const arrayRooted = '{"type":"array","items":{"type":"object","properties":{"ref":{"type":"string"}}}}';

  it('throws for an opted-out array-rooted schema, naming the stage and the fix', async () => {
    const { model, getFormat } = formatCapturingModel();
    buildModelMock.mockReturnValue(model);
    await expect(
      createApiTransport(cfg)({
        id: 'a:b',
        stage: 'guard.generate',
        system: 'S',
        user: 'U',
        responseFormat: 'json',
        schema: arrayRooted,
        enforceSchema: false,
      }),
    ).rejects.toThrow(/non-object-rooted response schema for stage guard\.generate.*reshape the contract/s);
    // Nothing was sent — the throw precedes the model call.
    expect(getFormat()).toBeUndefined();
  });

  it('throws the same way for every provider', async () => {
    for (const provider of ['anthropic', 'openai'] as const) {
      const { model } = formatCapturingModel();
      buildModelMock.mockReturnValue(model);
      await expect(
        createApiTransport({ provider, model: 'm', apiKey: 'test' })({
          id: 'a:b',
          stage: 'guard.generate',
          system: 'S',
          user: 'U',
          responseFormat: 'json',
          schema: arrayRooted,
          enforceSchema: false,
        }),
      ).rejects.toThrow(/JSON mode cannot return a non-object root/);
    }
  });

  it('lets an opted-out object-rooted schema through in JSON mode', async () => {
    const { model, getFormat } = formatCapturingModel();
    buildModelMock.mockReturnValue(model);
    await createApiTransport(cfg)({
      id: 'a:b',
      stage: 'guard.generate',
      system: 'S',
      user: 'U',
      responseFormat: 'json',
      schema: '{"type":"object","properties":{"claims":{"type":"array","items":{"type":"object"}}}}',
      enforceSchema: false,
    });
    expect(getFormat()?.type).toBe('json');
    expect(getFormat()?.schema).toBeUndefined();
  });
});

/**
 * The scan's five one-shot stages are agent sessions now: their schemas ride the
 * session driver's TOOLSET (the injected `outcome` tool) rather than an
 * `LlmRequest`, so they are outside the sweep above. The one rule that still
 * binds them is the one JSON mode imposes on everything — an object root.
 */
describe('spec-scan session outcome schemas', () => {
  const SCAN_OUTCOMES: Array<[string, ZodType]> = [
    ['spec-scan.curate-doc', DocVerdictSchema],
    ['spec-scan.settle-areas', AreaSettlementSchema],
    ['spec-scan.overlap', OverlapOutcomeSchema],
    ['spec-scan.orchestrate', ScanScopeOutcomeSchema],
  ];

  it('are all object-rooted', () => {
    for (const [kind, schema] of SCAN_OUTCOMES) {
      const rendered = JSON.parse(jsonSchemaHint(schema)) as { type?: string };
      expect(rendered.type, kind).toBe('object');
    }
  });
});
