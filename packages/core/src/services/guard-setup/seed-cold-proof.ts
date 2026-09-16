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
 * So the seed is proved a second time from THE TREE A RUN GETS: a local `git
 * clone` of the repository — its committed state, `.git` and all, without the
 * untracked and ignored paths (`node_modules`, every build output) this tree
 * grew — with the work tree laid over it, which is exactly what a job hands a
 * run: a clone with the setup bundle materialized into it. The caches never
 * travel. In that copy the recipe's own steps run in the order a run runs them
 * — `install`, `build`, the services, the seed, the credential probes — so the
 * proof is about what a fresh checkout does, not about what this tree grew.
 *
 * A clone is the tree a run gets only when the run's own tree arrives cold: a
 * cloned repository does, a folder copied off this machine (the local provider)
 * carries the developer's dependencies and build output with it. Which one this
 * is, is the caller's to know, and it skips the proof for the second — refusing
 * a seed over an install no run of that repository ever performs would be a
 * verdict about nothing.
 *
 * The proof always runs in production; the seed session's `coldProof: false`
 * option exists for the test suite, which must not pay an install and a build
 * per case.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  DEFAULT_BUILD_TIMEOUT_MS,
  DEFAULT_INSTALL_TIMEOUT_MS,
  SeedError,
  runBuild,
  runInstall,
  runSeed,
  type Recipe,
  type RecipeApiSeed,
  type SeedResult,
} from '@truecourse/guard-runner';
import { failureReport } from '@truecourse/guard-generator';
import { WORK_TREE_DIR, workTreeCacheDir } from '@truecourse/shared/work-tree';
import { getRuntimeDir } from '../../config/runtime-dir.js';

const execFileAsync = promisify(execFile);

/** Where the cold copies live: machine-local scratch under the runtime dir,
 *  never the system temp dir (a container's root filesystem). */
const COLD_COPIES_DIR = 'seed-cold';
const COLD_COPY_PREFIX = 'tc-seed-cold-';

/** A repository can be large, and a clone copies the whole of its history. */
const CLONE_TIMEOUT_MS = 10 * 60 * 1000;

/** The dir the copies are made in, created on demand. */
export function seedColdCopiesDir(): string {
  return path.join(getRuntimeDir(), COLD_COPIES_DIR);
}

/**
 * Remove every cold copy under this machine's runtime dir. Called once at boot,
 * beside the run-clone sweep: a copy belongs to the proof that made it and dies
 * with the process, so whatever is there is what a crash left mid-install.
 */
export function sweepSeedColdCopies(): number {
  let removed = 0;
  let names: string[];
  try {
    names = fs.readdirSync(seedColdCopiesDir());
  } catch {
    return 0;
  }
  for (const name of names) {
    if (!name.startsWith(COLD_COPY_PREFIX)) continue;
    try {
      fs.rmSync(path.join(seedColdCopiesDir(), name), { recursive: true, force: true });
      removed += 1;
    } catch {
      // best-effort
    }
  }
  return removed;
}

/** Where a failure happened, in the words the refusal names. */
export type ColdProofStage = 'install' | 'build' | 'services' | 'seed' | 'probe';

export type ColdCloneProofResult = { ok: true } | { ok: false; stage: ColdProofStage; reason: string };

/** One tree's `api.services` lifecycle — the handle the warm proof drives its
 *  own world with, built by the caller over the copy this one made. */
export interface ColdProofServices {
  up: () => Promise<void>;
  down: () => Promise<void>;
  reset: () => Promise<void>;
}

export interface ColdCloneProofInput {
  /** The tree to clone — the repository the fold just wrote the seed into. */
  repoRoot: string;
  recipe: Recipe;
  /** The seed as the fold wrote it; runs against the copy. */
  seed: RecipeApiSeed;
  /** The server env the seed runs with, exactly as the warm proof uses it. */
  env: Record<string, string>;
  /** The services lifecycle, over the copy this proof makes. */
  services: (copyRoot: string) => ColdProofServices;
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
  stage,
  reason: `the cold-clone proof refused the seed: ${stage} — ${detail}`,
});

/**
 * Build the tree a run gets out of the tree setup worked in: clone the
 * repository into `destRoot` (its committed state, `.git` kept — a build that
 * asks git what it is building still has an answer), then lay the work tree
 * over it, minus the caches, the way a job materializes the setup bundle into a
 * fresh clone. A seed script the recipe points at OUTSIDE the work tree travels
 * too: the fold has only just written it, so no commit carries it.
 *
 * Throws when the tree cannot be cloned — the caller refuses the seed rather
 * than proving it against a tree it could not make.
 */
async function cloneRepoCold(repoRoot: string, destRoot: string, seedScript?: string): Promise<void> {
  const root = path.resolve(repoRoot);
  await execFileAsync('git', ['clone', root, destRoot], {
    timeout: CLONE_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
    // A local clone reads no remote; a prompt would hang the proof.
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'true' },
  });

  const cacheDir = path.resolve(workTreeCacheDir(root, ''));
  const workTree = path.join(root, WORK_TREE_DIR);
  if (fs.existsSync(workTree)) {
    await fs.promises.cp(workTree, path.join(destRoot, WORK_TREE_DIR), {
      recursive: true,
      filter: (src) => path.resolve(src) !== cacheDir,
    });
  }
  if (seedScript !== undefined && !seedScript.startsWith(`${WORK_TREE_DIR}/`)) {
    const from = path.resolve(root, seedScript);
    if (fs.existsSync(from)) {
      const to = path.resolve(destRoot, seedScript);
      await fs.promises.mkdir(path.dirname(to), { recursive: true });
      await fs.promises.cp(from, to);
    }
  }
}

/**
 * Run the recipe's preparation steps, the seed and the credential probes in a
 * cold clone of the repository. Every failure names its stage and, for the shell
 * steps, carries the tail of what the command printed. Never throws for a
 * failing step; a thrown clone (an unreadable tree, a cancellation) is the
 * caller's to catch, and the copy is removed either way.
 */
export async function proveSeedFromColdClone(input: ColdCloneProofInput): Promise<ColdCloneProofResult> {
  const { recipe, signal } = input;
  fs.mkdirSync(seedColdCopiesDir(), { recursive: true });
  const copyRoot = fs.mkdtempSync(path.join(seedColdCopiesDir(), COLD_COPY_PREFIX));
  const services = input.services(copyRoot);
  // Whether `up` was ATTEMPTED — a bring-up that failed halfway has containers
  // to tear down too.
  let servicesAttempted = false;
  try {
    input.onPhase?.('proving the seed from a cold clone', 'cold-clone proof');
    await cloneRepoCold(input.repoRoot, copyRoot, input.seed.script);

    if (recipe.install) {
      const installed = await runInstall(copyRoot, recipe.install, recipe.env, DEFAULT_INSTALL_TIMEOUT_MS, signal);
      if (!installed.ok) {
        return refuse(
          'install',
          `\`${recipe.install}\` failed${installed.timedOut ? ' (timed out)' : ''} in a tree with no \`node_modules\`:\n${failureReport(installed.output, copyRoot)}`,
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
          `the recipe \`${what}\` \`${command}\` failed${built.timedOut ? ' (timed out)' : ''} in a cold clone:\n${failureReport(built.output, copyRoot)}`,
        );
      }
    }

    if (recipe.api?.services) {
      // The wipe first: the copy addresses the warm world's datastore (one
      // compose project, one database URL), so the proof starts from a state
      // the warm run did not leave behind.
      await services.reset();
      servicesAttempted = true;
      try {
        await services.up();
      } catch (error) {
        return refuse('services', `${message(error)} — in a cold clone`);
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
      const detail = error instanceof SeedError ? error.message : message(error);
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
    if (servicesAttempted) {
      // Best effort, and never a verdict: the stop, then the wipe, so nothing
      // the proof brought up outlives it.
      await services.down().catch(() => undefined);
      await services.reset().catch(() => undefined);
    }
    await fs.promises.rm(copyRoot, { recursive: true, force: true });
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
