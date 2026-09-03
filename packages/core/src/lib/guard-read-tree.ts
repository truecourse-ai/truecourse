/**
 * A SCRATCH WORKING TREE for the guard readers that were written against a
 * repository on disk — the dependencies view and its registration write, which
 * compose the catalog, the recipe, the overlays, the setup snapshot, the last
 * generate report, the committed scenarios and the flow corpus, and read every
 * one of them as a file.
 *
 * A hosted repository has all of that in the store and none of it on disk, so a
 * read materializes it into a temp dir first — the same move the hosted store
 * makes for the scenario loader, and the same move every job makes for its
 * clone — runs the unchanged reader over it, and throws the dir away. Nothing
 * here is collected back except what the caller collects itself (a registration
 * write collects the overlays the engine's writer left).
 *
 * What lands, in the order the readers look for it: the newest setup bundle
 * (the recipe, the catalog, `guard/setup.json`), the scenario set (manifest,
 * scenario files, the flow corpus), the last generate report, the repo's guard
 * decisions, and the stored overlays.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  guardDecisionsPath,
  manifestPath,
  writeGuardResult as writeTreeGuardResult,
} from '@truecourse/guard-runner';
import { assertSafeRel, safeJoin } from './safe-path.js';
import { materializeGuardSetupBundle } from '../services/guard-setup/bundle.js';
import {
  listScenarioFiles,
  loadGuardSetupBundle,
  readGuardDecisions,
  readGuardResult,
  readManifest,
  readScenarioFile,
} from './guard-store.js';
import { materializeGuardOverlays } from './guard-overlays.js';

/** Repo-relative posix path of an absolute path inside `root`. */
function relOf(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join('/');
}

/** The corpus files the scenario-file listing does not enumerate but the readers join. */
const CORPUS_FILES = ['flows.json', 'claims.json'];

function writeFile(file: string, body: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

/**
 * Materialize the repo's stored guard state into `treeDir`. `ref` pins a commit
 * for the bundle and the scenario set; without one the newest of each answers.
 */
export async function materializeGuardReadTree(
  repoKey: string,
  treeDir: string,
  ref?: string,
): Promise<void> {
  const bundle = await loadGuardSetupBundle(repoKey, ref);
  if (bundle) materializeGuardSetupBundle(treeDir, bundle);

  const manifest = await readManifest(repoKey, ref);
  if (manifest) writeFile(manifestPath(treeDir), JSON.stringify(manifest, null, 2) + '\n');
  const scenariosRel = relOf(treeDir, path.dirname(manifestPath(treeDir)));
  const files = [
    ...(await listScenarioFiles(repoKey, ref)),
    ...CORPUS_FILES.map((name) => `${scenariosRel}/${name}`),
  ];
  for (const rel of new Set(files)) {
    assertSafeRel(rel);
    const body = await readScenarioFile(repoKey, rel, ref);
    if (body != null) writeFile(safeJoin(treeDir, rel), body);
  }

  const report = await readGuardResult(repoKey, ref);
  if (report) writeTreeGuardResult(treeDir, report);

  const decisions = await readGuardDecisions(repoKey);
  if (decisions.dismissedClaims.length > 0 || decisions.dismissedFlows.length > 0) {
    writeFile(guardDecisionsPath(treeDir), JSON.stringify(decisions, null, 2) + '\n');
  }

  await materializeGuardOverlays(repoKey, treeDir);
}

/** Run `fn` over a scratch tree holding the repo's stored guard state, then remove it. */
export async function withGuardReadTree<T>(
  repoKey: string,
  ref: string | undefined,
  fn: (treeDir: string) => Promise<T> | T,
): Promise<T> {
  const treeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-read-'));
  try {
    await materializeGuardReadTree(repoKey, treeDir, ref);
    return await fn(treeDir);
  } finally {
    fs.rmSync(treeDir, { recursive: true, force: true });
  }
}
