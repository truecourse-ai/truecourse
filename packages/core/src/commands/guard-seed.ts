/**
 * THE SEED — the READ VIEW.
 *
 * The engine half lives in `@truecourse/guard-generator` (`seed-draft.ts`: gate →
 * draft → verify by RUNNING it → write two reviewable artifacts), and the ONE caller
 * that drives it is now `truecourse guard setup`. This module is what remains: the
 * read model behind `truecourse guard seed`.
 *
 *   {@link readGuardSeedView} — what the recipe declares today, whether the script
 *      file it names is really there, and what the last generate left blocked on
 *      missing data.
 *
 * There is deliberately no write path here any more. Drafting a seed edits
 * `recipe.json`, which moves the recipe fingerprint, which re-authors every section
 * generated against it — so it belongs in the stage that runs BEFORE the first
 * (expensive) generate, not in a command a user can reach afterwards.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { SeedBlockedFlow } from '@truecourse/guard-generator';
import { loadRecipe, recipePath, readManifest, type RecipeApiSeed } from '@truecourse/guard-runner';
import {
  MISSING_DATA_NOUN,
  parseBlockedOnCapabilities,
  parseBlockedOnClaim,
} from '@truecourse/shared';

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
  /** The flows the committed manifest records blocked on missing data (empty when none). */
  blocked: SeedBlockedFlow[];
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
  return {
    recipePath: recipeFile,
    invalidReason,
    hasApiBlock: recipe?.api !== undefined,
    seed,
    scriptPath,
    scriptExists: scriptPath !== null && fs.existsSync(path.resolve(repoRoot, scriptPath)),
    blocked: missingDataBlockedFlows(repoRoot),
  };
}

/**
 * The flows the last generate settled `blocked-on` missing data, recovered from
 * the COMMITTED `scenarios/manifest.json` — one entry per (flow, surface) gap
 * naming the `missing-data` noun, deduped by flow, so "3 flows blocked" means three
 * flows, not three gap rows.
 *
 * The manifest, not `guard/result.json`: the run-result is gitignored, so reading
 * it there left every clone (and every supplied sandbox instance, which copies the
 * repo) with an empty list while the committed manifest recorded the very same
 * gaps. The manifest is also the DURABLE record — an unchanged flow keeps its entry
 * across generates, where the report only speaks for the last run.
 */
export function missingDataBlockedFlows(repoRoot: string): SeedBlockedFlow[] {
  const byFlow = new Map<string, SeedBlockedFlow>();
  for (const flow of readManifest(repoRoot)?.flows ?? []) {
    for (const gap of flow.gaps) {
      if (gap.kind !== 'blocked-on') continue;
      const needs = parseBlockedOnCapabilities(gap.reason);
      if (!needs.some((n) => n.trim().toLowerCase().replace(/\s+/g, '-') === MISSING_DATA_NOUN)) continue;
      if (byFlow.has(flow.flowId)) continue;
      byFlow.set(flow.flowId, { flow: parseBlockedOnClaim(gap.reason) || flow.flowId, needs });
    }
  }
  return [...byFlow.values()];
}
