/**
 * THE SEED — the read view and the standalone drafting run (item 66, stage 1).
 *
 * The engine half lives in `@truecourse/guard-generator` (`seed-draft.ts`: gate →
 * draft → verify by RUNNING it → write two reviewable artifacts). THIS module is
 * the adapter `truecourse guard seed` and the dashboard call:
 *
 *   {@link readGuardSeedView}   — what the recipe declares today, whether the
 *      script file it names is really there, what the last generate left blocked on
 *      missing data, and how the last drafting attempt went.
 *   {@link guardSeedDraftInProcess} — `guard seed --init`: the SAME drafting stage
 *      `guard generate` runs, over the LAST generate's missing-data gaps, so it can
 *      be driven without paying for a whole generate.
 *
 * Working-tree only, by design: it writes files inside the repo.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  draftSeed,
  seedDraftGate,
  spawnSeedRunner,
  type DraftSeedResult,
  type SeedBlockedFlow,
  type SeedRunner,
} from '@truecourse/guard-generator';
import { loadRecipe, recipePath, readGuardResult, type RecipeApiSeed } from '@truecourse/guard-runner';
import {
  MISSING_DATA_NOUN,
  parseBlockedOnCapabilities,
  parseBlockedOnClaim,
  type GuardSeedDraft,
} from '@truecourse/shared';
import { resolveFallbackModel, resolveModel } from '../config/llm-models.js';
import { mapJourneys } from '../services/journey.service.js';
import { agentTransport, getDefaultTransport, type LlmTransport } from '@truecourse/shared/llm';

/** Everything `truecourse guard seed` (no flags) prints, in one read. */
export interface GuardSeedView {
  /** Absolute path to recipe.json — shown whether or not it exists. */
  recipePath: string;
  /** Why the recipe could not be read; null when it is fine (or simply absent). */
  invalidReason: string | null;
  /** True when the recipe exists, parses, and carries an `api` block. */
  hasApiBlock: boolean;
  /** The declared seed, or null when the recipe declares none. */
  seed: RecipeApiSeed | null;
  /** Repo-relative script path the seed NAMES (`api.seed.script`), when it does. */
  scriptPath: string | null;
  /** False when `scriptPath` names a file that is not on disk — a broken seed. */
  scriptExists: boolean;
  /** The flows the last generate left blocked on missing data (empty when none). */
  blocked: SeedBlockedFlow[];
  /**
   * The last drafting attempt's verdict, straight off `guard/result.json`. Null
   * when no generate has run, or when the stage never fired on the last one.
   */
  lastDraft: GuardSeedDraft | null;
}

/** The joined seed view for `repoRoot`. Every input is optional — this is the
 *  command a user runs BEFORE any of them exist. */
export function readGuardSeedView(repoRoot: string): GuardSeedView {
  const recipeFile = recipePath(repoRoot);
  let recipe = null;
  let invalidReason: string | null = null;
  try {
    recipe = loadRecipe(repoRoot, recipeFile)?.recipe ?? null;
  } catch (e) {
    invalidReason = e instanceof Error ? e.message : String(e);
  }
  const seed = recipe?.api?.seed ?? null;
  const scriptPath = seed?.script ?? null;
  const report = readGuardResult(repoRoot);
  return {
    recipePath: recipeFile,
    invalidReason,
    hasApiBlock: recipe?.api !== undefined,
    seed,
    scriptPath,
    scriptExists: scriptPath !== null && fs.existsSync(path.resolve(repoRoot, scriptPath)),
    blocked: missingDataBlockedFlows(repoRoot),
    lastDraft: report?.seedDraft ?? null,
  };
}

/**
 * The flows the LAST generate settled `blocked-on` missing data, recovered from
 * the persisted gaps. One entry per (flow, surface) gap that names item 60's noun,
 * deduped by flow — the same unit the externals view tallies by, so "3 flows
 * blocked" means three flows, not three gap rows.
 */
export function missingDataBlockedFlows(repoRoot: string): SeedBlockedFlow[] {
  const report = readGuardResult(repoRoot);
  const byFlow = new Map<string, SeedBlockedFlow>();
  for (const gap of report?.coverageGaps ?? []) {
    if (gap.kind !== 'blocked-on') continue;
    const needs = parseBlockedOnCapabilities(gap.reason);
    if (!needs.some((n) => n.trim().toLowerCase().replace(/\s+/g, '-') === MISSING_DATA_NOUN)) continue;
    const flow = parseBlockedOnClaim(gap.reason) || gap.anchor;
    const key = gap.flowId ?? `${gap.doc}\0${gap.anchor}`;
    if (!byFlow.has(key)) byFlow.set(key, { flow, needs });
  }
  return [...byFlow.values()];
}

export interface GuardSeedDraftOptions {
  /** LLM transport: `cli` (default) or `agent` (mailbox under `io`). */
  llm?: 'cli' | 'agent';
  io?: string;
  /** Test seam: the drafting model (production spawns the transport). */
  seedRunner?: SeedRunner;
}

export type GuardSeedDraftInProcessResult =
  /** No missing-data gap in the last generate's report — nothing to draft. */
  | { status: 'no-gaps'; reason: string }
  | DraftSeedResult;

/**
 * `guard seed --init` — draft, verify, and write the seed for the LAST generate's
 * missing-data gaps. It never re-runs authoring: the gaps are an authoring OUTPUT,
 * so a repo that has not generated yet is told to generate first rather than
 * silently drafting against nothing.
 */
export async function guardSeedDraftInProcess(
  repoRoot: string,
  options: GuardSeedDraftOptions = {},
): Promise<GuardSeedDraftInProcessResult> {
  const blocked = missingDataBlockedFlows(repoRoot);
  if (blocked.length === 0) {
    return {
      status: 'no-gaps',
      reason: readGuardResult(repoRoot)
        ? 'the last `truecourse guard generate` left no flow blocked on missing data — there is nothing for a seed to unblock'
        : 'no `truecourse guard generate` has run yet — a seed is drafted against the flows authoring could not write',
    };
  }
  const recipe = loadRecipe(repoRoot, recipePath(repoRoot))?.recipe ?? null;
  // The cheap gates FIRST: no analysis pass is paid for a repo the stage would
  // refuse anyway (no api block, a seed already declared).
  const cheapGate = seedDraftGate({ recipe, blocked });
  if (!cheapGate.ok) return { status: 'skipped', reason: cheapGate.reason };

  const mapped = await mapJourneys(repoRoot);
  return draftSeed({
    repoRoot,
    recipe: recipe!,
    blocked,
    database: mapped.database,
    runner: options.seedRunner ?? spawnSeedRunner({
      transport: resolveTransport(options),
      model: resolveModel('guard.seed', undefined, repoRoot),
      fallbackModel: resolveFallbackModel(repoRoot) ?? undefined,
    }),
  });
}

function resolveTransport(options: { llm?: 'cli' | 'agent'; io?: string }): LlmTransport | undefined {
  if (options.llm === 'agent') {
    if (!options.io) {
      throw new Error('--llm agent requires --io <dir> (the request/response mailbox directory)');
    }
    return agentTransport(options.io);
  }
  return getDefaultTransport();
}
