/**
 * The one place the open server looks for the enterprise bundle.
 *
 * There is ONE process entry and ONE build: the image ships both editions, and
 * which one a process is comes from whether `ee/packages/server` sits beside
 * this tree when it boots. Present, its feature list is registered into the
 * server's registry before anything mounts; absent, nothing is, and the open
 * edition is simply the one nobody registered into. Nothing about the image,
 * the Dockerfile or a release script has to pick an entry.
 *
 * The bundle is found relative to THIS file, in the same tree it runs from:
 * `dist/` when built, `src/` under `tsx` and the test runner. That keeps the
 * dependency one-way — the open server declares no dependency on the bundle,
 * which depends on it — and is the only open file allowed to name an `ee/`
 * path (`tests/architecture/ee-import-boundary.test.ts` pins that).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerServerFeature, type ServerFeature } from './features.js';

const here = fileURLToPath(import.meta.url);

/** `src` or `dist`: whichever tree this file runs from, the bundle runs from too. */
const tree = path.basename(path.dirname(here));

/** The bundle's entry beside a repository root, in this file's tree and extension. */
function editionEntry(repoRoot: string): string {
  return path.join(repoRoot, 'ee', 'packages', 'server', tree, `index${path.extname(here)}`);
}

function isServerFeature(value: unknown): value is ServerFeature {
  return (
    typeof value === 'object'
    && value !== null
    && typeof (value as ServerFeature).name === 'string'
    && typeof (value as ServerFeature).mount === 'function'
  );
}

/**
 * Register the enterprise bundle's server features when the checkout has one.
 * Resolves to the features registered: empty for the open edition. A bundle
 * that is present but does not export `eeServerFeatures` throws — a broken
 * bundle must stop the boot, not silently produce the open edition.
 */
export async function registerEditionFeatures(
  repoRoot: string = path.resolve(path.dirname(here), '..', '..', '..', '..'),
): Promise<readonly ServerFeature[]> {
  const entry = editionEntry(repoRoot);
  if (!fs.existsSync(entry)) return [];
  const bundle: unknown = await import(pathToFileURL(entry).href);
  const features = (bundle as { eeServerFeatures?: unknown }).eeServerFeatures;
  if (!Array.isArray(features) || !features.every(isServerFeature)) {
    throw new Error(`${entry} is not an edition bundle: it must export eeServerFeatures`);
  }
  for (const feature of features) registerServerFeature(feature);
  return features;
}
