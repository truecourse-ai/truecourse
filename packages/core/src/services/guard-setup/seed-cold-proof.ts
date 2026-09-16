/**
 * THE COLD-CLONE PROOF — the seed fold's second gate.
 *
 * The fresh-world proof runs in the SAME tree the setup sessions iterated in,
 * whose `node_modules` has accumulated whatever every earlier attempt left
 * behind. That hides a whole class of defect: a recipe `install` that skips
 * native builds still boots an app whose binding was compiled by an EARLIER,
 * un-skipped install, and the seed only crashes later, in a clone that ran the
 * shipped install exactly once — after generation has already been refused.
 *
 * So the seed is proved a second time from a COLD COPY of the repository: the
 * tree without any `node_modules` and without `.git`, carrying the work tree's
 * scenarios (the recipe and the just-written seed script) but not its caches.
 * In that copy the recipe's own steps run in the order a run runs them —
 * `install`, `build`, the services, the seed, the credential probes — so the
 * proof is about what a fresh checkout does, not about what this tree grew.
 *
 * `TRUECOURSE_SEED_COLD_PROOF=0` opts out (it costs one full install+build);
 * the proof is ON by default, because what it catches is unrecoverable later.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_BUILD_TIMEOUT_MS,
  DEFAULT_INSTALL_TIMEOUT_MS,
  SeedError,
  buildOutputTail,
  runBuild,
  runInstall,
  runSeed,
  type Recipe,
  type RecipeApiSeed,
  type SeedResult,
} from '@truecourse/guard-runner';
import { workTreeCacheDir } from '@truecourse/shared/work-tree';

/** The opt-out: set to `0` to skip the cold-clone proof entirely. */
export const SEED_COLD_PROOF_ENV = 'TRUECOURSE_SEED_COLD_PROOF';

/** Whether the fold should run the cold-clone proof. Default ON. */
export function coldProofEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[SEED_COLD_PROOF_ENV] !== '0';
}

/** Where a failure happened, in the words the refusal names. */
export type ColdProofStage = 'install' | 'build' | 'services' | 'seed' | 'probe';

export type ColdCloneProofResult = { ok: true } | { ok: false; reason: string };

export interface ColdCloneProofInput {
  /** The tree to copy — the repository the fold just wrote the seed into. */
  repoRoot: string;
  recipe: Recipe;
  /** The seed as the fold wrote it; runs against the copy. */
  seed: RecipeApiSeed;
  /** The server env the seed runs with, exactly as the warm proof uses it. */
  env: Record<string, string>;
  /**
   * The web surface's build command, when a web principal will be probed — the
   * copy has no built client either, and an unbuilt one fails the page load for
   * a reason that has nothing to do with the seed.
   */
  webBuild?: string;
  knownCredentials?: ReadonlyMap<string, string>;
  signal?: AbortSignal;
  onPhase?: (running: string, done: string) => void;
  /**
   * Prove the copy's minted credentials against a server booted FROM THE COPY.
   * The caller owns what "probed" means; omitted when the seed mints nothing.
   */
  probe?: (copyRoot: string, result: SeedResult) => Promise<{ ok: true } | { ok: false; reason: string }>;
}

const refuse = (stage: ColdProofStage, detail: string): ColdCloneProofResult => ({
  ok: false,
  reason: `the cold-clone proof refused the seed: ${stage} — ${detail}`,
});

/**
 * Copy `repoRoot` into `destRoot` as a fresh checkout would look: no
 * `node_modules` at any depth, no `.git`, and none of the work tree's caches —
 * but the rest of the work tree (the recipe, the scenarios, the seed script)
 * travels, because that is what the proof runs.
 */
export function copyRepoCold(repoRoot: string, destRoot: string): void {
  const cacheDir = path.resolve(workTreeCacheDir(repoRoot, ''));
  fs.cpSync(repoRoot, destRoot, {
    recursive: true,
    filter: (src) => {
      const name = path.basename(src);
      if (name === 'node_modules' || name === '.git') return false;
      return path.resolve(src) !== cacheDir;
    },
  });
}

/**
 * Run the recipe's preparation steps, the seed and the credential probes in a
 * cold copy of the repository. Every failure names its stage and, for the shell
 * steps, carries the tail of what the command printed.
 */
export async function proveSeedFromColdClone(input: ColdCloneProofInput): Promise<ColdCloneProofResult> {
  const { recipe, signal } = input;
  const services = recipe.api?.services;
  const copyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-seed-cold-'));
  let servicesUp = false;
  try {
    input.onPhase?.('proving the seed from a cold clone', 'cold-clone proof');
    copyRepoCold(input.repoRoot, copyRoot);

    if (recipe.install) {
      const installed = await runInstall(copyRoot, recipe.install, recipe.env, DEFAULT_INSTALL_TIMEOUT_MS, signal);
      if (!installed.ok) {
        return refuse(
          'install',
          `\`${recipe.install}\` failed${installed.timedOut ? ' (timed out)' : ''} in a tree with no \`node_modules\`:\n${buildOutputTail(installed.output)}`,
        );
      }
    }
    for (const [what, command] of [
      ['build', recipe.build],
      ['web build', input.webBuild],
    ] as const) {
      if (!command) continue;
      const built = await runBuild(copyRoot, command, recipe.env, DEFAULT_BUILD_TIMEOUT_MS, signal);
      if (!built.ok) {
        return refuse(
          'build',
          `the recipe \`${what}\` \`${command}\` failed${built.timedOut ? ' (timed out)' : ''} in a cold clone:\n${buildOutputTail(built.output)}`,
        );
      }
    }

    if (services) {
      // `reset` first when the recipe has one: the copy shares the warm world's
      // datastore (a compose project, a database URL), so the proof starts from
      // a state the warm run did not leave behind.
      for (const command of [services.reset, services.up]) {
        if (!command) continue;
        const ran = await runBuild(copyRoot, command, recipe.env, DEFAULT_BUILD_TIMEOUT_MS, signal);
        if (command === services.up) servicesUp = ran.ok;
        if (!ran.ok) {
          return refuse(
            'services',
            `\`${command}\` failed${ran.timedOut ? ' (timed out)' : ''} in a cold clone: ${buildOutputTail(ran.output, 5)}`,
          );
        }
      }
    }

    let seeded: SeedResult;
    try {
      seeded = await runSeed({
        repoRoot: copyRoot,
        seed: input.seed,
        env: input.env,
        timeoutMs: DEFAULT_BUILD_TIMEOUT_MS,
        ...(input.knownCredentials ? { knownCredentials: input.knownCredentials } : {}),
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      const detail = error instanceof SeedError ? error.message : error instanceof Error ? error.message : String(error);
      return refuse(
        'seed',
        `the seed does not run in a tree the recipe's own \`install\` prepared — what survives in this repository's working tree does not survive a fresh checkout:\n${detail}`,
      );
    }

    if (input.probe) {
      const probed = await input.probe(copyRoot, seeded);
      if (!probed.ok) return refuse('probe', probed.reason);
    }
    return { ok: true };
  } finally {
    if (servicesUp && services?.down) {
      // Best effort: the warm world is already down, and a copy that will not
      // tear down must not mask the verdict above.
      await runBuild(copyRoot, services.down, recipe.env, DEFAULT_BUILD_TIMEOUT_MS).catch(() => undefined);
    }
    fs.rmSync(copyRoot, { recursive: true, force: true });
  }
}
