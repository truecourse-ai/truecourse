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
import { z, type ZodType } from 'zod';
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

// --- guard-generator ---------------------------------------------------------
// Guard generate keeps exactly TWO one-shot stages: realization
// matching and recipe discovery. Extraction, flow synthesis, authoring, the
// evidence retry, fidelity review and triage are agent SESSIONS (or retired), so
// they build no `LlmRequest` and contribute nothing to the sweep below — their
// outcome schemas are checked object-rooted in their own describe at the end.
import { DocExtractionSchema, FlowSetSchema } from '../../packages/guard-generator/src/schemas.js';
import {
  spawnMatchRunner,
  spawnRecipeRunner,
} from '../../packages/guard-generator/src/runners.js';
import type {
  MatchUserContext,
  RecipeDiscoveryInput,
} from '../../packages/guard-generator/src/prompts.js';

// --- guard generate ----------------------------------------------------------
import { ExtractOutcomeSchema, GuardFlowWorkerOutcomeSchema } from '../../packages/shared/src/index.js';
import { EpicSynthesisSchema } from '../../packages/guard-generator/src/schemas.js';
import { FidelityVerdictSchema } from '../../packages/core/src/services/guard-generate/fidelity.js';

// --- guard setup -------------------------------------------------------------
// Six one-shot stages became agent SESSIONS here too; like the scan's, their
// outcome schemas ride the driver's toolset and are checked object-rooted below.
import { RecipeProposalSchema } from '../../packages/guard-generator/src/schemas.js';
import { CatalogDraftSchema } from '../../packages/core/src/services/guard-setup/dependency-catalog.js';
import { ReconcileResolutionsSchema } from '../../packages/core/src/services/guard-setup/reconcile-interfaces.js';
import { SeedSessionOutcomeSchema } from '../../packages/core/src/services/guard-setup/seed-session.js';
import { AuthProofOutcomeSchema } from '../../packages/core/src/services/guard-setup/auth-proof.js';

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

  // guard generate — the two remaining one-shot runners, driven with a minimal context
  {
    const c = capture();
    const t = { transport: c.transport };
    const flow = { id: 'checkout', title: 'A shopper checks out', goal: 'buy a thing' };

    const matchCtx: MatchUserContext = {
      flow,
      milestones: [{ order: 1, claim: 'prints the version' }],
      surface: 'cli',
      interfaces: [{ id: 'j1', title: 'version', entry: 'relkit --version', steps: ['invoke relkit --version'] }],
    };
    await spawnMatchRunner(t)(matchCtx);
    push('guard.match', c.reqs.splice(0));

    const recipeCtx: RecipeDiscoveryInput = {
      packageJson: '{"name":"relkit","bin":{"relkit":"dist/cli.js"}}',
      presentInputs: ['package.json'],
    };
    await spawnRecipeRunner(t)(recipeCtx);
    push('guard.recipe', c.reqs.splice(0));
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
  'guard.recipe', // `env` / `servers` records
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
    // The spec stages, the seed draft and guard generate's content stages are
    // agent sessions — they build no LlmRequest at all. A NEW schema-bearing
    // call site still has to raise this floor.
    expect(collected.length).toBeGreaterThanOrEqual(2);
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
    // Two one-shots left. A stage reappearing here means a
    // session was quietly turned back into a transport call.
    expect(guard.sort()).toEqual(['guard.match', 'guard.recipe']);
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

  it('keeps a null the schema legitimately allows', async () => {
    const Schema = z.object({ targetServiceId: z.string().nullable() });
    const out = await driveWithReply(
      jsonSchemaHint(Schema),
      JSON.stringify({ targetServiceId: null }),
    );
    expect(Schema.parse(JSON.parse(out)).targetServiceId).toBeNull();
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

/**
 * The guard-setup sessions reach a provider the same way:
 * the api driver renders the outcome schema as the injected `outcome` TOOL's
 * input schema, and the Agent SDK driver hands it to `outputFormat.json_schema`.
 * Both places take a JSON SCHEMA OBJECT — a tool's `input_schema` must be
 * `type: "object"` on every provider — so the object-root rule binds a session
 * outcome exactly as it binds a JSON-mode stage.
 */
describe('guard-setup session outcome schemas', () => {
  const SETUP_OUTCOMES: Array<[string, ZodType]> = [
    ['guard-setup.recipe-repair', RecipeProposalSchema],
    ['guard-setup.dependency-catalog', CatalogDraftSchema],
    ['guard-setup.reconcile-interfaces', ReconcileResolutionsSchema],
    ['guard-setup.seed', SeedSessionOutcomeSchema],
    ['guard-setup.auth-proof', AuthProofOutcomeSchema],
  ];

  it('are all object-rooted', () => {
    for (const [kind, schema] of SETUP_OUTCOMES) {
      const rendered = JSON.parse(jsonSchemaHint(schema)) as { type?: string };
      expect(rendered.type, kind).toBe('object');
    }
  });
});

/**
 * Guard generate's six content stages became sessions the same way, so the same
 * rule binds them: the api session driver renders each
 * `outcomeSchema` as the injected `outcome` TOOL's `inputSchema`
 * (`packages/llm-api/src/session-driver.ts` → `buildToolset`), and a tool's
 * input schema must be `type: "object"` on every provider — an `anyOf` root is
 * rejected before the model ever sees the session.
 */
describe('guard-generate session outcome schemas', () => {
  const GENERATE_OUTCOMES: Array<[string, ZodType]> = [
    ['guard-generate.extract', ExtractOutcomeSchema],
    ['guard-generate.flows', FlowSetSchema],
    ['guard-generate.flows (epic)', EpicSynthesisSchema],
    ['guard-generate.flow-worker', GuardFlowWorkerOutcomeSchema],
    ['guard-generate.fidelity', FidelityVerdictSchema],
  ];

  it('are all object-rooted', () => {
    const roots = GENERATE_OUTCOMES.map(([kind, schema]) => {
      const rendered = JSON.parse(jsonSchemaHint(schema)) as { type?: string };
      return `${kind}: ${rendered.type ?? Object.keys(rendered)[0]}`;
    });
    expect(roots).toEqual(GENERATE_OUTCOMES.map(([kind]) => `${kind}: object`));
  });
});
