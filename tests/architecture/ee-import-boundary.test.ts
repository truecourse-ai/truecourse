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
import ts from 'typescript';

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
// Model and provider APIs belong in `packages/llm-api`. Dashboard activity
// streaming also uses the SDK's UI transport, with only the named imports
// below allowed. Model access still goes through `@truecourse/shared/llm`.
//
// The cloud blob SDKs (`@aws-sdk/*` / `@azure/*`, used by `ee/packages/storage`)
// stay enterprise-only: OSS uses the filesystem.
const AI_SDK_HOME = 'packages/llm-api';

const ACTIVITY_SDK_IMPORTS: Record<string, { values: string[]; types: string[] }> = {
  'apps/dashboard/client/src/lib/activity-stream.ts': {
    values: ['DefaultChatTransport'], types: ['UIMessageChunk'],
  },
  'apps/dashboard/server/src/routes/sessions.ts': {
    values: ['createUIMessageStreamResponse'], types: [],
  },
  'apps/dashboard/server/src/services/activity-stream.service.ts': {
    values: [], types: ['UIMessageChunk'],
  },
  'packages/shared/src/activity-stream.ts': {
    values: [], types: ['UIMessage'],
  },
};

function aiSdkImportViolations(file: string, src: string): string[] {
  // Most source files never reference the SDK. Parse only candidates, while
  // handling multiline imports and aliases without relying on their layout.
  if (!/['"](?:ai|@ai-sdk\/[^'"]+)['"]/.test(src)) return [];
  const source = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const allowed = ACTIVITY_SDK_IMPORTS[file];
  const violations: string[] = [];
  const isSdk = (node: ts.Node | undefined): node is ts.StringLiteral =>
    !!node && ts.isStringLiteral(node) && (node.text === 'ai' || node.text.startsWith('@ai-sdk/'));
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && isSdk(node.moduleSpecifier)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const permitted = node.moduleSpecifier.text === 'ai' && allowed && clause && !clause.name
        && bindings && ts.isNamedImports(bindings) && bindings.elements.length > 0
        && bindings.elements.every(element => {
          const name = (element.propertyName ?? element.name).text;
          return allowed.values.includes(name)
            || ((clause.isTypeOnly || element.isTypeOnly) && allowed.types.includes(name));
        });
      if (!permitted) violations.push(node.getText(source));
    } else if (
      (ts.isExportDeclaration(node) && isSdk(node.moduleSpecifier))
      || (ts.isExternalModuleReference(node) && isSdk(node.expression))
      || (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
        && node.expression.text === 'require' && isSdk(node.arguments[0]))
    ) {
      violations.push(node.getText(source));
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)
      && isSdk(node.argument.literal)) {
      if (node.argument.literal.text !== 'ai' || node.isTypeOf || !node.qualifier
        || !ts.isIdentifier(node.qualifier) || !allowed?.types.includes(node.qualifier.text)) {
        violations.push(node.getText(source));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
}

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

  it('keeps AI SDK model access in llm-api and permits only activity UI transport imports elsewhere', () => {
    const files: string[] = [];
    for (const root of OSS_ROOTS) walk(path.join(repoRoot, root), files);

    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(repoRoot, file);
      if (rel.startsWith(`${AI_SDK_HOME}${path.sep}`)) continue;
      const src = fs.readFileSync(file, 'utf8');
      for (const violation of aiSdkImportViolations(rel.split(path.sep).join('/'), src)) {
        offenders.push(`${rel}: ${violation}`);
      }
    }

    expect(
      offenders,
      `Disallowed AI SDK imports outside ${AI_SDK_HOME} (only activity UI transport imports are allowed; reach models through @truecourse/shared/llm):\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('the AI SDK home actually imports it (exemption is not dead)', () => {
    const files: string[] = [];
    walk(path.join(repoRoot, AI_SDK_HOME), files);
    const importers = files.filter((f) =>
      aiSdkImportViolations(path.relative(repoRoot, f), fs.readFileSync(f, 'utf8')).length > 0,
    );
    expect(importers.length).toBeGreaterThan(0);
  });

  it.each([
    "import { DefaultChatTransport as Transport } from 'ai';",
    "import {\n DefaultChatTransport, type UIMessageChunk,\n} from 'ai';",
    "import type { UIMessageChunk } from 'ai';",
    "type Chunk = import('ai').UIMessageChunk;",
  ])('permits activity transport imports: %s', src => {
    expect(aiSdkImportViolations('apps/dashboard/client/src/lib/activity-stream.ts', src)).toEqual([]);
  });

  it.each([
    "import { streamText } from 'ai';",
    "import {\n DefaultChatTransport,\n generateText as generate,\n} from 'ai';",
    "import type { LanguageModel } from 'ai';",
    "import { UIMessageChunk } from 'ai';",
    "import * as sdk from 'ai';",
    "import sdk from 'ai';",
    "import 'ai';",
    "import { openai } from '@ai-sdk/openai';",
    "export { streamText } from 'ai';",
    "export * from '@ai-sdk/openai';",
    "const sdk = require('ai');",
    "import sdk = require('ai');",
    "type Model = import('ai').LanguageModel;",
    "type SDK = typeof import('ai');",
  ])('rejects model APIs and unrestricted SDK access inside activity files: %s', src => {
    expect(aiSdkImportViolations('apps/dashboard/client/src/lib/activity-stream.ts', src).length).toBeGreaterThan(0);
  });

  it('keeps UI transport imports scoped to their activity adapters', () => {
    const src = "import { DefaultChatTransport } from 'ai';";
    expect(aiSdkImportViolations('packages/core/src/commands/spec-in-process.ts', src)).toHaveLength(1);
    expect(aiSdkImportViolations('packages/shared/src/activity-stream.ts', src)).toHaveLength(1);
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
