#!/usr/bin/env node
/**
 * Affected-only test runner.
 *
 * Runs only the vitest domain projects (see vitest.config.ts) whose declared
 * input set changed versus a base ref — so a guard-only change never re-runs the
 * analyzer/server/cli suites, locally or in CI. The decision is by matching the
 * *changed files* against each domain's traced input globs (source of every
 * workspace package the domain's tests execute, plus its test dirs and shared
 * setup), not by loose path guessing.
 *
 * Why not turbo cache: this repo's root package depends on the whole workspace,
 * so turbo folds a global `hashOfInternalDependencies` (a fingerprint of every
 * package's source) into every task hash. Editing any one package busts every
 * task's cache, so turbo's per-task `inputs` cannot isolate domains here. The
 * DOMAINS map below is the isolation boundary instead.
 *
 * Usage:
 *   node scripts/affected-tests.mjs [baseRef]      # default base: origin/main
 *   AFFECTED_BASE=<ref> node scripts/affected-tests.mjs
 *   node scripts/affected-tests.mjs --all          # force the full suite
 *
 * Exit code is vitest's (0 when nothing is affected — there is nothing to run).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Each domain's inputs: the test dirs it owns + the src of every workspace
// package its tests execute (traced transitively; guard-generator is included
// ONLY under `guard` because cli/server/github-app tests inject fake runners and
// import it type-only — they never execute its code). Over-include on doubt.
const SHARED_SETUP = ['vitest.config.ts', 'tests/setup.ts', 'tests/tsconfig.json', 'tests/helpers/**'];
const PARSER_SETUP = ['tests/setup-parsers.ts'];
const FIXTURES = ['tests/fixtures/**'];

const DOMAINS = {
  shared: [
    ...SHARED_SETUP,
    ...FIXTURES,
    'tests/shared/**',
    'tests/spec-consolidator/**',
    'tests/contract-extractor/**',
    'packages/shared/src/**',
    'packages/llm/src/**',
    'packages/spec-consolidator/src/**',
    'packages/contract-verifier/src/**',
    'packages/contract-extractor/src/**',
    'packages/analyzer/src/**',
  ],
  guard: [
    ...SHARED_SETUP,
    ...FIXTURES,
    'tests/guard-generator/**',
    'tests/guard-runner/**',
    'packages/guard-generator/src/**',
    'packages/guard-runner/src/**',
    'packages/shared/src/**',
    'packages/llm/src/**',
    'packages/core/src/**',
  ],
  analyzer: [
    ...SHARED_SETUP,
    ...PARSER_SETUP,
    ...FIXTURES,
    'tests/analyzer/**',
    'tests/contract-verifier/**',
    'packages/analyzer/src/**',
    'packages/shared/src/**',
    'packages/contract-verifier/src/**',
  ],
  cli: [
    ...SHARED_SETUP,
    ...PARSER_SETUP,
    ...FIXTURES,
    'tests/cli/**',
    'tools/cli/src/**',
    'tools/csharp-roslyn-host/**/*.cs',
    'tools/csharp-roslyn-host/**/*.csproj',
    'packages/core/src/**',
    'packages/analyzer/src/**',
    'packages/contract-extractor/src/**',
    'packages/contract-verifier/src/**',
    'packages/guard-runner/src/**',
    'packages/llm/src/**',
    'packages/shared/src/**',
    'packages/spec-consolidator/src/**',
  ],
  server: [
    ...SHARED_SETUP,
    ...PARSER_SETUP,
    ...FIXTURES,
    'tests/server/**',
    'tests/dashboard-server/**',
    'tests/core/**',
    'tests/github-app/**',
    'tests/ee-data-store/**',
    'tests/ee-llm/**',
    'tests/ee-server/**',
    'tests/ee-storage/**',
    'apps/dashboard/server/src/**',
    'packages/core/src/**',
    'packages/analyzer/src/**',
    'packages/contract-extractor/src/**',
    'packages/contract-verifier/src/**',
    'packages/guard-runner/src/**',
    'packages/llm/src/**',
    'packages/shared/src/**',
    'packages/spec-consolidator/src/**',
    'ee/packages/db/src/**',
    'ee/packages/storage/src/**',
    'ee/packages/llm/src/**',
    'ee/packages/data-store/src/**',
    'ee/packages/github-app/src/**',
    'ee/packages/server/src/**',
  ],
  // Whole-tree open-core import-boundary guard: it scans every OSS source file,
  // so any source change genuinely affects its result. Fast + parser-free.
  architecture: [
    ...SHARED_SETUP,
    'tests/architecture/**',
    'packages/*/src/**',
    'tools/*/src/**',
    'apps/dashboard/client/src/**',
    'apps/dashboard/server/src/**',
    'apps/landing/src/**',
  ],
  client: [
    'vitest.config.ts',
    'tests/setup.ts',
    'tests/dashboard-client/**',
    'apps/dashboard/client/src/**',
    'packages/shared/src/**',
    'ee/packages/client/src/**',
  ],
};

// A change to any of these invalidates the whole suite (they are not in a single
// domain's inputs but affect every run): dependency graph, workspace config, the
// selector itself.
const GLOBAL_TRIGGERS = [
  'pnpm-lock.yaml',
  'package.json',
  'pnpm-workspace.yaml',
  'tsconfig.json',
  'scripts/affected-tests.mjs',
];

const ALL = Object.keys(DOMAINS);

function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') {
          i++;
          re += '(?:[^/]+/)*'; // **/  → zero or more path segments
        } else {
          re += '.*'; // trailing ** → anything
        }
      } else {
        re += '[^/]*'; // *  → within one segment
      }
    } else if ('.+^${}()|[]\\'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp('^' + re + '$');
}

const COMPILED = Object.fromEntries(
  Object.entries(DOMAINS).map(([name, globs]) => [name, globs.map(globToRegExp)]),
);
const GLOBAL_RE = GLOBAL_TRIGGERS.map(globToRegExp);

/** Which domains a set of changed files affects. `null` files → the full suite. */
export function selectDomains(files, { forceAll = false } = {}) {
  if (forceAll || files === null) return { domains: ALL, reason: forceAll ? 'forced' : 'unknown-base' };
  if (files.length === 0) return { domains: [], reason: 'no-changes' };
  if (files.some((f) => GLOBAL_RE.some((re) => re.test(f)))) return { domains: ALL, reason: 'global-trigger' };
  return { domains: ALL.filter((d) => COMPILED[d].some((re) => files.some((f) => re.test(f)))), reason: 'affected' };
}

export { DOMAINS, globToRegExp };

function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function changedFiles(base) {
  // Diff the merge-base of `base` and HEAD against the working tree, so we see
  // exactly what this branch changed (committed + uncommitted), not unrelated
  // commits that landed on the base branch.
  const mergeBase = git(['merge-base', base, 'HEAD']) || base;
  const out = git(['diff', '--name-only', mergeBase]);
  if (out === null) return null;
  return out ? out.split('\n').filter(Boolean) : [];
}

function main() {
  const args = process.argv.slice(2);
  const forceAll = args.includes('--all');
  const baseArg = args.find((a) => !a.startsWith('--'));
  const base = baseArg || process.env.AFFECTED_BASE || 'origin/main';

  const files = forceAll ? null : changedFiles(base);
  const { domains: selected, reason } = selectDomains(files, { forceAll });
  const note = {
    forced: '--all: running the full suite.',
    'unknown-base': `base "${base}" not resolvable — running the full suite.`,
    'no-changes': `no changes vs ${base}.`,
    'global-trigger': 'a global/config file changed — running the full suite.',
    affected: `${files.length} changed file(s) vs ${base}.`,
  }[reason];
  console.log(`[affected-tests] ${note}`);

  if (selected.length === 0) {
    console.log('[affected-tests] no affected test domains — nothing to run.');
    return 0;
  }

  console.log(`[affected-tests] running domains: ${selected.join(', ')}`);
  // One vitest process across the selected projects: a shared worker pool sized
  // to the machine (no cross-process oversubscription).
  const projectArgs = selected.flatMap((d) => ['--project', d]);
  const res = spawnSync('pnpm', ['exec', 'vitest', 'run', ...projectArgs], { stdio: 'inherit' });
  return res.status ?? 1;
}

// Only run when invoked directly (`node scripts/affected-tests.mjs`), so the
// module can be imported for testing without launching vitest.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
