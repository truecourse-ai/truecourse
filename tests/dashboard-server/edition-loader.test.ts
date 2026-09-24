/**
 * The one process entry finds the enterprise bundle beside its tree, or not.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import {
  clearServerFeatures,
  registeredServerFeatures,
} from '../../apps/dashboard/server/src/features';
import { registerEditionFeatures } from '../../apps/dashboard/server/src/edition-loader';

const tmpRoots: string[] = [];

afterEach(() => {
  clearServerFeatures();
  for (const root of tmpRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

/** A repository root holding only the bundle entry given, or nothing. */
function repoRootWith(entrySource: string | null): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-edition-'));
  tmpRoots.push(root);
  if (entrySource !== null) {
    const dir = path.join(root, 'ee', 'packages', 'server', 'src');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.ts'), entrySource);
  }
  return root;
}

describe('the edition loader', () => {
  it('registers this checkout\'s enterprise bundle, which is its two features', async () => {
    const features = await registerEditionFeatures();
    expect(features.map((f) => f.name)).toEqual(['multiple workspaces', 'document connections']);
    expect(registeredServerFeatures().some((f) => f.manyWorkspaces === true)).toBe(true);
  });

  it('registers nothing when the checkout has no bundle', async () => {
    expect(await registerEditionFeatures(repoRootWith(null))).toEqual([]);
    expect(registeredServerFeatures()).toEqual([]);
  });

  it('names the bundle it could not load', async () => {
    const root = repoRootWith("import './missing.js';\nexport const eeServerFeatures = [];\n");
    await expect(registerEditionFeatures(root)).rejects.toThrow(
      /could not load the enterprise bundle at .*ee\/packages\/server\/src\/index\.ts/,
    );
    expect(registeredServerFeatures()).toEqual([]);
  });

  it('refuses a bundle that is present but exports no feature list', async () => {
    const root = repoRootWith('export const somethingElse = 1;\n');
    await expect(registerEditionFeatures(root)).rejects.toThrow(/must export eeServerFeatures/);
    expect(registeredServerFeatures()).toEqual([]);
  });
});
