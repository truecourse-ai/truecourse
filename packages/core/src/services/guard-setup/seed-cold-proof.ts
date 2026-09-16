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
 * So the seed is proved a second time from a COLD COPY of the repository: what
 * a fresh checkout holds — nothing git ignores (no `node_modules`, no build
 * output), no `.git` — plus the work tree's scenarios (the recipe and the
 * just-written seed script), never its caches. In that copy the recipe's own
 * steps run in the order a run runs them — `install`, `build`, the services,
 * the seed, the credential probes — so the proof is about what a fresh
 * checkout does, not about what this tree grew.
 *
 * The proof is on by default; the seed session takes a `coldProof: false`
 * option for a caller that must not pay the install and build (the test
 * suite). What it catches is unrecoverable later, so nothing in production
 * turns it off.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
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
import { failureReport } from '@truecourse/guard-generator';
import { WORK_TREE_DIR, workTreeCacheDir } from '@truecourse/shared/work-tree';
import { getRuntimeDir } from '../../config/runtime-dir.js';

/** Where the cold copies live: machine-local scratch under the runtime dir,
 *  never the system temp dir (a container's root filesystem). */
const COLD_COPIES_DIR = 'seed-cold';
const COLD_COPY_PREFIX = 'tc-seed-cold-';

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
  stage,
  reason: `the cold-clone proof refused the seed: ${stage} — ${detail}`,
});

/**
 * Copy `repoRoot` into `destRoot` as a fresh checkout would look: nothing git
 * ignores (which is where `node_modules` and every build output live), no
 * `.git`, and none of the work tree's caches — but the rest of the work tree
 * (the recipe, the scenarios, the seed script) travels, because that is what
 * the proof runs. Without git to ask, `node_modules` at any depth is the one
 * thing left out.
 *
 * Symlinks are copied verbatim: a relative link stays relative inside the copy
 * instead of being resolved to an absolute path back into the warm tree, which
 * would make the "cold" copy read the tree it exists to be isolated from.
 */
export async function copyRepoCold(repoRoot: string, destRoot: string): Promise<void> {
  const root = path.resolve(repoRoot);
  const cacheDir = path.resolve(workTreeCacheDir(root, ''));
  const workTree = path.join(root, WORK_TREE_DIR);
  const ignored = gitIgnoredPaths(root);
  await fs.promises.cp(root, destRoot, {
    recursive: true,
    verbatimSymlinks: true,
    filter: (src) => {
      const name = path.basename(src);
      if (name === 'node_modules' || name === '.git') return false;
      const abs = path.resolve(src);
      if (abs === cacheDir) return false;
      // The work tree is git-ignored by convention and must travel anyway.
      if (abs === workTree || abs.startsWith(workTree + path.sep)) return true;
      return !ignored.has(abs);
    },
  });
}

/**
 * Every path git ignores under `root`, directories collapsed to one entry (git
 * does not descend into an ignored directory), as absolute paths. Empty when
 * `root` is not a git checkout or git is unavailable.
 */
function gitIgnoredPaths(root: string): Set<string> {
  try {
    const out = execFileSync(
      'git',
      ['-C', root, 'ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory'],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 },
    );
    return new Set(
      out
        .split('\0')
        .filter(Boolean)
        .map((rel) => path.resolve(root, rel.replace(/\/$/, ''))),
    );
  } catch {
    return new Set();
  }
}

/**
 * Run the recipe's preparation steps, the seed and the credential probes in a
 * cold copy of the repository. Every failure names its stage and, for the shell
 * steps, carries the tail of what the command printed. Never throws for a
 * failing step; a thrown copy (an unreadable directory, a cancellation) is the
 * caller's to catch, and the copy is removed either way.
 */
export async function proveSeedFromColdClone(input: ColdCloneProofInput): Promise<ColdCloneProofResult> {
  const { recipe, signal } = input;
  const services = recipe.api?.services;
  fs.mkdirSync(seedColdCopiesDir(), { recursive: true });
  const copyRoot = fs.mkdtempSync(path.join(seedColdCopiesDir(), COLD_COPY_PREFIX));
  // Whether `up` was ATTEMPTED — a bring-up that failed halfway has containers
  // to tear down too.
  let servicesAttempted = false;
  try {
    input.onPhase?.('proving the seed from a cold clone', 'cold-clone proof');
    await copyRepoCold(input.repoRoot, copyRoot);

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

    if (services) {
      // The wipe first when the recipe has one: the copy shares the warm world's
      // datastore (one compose project, one database URL), so the proof starts
      // from a state the warm run did not leave behind. A reset that fails is
      // not a verdict — there may be nothing to wipe — but it is part of the
      // story when the bring-up fails after it.
      const reset = services.reset
        ? await runBuild(copyRoot, services.reset, recipe.env, DEFAULT_BUILD_TIMEOUT_MS, signal)
        : null;
      servicesAttempted = true;
      const up = await runBuild(copyRoot, services.up, recipe.env, DEFAULT_BUILD_TIMEOUT_MS, signal);
      if (!up.ok) {
        const wipe =
          reset && !reset.ok
            ? `\`${services.reset}\` ran first and failed: ${buildOutputTail(reset.output, 5)}\n`
            : '';
        return refuse(
          'services',
          `\`${services.up}\` failed${up.timedOut ? ' (timed out)' : ''} in a cold clone: ${wipe}${buildOutputTail(up.output, 5)}`,
        );
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
    if (servicesAttempted) {
      // Best effort, and never a verdict: the stop, then the wipe, so nothing
      // the proof brought up outlives it — `down` is optional in a recipe and
      // `reset` is what a reset-only one tears down with.
      for (const command of [services?.down, services?.reset]) {
        if (!command) continue;
        await runBuild(copyRoot, command, recipe.env, DEFAULT_BUILD_TIMEOUT_MS).catch(() => undefined);
      }
    }
    await fs.promises.rm(copyRoot, { recursive: true, force: true });
  }
}
