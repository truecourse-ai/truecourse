/**
 * Enforces the open-core import boundary: OSS code must never
 * statically import an `@truecourse/ee-*` package. The only sanctioned
 * way for OSS to reach enterprise code is a runtime dynamic `import()`
 * inside a loader (gated on edition), which this guard deliberately
 * allows.
 *
 * This is a lightweight stand-in until a full ESLint config lands with
 * a `no-restricted-imports` rule; it runs in the normal node suite so
 * the boundary can't silently rot.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);

// OSS source roots that must not statically import ee.
const OSS_ROOTS = [
  'apps/dashboard/client/src',
  'apps/dashboard/server/src',
  'apps/landing/src',
  'packages',
  'tools',
];

const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', 'out', '.turbo']);
const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

function walk(dir: string, out: string[]) {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(path.join(dir, e.name), out);
    } else if (SOURCE_EXT.has(path.extname(e.name))) {
      out.push(path.join(dir, e.name));
    }
  }
}

// Static import / require of an @truecourse/ee-* package. A dynamic
// `import('@truecourse/ee-...')` does NOT match (no `from`, and the
// `import(` form is excluded), which is intentional.
const STATIC_EE_IMPORT =
  /(?:^|\n)\s*import\b[^\n]*\bfrom\s*['"]@truecourse\/ee-|(?:^|\n)\s*import\s*['"]@truecourse\/ee-|require\(\s*['"]@truecourse\/ee-/;

// Enterprise-only vendor SDKs: the AI SDK (`ee/packages/llm`) and the cloud blob
// SDKs (`ee/packages/storage` — Azure / AWS S3). OSS must never import any of
// them; OSS uses the CLI transport + the filesystem instead.
const STATIC_AISDK_IMPORT =
  /(?:^|\n)\s*import\b[^\n]*\bfrom\s*['"](?:ai|@ai-sdk\/[^'"]+|@aws-sdk\/[^'"]+|@azure\/[^'"]+)['"]|(?:^|\n)\s*import\s*['"](?:ai|@ai-sdk\/[^'"]+|@aws-sdk\/[^'"]+|@azure\/[^'"]+)['"]|require\(\s*['"](?:ai|@ai-sdk\/[^'"]+|@aws-sdk\/[^'"]+|@azure\/[^'"]+)['"]/;

describe('open-core import boundary', () => {
  it('no OSS source statically imports @truecourse/ee-*', () => {
    const files: string[] = [];
    for (const root of OSS_ROOTS) walk(path.join(repoRoot, root), files);

    const offenders: string[] = [];
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      if (STATIC_EE_IMPORT.test(src)) {
        offenders.push(path.relative(repoRoot, file));
      }
    }

    expect(
      offenders,
      `OSS files statically importing ee/ (use a gated dynamic import() instead):\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('no OSS source statically imports an enterprise vendor SDK (ai / @ai-sdk/* / @aws-sdk/* / @azure/*)', () => {
    const files: string[] = [];
    for (const root of OSS_ROOTS) walk(path.join(repoRoot, root), files);

    const offenders: string[] = [];
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      if (STATIC_AISDK_IMPORT.test(src)) {
        offenders.push(path.relative(repoRoot, file));
      }
    }

    expect(
      offenders,
      `OSS files importing an enterprise-only vendor SDK (AI SDK / cloud blob SDKs live in ee/):\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('actually scans a non-trivial number of files (guard is wired)', () => {
    const files: string[] = [];
    for (const root of OSS_ROOTS) walk(path.join(repoRoot, root), files);
    expect(files.length).toBeGreaterThan(50);
  });
});
