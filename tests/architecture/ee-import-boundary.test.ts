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

// Vendor SDKs whose blast radius the boundary keeps contained.
//
// The AI SDK (`ai` / `@ai-sdk/*`) has exactly ONE sanctioned home in OSS:
// `packages/llm-api`, the direct-API LLM transport both editions install. No
// other OSS source may import it — everything else reaches the model through
// the `LlmTransport` seam in `@truecourse/shared/llm`.
//
// The cloud blob SDKs (`@aws-sdk/*` / `@azure/*`, used by `ee/packages/storage`)
// stay enterprise-only: OSS uses the filesystem.
const AI_SDK_HOME = 'packages/llm-api';

const STATIC_AISDK_IMPORT =
  /(?:^|\n)\s*import\b[^\n]*\bfrom\s*['"](?:ai|@ai-sdk\/[^'"]+)['"]|(?:^|\n)\s*import\s*['"](?:ai|@ai-sdk\/[^'"]+)['"]|require\(\s*['"](?:ai|@ai-sdk\/[^'"]+)['"]/;

const STATIC_CLOUD_SDK_IMPORT =
  /(?:^|\n)\s*import\b[^\n]*\bfrom\s*['"](?:@aws-sdk\/[^'"]+|@azure\/[^'"]+)['"]|(?:^|\n)\s*import\s*['"](?:@aws-sdk\/[^'"]+|@azure\/[^'"]+)['"]|require\(\s*['"](?:@aws-sdk\/[^'"]+|@azure\/[^'"]+)['"]/;

// The Claude Agent SDK wrapper has exactly ONE sanctioned home in OSS:
// `packages/llm-claude-agent`, the claude-code session driver. Everything
// else runs sessions through the
// `SessionDriver` seam in `@truecourse/shared/llm`. Any mention of the
// package specifier counts — the sanctioned home itself loads it through a
// lazy, assembled-specifier import (it is an optional peer).
const CLAUDE_AGENT_SDK_HOME = 'packages/llm-claude-agent';

const CLAUDE_AGENT_SDK_REFERENCE = /@anthropic-ai\/claude-agent-sdk/;

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

  it('only packages/llm-api statically imports the AI SDK (ai / @ai-sdk/*)', () => {
    const files: string[] = [];
    for (const root of OSS_ROOTS) walk(path.join(repoRoot, root), files);

    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(repoRoot, file);
      if (rel.startsWith(`${AI_SDK_HOME}${path.sep}`)) continue;
      const src = fs.readFileSync(file, 'utf8');
      if (STATIC_AISDK_IMPORT.test(src)) offenders.push(rel);
    }

    expect(
      offenders,
      `OSS files importing the AI SDK outside ${AI_SDK_HOME} (reach the model through @truecourse/shared/llm instead):\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('the AI SDK home actually imports it (exemption is not dead)', () => {
    const files: string[] = [];
    walk(path.join(repoRoot, AI_SDK_HOME), files);
    const importers = files.filter((f) =>
      STATIC_AISDK_IMPORT.test(fs.readFileSync(f, 'utf8')),
    );
    expect(importers.length).toBeGreaterThan(0);
  });

  it('only packages/llm-claude-agent references the Claude Agent SDK', () => {
    const files: string[] = [];
    for (const root of OSS_ROOTS) walk(path.join(repoRoot, root), files);

    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(repoRoot, file);
      if (rel.startsWith(`${CLAUDE_AGENT_SDK_HOME}${path.sep}`)) continue;
      const src = fs.readFileSync(file, 'utf8');
      if (CLAUDE_AGENT_SDK_REFERENCE.test(src)) offenders.push(rel);
    }

    expect(
      offenders,
      `OSS files referencing the Claude Agent SDK outside ${CLAUDE_AGENT_SDK_HOME} (run sessions through the SessionDriver seam instead):\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('the Claude Agent SDK home actually declares it (exemption is not dead)', () => {
    // The home never writes the literal specifier in source (its lazy import
    // assembles it so the optional peer stays out of type resolution), so
    // liveness is asserted on the package manifest instead.
    const manifest = JSON.parse(
      fs.readFileSync(path.join(repoRoot, CLAUDE_AGENT_SDK_HOME, 'package.json'), 'utf8'),
    );
    expect(manifest.peerDependencies?.['@anthropic-ai/claude-agent-sdk']).toBeTruthy();
    expect(
      manifest.peerDependenciesMeta?.['@anthropic-ai/claude-agent-sdk']?.optional,
    ).toBe(true);
  });

  it('no OSS source statically imports a cloud blob SDK (@aws-sdk/* / @azure/*)', () => {
    const files: string[] = [];
    for (const root of OSS_ROOTS) walk(path.join(repoRoot, root), files);

    const offenders: string[] = [];
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      if (STATIC_CLOUD_SDK_IMPORT.test(src)) {
        offenders.push(path.relative(repoRoot, file));
      }
    }

    expect(
      offenders,
      `OSS files importing an enterprise-only cloud blob SDK (they live in ee/):\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('actually scans a non-trivial number of files (guard is wired)', () => {
    const files: string[] = [];
    for (const root of OSS_ROOTS) walk(path.join(repoRoot, root), files);
    expect(files.length).toBeGreaterThan(50);
  });
});
