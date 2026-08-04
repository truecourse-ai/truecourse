/**
 * The node-side factory for a {@link RefResolutionContext} — the ONE place a guard
 * caller (guard-runner's doc-index / section-plan / run and spec-consolidator's
 * discovery) turns a repo root into a resolver context. It lives in its own
 * subpath (`@truecourse/shared/openapi-node`) so the sibling `./openapi` module
 * stays browser-safe: THIS file imports `node:fs`, that one never does.
 *
 * The escape boundary is enforced twice, deliberately: the shared resolver's
 * LEXICAL check (a `../…` that normalizes outside `repoRoot`) plus this wrapper's
 * REALPATH check (an in-repo symlink whose target escapes the tree). `fs.readFileSync`
 * follows symlinks, so without the realpath re-check a committed in-repo symlink
 * pointing at, say, `~/.truecourse/config.json` would pass the lexical check and get
 * inlined into `canonicalText` (and thence author prompts / scenario YAML). Both the
 * repo root and each target are realpath'd (the root itself may sit behind a symlink,
 * e.g. macOS `/tmp` → `/private/tmp`). A per-file `statSync` size gate refuses a
 * single over-cap file BEFORE reading it, so a repo-content-driven huge read can't
 * materialize; the AUTHORITATIVE cumulative accounting stays in the shared resolver.
 */

import fs from 'node:fs';
import path from 'node:path';
import { OPENAPI_MAX_BYTES, type RefResolutionContext } from './index.js';

export function nodeRefContext(repoRoot: string, docOrAbs: string): RefResolutionContext {
  const repoRootAbs = path.resolve(repoRoot);
  // Resolve the repo root through symlinks once; every target's realpath is checked
  // against it so a symlink can't smuggle outside content past the lexical guard.
  let realRoot: string;
  try {
    realRoot = fs.realpathSync(repoRootAbs);
  } catch {
    realRoot = repoRootAbs;
  }
  const withinRealRoot = (real: string): boolean =>
    real === realRoot || real.startsWith(realRoot + path.sep);

  return {
    specPath: path.isAbsolute(docOrAbs) ? docOrAbs : path.resolve(repoRootAbs, docOrAbs),
    repoRoot: repoRootAbs,
    readFile: (abs: string): string | null => {
      try {
        const real = fs.realpathSync(abs); // follows symlinks
        if (!withinRealRoot(real)) return null; // symlink escape → degrade to literal $ref
        if (fs.statSync(real).size > OPENAPI_MAX_BYTES) return null; // cheap pre-cap guard
        return fs.readFileSync(real, 'utf-8');
      } catch {
        return null;
      }
    },
  };
}
