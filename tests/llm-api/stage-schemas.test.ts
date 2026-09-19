/**
 * THE GATE ON EVERY OUTCOME SCHEMA THE PRODUCT ACTUALLY SENDS.
 *
 * Every LLM call is a turn of a session, and every session ends by producing a
 * structured outcome. Both backends render that outcome schema for the
 * provider: the api driver as the injected `outcome` TOOL's input schema
 * (`packages/llm-api/src/session-driver.ts` → `buildToolset`), the Agent SDK
 * driver as `outputFormat.json_schema`. Both places take a JSON SCHEMA OBJECT —
 * a tool's `input_schema` must be `type: "object"` on every provider — so an
 * `anyOf`- or array-rooted contract is rejected before the model ever sees the
 * session.
 *
 * This file is the list of every session kind the product runs, checked against
 * that one rule. A new kind that does not appear here is a kind nothing pins.
 */

import { describe, it, expect } from 'vitest';
import type { ZodType } from 'zod';
import { jsonSchemaHint } from '@truecourse/shared/llm';

// --- spec scan ---------------------------------------------------------------
import { DocVerdictSchema } from '../../packages/core/src/services/spec-scan/curate-doc';
import { AreaSettlementSchema } from '../../packages/core/src/services/spec-scan/settle-areas';
import { OverlapOutcomeSchema } from '../../packages/core/src/services/spec-scan/overlap';
import { ScanScopeOutcomeSchema } from '../../packages/core/src/services/spec-scan/orchestrate';

// --- guard generate ----------------------------------------------------------
import { ExtractOutcomeSchema, GuardFlowWorkerOutcomeSchema, GuardVisualJudgmentSchema } from '../../packages/shared/src/index.js';
import {
  ClaimDiffSchema,
  EpicSynthesisSchema,
  FlowSetSchema,
  RealizationMatchSchema,
  RecipeProposalSchema,
  WorldClassifySchema,
} from '../../packages/guard-generator/src/schemas.js';
import { FidelityVerdictSchema } from '../../packages/core/src/services/guard-generate/fidelity.js';

// --- guard setup -------------------------------------------------------------
import { CatalogDraftSchema } from '../../packages/core/src/services/guard-setup/dependency-catalog.js';
import { ReconcileResolutionsSchema } from '../../packages/core/src/services/guard-setup/reconcile-interfaces.js';
import { SeedSessionOutcomeSchema } from '../../packages/core/src/services/guard-setup/seed-session.js';
import { AuthProofOutcomeSchema } from '../../packages/core/src/services/guard-setup/auth-proof.js';
import { StateReconcileResponseSchema } from '../../packages/core/src/services/interface-author/reconcile.js';

/** Every session kind the product runs, with the schema its outcome must fit. */
const OUTCOMES: Array<[string, ZodType]> = [
  ['spec-scan.orchestrate', ScanScopeOutcomeSchema],
  ['spec-scan.curate-doc', DocVerdictSchema],
  ['spec-scan.settle-areas', AreaSettlementSchema],
  ['spec-scan.overlap', OverlapOutcomeSchema],
  ['guard-setup.recipe-propose', RecipeProposalSchema],
  ['guard-setup.recipe-repair', RecipeProposalSchema],
  ['guard-setup.dependency-catalog', CatalogDraftSchema],
  ['guard-setup.reconcile-interfaces', ReconcileResolutionsSchema],
  ['guard-setup.state-reconcile', StateReconcileResponseSchema],
  ['guard-setup.seed', SeedSessionOutcomeSchema],
  ['guard-setup.auth-proof', AuthProofOutcomeSchema],
  ['guard-generate.extract', ExtractOutcomeSchema],
  ['guard-generate.flows', FlowSetSchema],
  ['guard-generate.flows (epic)', EpicSynthesisSchema],
  ['guard-generate.match', RealizationMatchSchema],
  ['guard-generate.claim-diff', ClaimDiffSchema],
  ['guard-generate.world-classify', WorldClassifySchema],
  ['guard-generate.flow-worker', GuardFlowWorkerOutcomeSchema],
  ['guard-generate.fidelity', FidelityVerdictSchema],
  ['guard-run.visual-judge', GuardVisualJudgmentSchema],
];

describe('session outcome schemas', () => {
  it('are all object-rooted', () => {
    const roots = OUTCOMES.map(([kind, schema]) => {
      const rendered = JSON.parse(jsonSchemaHint(schema)) as { type?: string };
      return `${kind}: ${rendered.type ?? Object.keys(rendered)[0]}`;
    });
    expect(roots).toEqual(OUTCOMES.map(([kind]) => `${kind}: object`));
  });

  it('covers every LEAF judgement — a one-turn session is still a session', () => {
    const kinds = OUTCOMES.map(([kind]) => kind);
    for (const leaf of [
      'guard-setup.recipe-propose',
      'guard-setup.state-reconcile',
      'guard-generate.match',
      'guard-generate.claim-diff',
      'guard-generate.world-classify',
      'guard-run.visual-judge',
    ]) {
      expect(kinds, `${leaf} must be pinned here`).toContain(leaf);
    }
  });
});
