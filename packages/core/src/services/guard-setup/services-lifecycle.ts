/**
 * One `api.services` lifecycle handle — up/down/reset through `runBuild`,
 * exactly as `verifyProposal` runs them, teardown always safe to call twice.
 * The seed session and the interfaces step's live screens both stand a world
 * up this way, so the rules live once.
 *
 * The FIRST bring-up wipes when the tree carries the world-dirty marker: the
 * compose project is named after the repository, so one shared world outlives
 * every job of it, and a run that was cancelled or crashed mid-scenario left
 * its rows behind for this setup's baseline assertions to inherit.
 */

import fs from 'node:fs';
import {
  DEFAULT_BUILD_TIMEOUT_MS,
  guardWorldDirtyMarkerPath,
  runBuild,
  type Recipe,
} from '@truecourse/guard-runner';

export interface ServicesController {
  up(): Promise<void>;
  down(): Promise<void>;
  /** The wipe (`down -v`), when the recipe declares one; a no-op otherwise.
   *  Best-effort: a reset that fails is not a verdict, the `up` after it is. */
  reset(): Promise<void>;
}

export function servicesController(repoRoot: string, recipe: Recipe, signal?: AbortSignal): ServicesController {
  const services = recipe.api?.services;
  let up = false;
  return {
    async up(): Promise<void> {
      if (!services) return;
      const marker = guardWorldDirtyMarkerPath(repoRoot);
      if (services.reset && fs.existsSync(marker)) {
        await runBuild(repoRoot, services.reset, recipe.env, DEFAULT_BUILD_TIMEOUT_MS, signal);
        fs.rmSync(marker, { force: true });
      }
      const result = await runBuild(repoRoot, services.up, recipe.env, DEFAULT_BUILD_TIMEOUT_MS, signal);
      if (!result.ok) {
        throw new Error(
          `\`${services.up}\` failed${result.timedOut ? ' (timed out)' : ''}: ${outputTail(result.output)}`,
        );
      }
      up = true;
    },
    async down(): Promise<void> {
      if (!services?.down || !up) return;
      up = false;
      await runBuild(repoRoot, services.down, recipe.env, DEFAULT_BUILD_TIMEOUT_MS);
    },
    async reset(): Promise<void> {
      if (!services?.reset) return;
      up = false;
      await runBuild(repoRoot, services.reset, recipe.env, DEFAULT_BUILD_TIMEOUT_MS, signal);
    },
  };
}

/** The last five lines of a command's output on one line — what a failure names. */
export function outputTail(output: string): string {
  return output.trimEnd().split('\n').slice(-5).join(' / ');
}
