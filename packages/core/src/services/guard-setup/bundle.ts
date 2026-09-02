/**
 * The guard setup BUNDLE — the files `truecourse guard setup` leaves in a repo
 * that must outlive the working tree it ran in.
 *
 * On a hosted run the working tree is an ephemeral clone, so setup's per-step
 * settle spine (`guard/setup.json`), its findings ledger, the recipe, the
 * dependency catalog + its settle record, the seed script the recipe names and
 * the generated guard compose file would all be thrown away with the clone and
 * every step would re-run from scratch. Collect them after a run, materialize
 * them into the next clone before one, and setup behaves as it does locally.
 *
 * The interface catalog travels too — both halves plus its findings ledger —
 * because the Interfaces view has no working tree to read in DB mode and the
 * interfaces step's settle check needs the authored half to exist.
 *
 * Deliberately NOT members: the `.cache/` KV caches (their own store seam) and
 * the gitignored secrets overlays `dependencies.local.json` /
 * `externals.local.json`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { GuardSetupReportSchema, type GuardSetupReport } from '@truecourse/shared';
import {
  dependenciesPath,
  guardAuthoredInterfacesPath,
  guardInterfaceFindingsPath,
  guardInterfacesPath,
  guardSetupFindingsPath,
  guardSetupPath,
  recipePath,
  resolveSeedScript,
  scenariosDir,
} from '@truecourse/guard-runner';
import { assertSafeRel, safeJoin } from '../../lib/safe-path.js';

/** A stand-in root, for naming a member without a real tree to read it from. */
const BUNDLE_ROOT = path.resolve(path.sep, 'repo');

/** The datastore compose file guard generates at the repo root, when it exists. */
const GUARD_COMPOSE_FILE = 'docker-compose.guard.yml';

/** Repo-relative posix path of an absolute path inside `repoRoot`. */
function relOf(repoRoot: string, abs: string): string {
  return path.relative(repoRoot, abs).split(path.sep).join('/');
}

function readIfFile(file: string): string | null {
  try {
    return fs.statSync(file).isFile() ? fs.readFileSync(file, 'utf-8') : null;
  } catch {
    return null;
  }
}

/**
 * Read setup's durable outputs out of `repoRoot` as `{ repoRelativePath: content }`.
 * Missing members are skipped, so a partial or never-run setup yields a partial
 * (or empty) bundle.
 */
export function collectGuardSetupBundle(repoRoot: string): Record<string, string> {
  const members = [
    guardSetupPath(repoRoot),
    guardSetupFindingsPath(repoRoot),
    guardInterfacesPath(repoRoot),
    guardAuthoredInterfacesPath(repoRoot),
    guardInterfaceFindingsPath(repoRoot),
    recipePath(repoRoot),
    dependenciesPath(repoRoot),
    path.join(scenariosDir(repoRoot), 'dependencies.settle.json'),
    path.join(repoRoot, GUARD_COMPOSE_FILE),
  ];

  const files: Record<string, string> = {};
  for (const abs of members) {
    const body = readIfFile(abs);
    if (body !== null) files[relOf(repoRoot, abs)] = body;
  }

  // The seed script lives wherever the recipe points; `resolveSeedScript` returns
  // null when it is absent or escapes the repo.
  const rawRecipe = files[relOf(repoRoot, recipePath(repoRoot))];
  if (rawRecipe !== undefined) {
    const seed = resolveSeedScript(repoRoot, rawRecipe);
    const body = seed === null ? null : readIfFile(seed);
    if (seed !== null && body !== null) files[relOf(repoRoot, seed)] = body;
  }

  return files;
}

/** The bundle keys the interface catalog's two halves travel under — what a
 *  DB-mode reader looks them up by, since there is no tree to path into. */
export const GUARD_SETUP_INTERFACES_FILE = relOf(BUNDLE_ROOT, guardInterfacesPath(BUNDLE_ROOT));
export const GUARD_SETUP_AUTHORED_INTERFACES_FILE = relOf(
  BUNDLE_ROOT,
  guardAuthoredInterfacesPath(BUNDLE_ROOT),
);

/**
 * The setup report a stored bundle carries, parsed — null when the bundle has
 * none, or when what it has no longer matches the report shape. Lets a reader
 * answer "what did setup decide for this repo" without a work tree.
 */
export function readBundleGuardSetup(files: Record<string, string>): GuardSetupReport | null {
  const raw = files[relOf(BUNDLE_ROOT, guardSetupPath(BUNDLE_ROOT))];
  if (raw === undefined) return null;
  try {
    return GuardSetupReportSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Write a bundle into `repoRoot`, creating parent dirs. Every path is checked
 * for containment first, so a stored manifest can never write outside the tree —
 * the whole bundle is rejected before any file lands.
 */
export function materializeGuardSetupBundle(
  repoRoot: string,
  files: Record<string, string>,
): void {
  const targets = Object.entries(files).map(([rel, body]) => {
    assertSafeRel(rel);
    return [safeJoin(repoRoot, rel), body] as const;
  });
  for (const [dest, body] of targets) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, body);
  }
}
