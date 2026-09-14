/**
 * The supplied-dependency OVERLAYS — the instances a user registers for a
 * repository's `supplied` dependencies (API keys, base URLs, tokens, headers).
 *
 * They live in ONE encrypted row per repository and are MATERIALIZED into a
 * run's working tree as the two files the engine reads,
 * `scenarios/dependencies.local.json` (the catalog's instances) and
 * `scenarios/externals.local.json` (the recipe-declared services' secrets).
 * They are never collected back: a secret enters only through the dashboard's
 * registration write, which stores the overlays a scratch tree was left with
 * after the engine's own writer ran over it.
 *
 * The seam exists because `@truecourse/core` cannot depend on
 * `@truecourse/data-store`; boot installs the encrypted-row store over it.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  dependenciesLocalPath,
  externalsLocalPath,
  loadDependenciesLocal,
  loadExternalsLocal,
  type ExternalsLocalFile,
} from '@truecourse/guard-runner';
import type { GuardDependenciesLocal } from '@truecourse/shared';
import { atomicWriteText } from './atomic-write.js';

/** Both overlays, exactly as the two files hold them. */
export interface GuardOverlays {
  dependencies: GuardDependenciesLocal;
  externals: ExternalsLocalFile;
}

export const EMPTY_GUARD_OVERLAYS: GuardOverlays = { dependencies: {}, externals: {} };

/** The stored overlays, one encrypted row per repository. */
export interface GuardOverlayStore {
  /** The stored overlays; `null` when nothing has ever been registered. */
  read(repoKey: string): Promise<GuardOverlays | null>;
  /** Replace the stored overlays. Empty overlays clear the store. */
  write(repoKey: string, overlays: GuardOverlays): Promise<void>;
}

/** True when both overlays are empty — nothing to store, nothing to materialize. */
export function guardOverlaysEmpty(overlays: GuardOverlays): boolean {
  return (
    Object.keys(overlays.dependencies).length === 0 && Object.keys(overlays.externals).length === 0
  );
}

/**
 * Read the two overlay files out of a working tree. A missing file reads as an
 * empty overlay; a file that exists and does not parse throws, exactly as the
 * runner's own loaders do — silently ignoring it would register nothing and
 * blame the program for the failures.
 */
export function readGuardOverlaysFromTree(treeDir: string): GuardOverlays {
  return {
    dependencies: loadDependenciesLocal(treeDir),
    externals: loadExternalsLocal(treeDir),
  };
}

/**
 * Write the two overlay files into a working tree in the engine's own format
 * (2-space, keys sorted, trailing newline). An empty overlay removes its file,
 * so a cleared registration leaves no stale document behind.
 */
export function writeGuardOverlaysToTree(treeDir: string, overlays: GuardOverlays): void {
  writeOverlayFile(dependenciesLocalPath(treeDir), overlays.dependencies);
  writeOverlayFile(externalsLocalPath(treeDir), overlays.externals);
}

function writeOverlayFile(file: string, overlay: Record<string, unknown>): void {
  if (Object.keys(overlay).length === 0) {
    if (fs.existsSync(file)) fs.rmSync(file);
    return;
  }
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(overlay).sort()) sorted[key] = overlay[key];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  atomicWriteText(file, JSON.stringify(sorted, null, 2) + '\n');
}

let active: GuardOverlayStore | null = null;

export function setGuardOverlayStore(store: GuardOverlayStore): void {
  active = store;
}

export function resetGuardOverlayStore(): void {
  active = null;
}

function store(): GuardOverlayStore {
  if (!active) throw new Error('No guard overlay store installed (boot did not run installDbStores).');
  return active;
}

export const readGuardOverlays = (repoKey: string): Promise<GuardOverlays | null> =>
  store().read(repoKey);

export const writeGuardOverlays = (repoKey: string, overlays: GuardOverlays): Promise<void> =>
  store().write(repoKey, overlays);

/**
 * Put a repository's stored overlays into a run's working tree, where the engine
 * reads them as the two files. A repo with nothing registered writes nothing,
 * and the result says whether anything was written.
 */
export async function materializeGuardOverlays(repoKey: string, treeDir: string): Promise<boolean> {
  const overlays = await store().read(repoKey);
  if (!overlays) return false;
  writeGuardOverlaysToTree(treeDir, overlays);
  return true;
}
