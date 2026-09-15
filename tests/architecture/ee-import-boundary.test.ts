/**
 * The open/enterprise line, pinned.
 *
 * The product is open except three things — the document Connections, the
 * repository providers beyond the open edition's (Azure DevOps today, listed as
 * coming soon), and more than one workspace — which live in `ee/` and REGISTER
 * into the open shell's registries. The dependency runs one way: `ee/` imports
 * the open tree, never the reverse. So open code may not name an `ee/` path or
 * an `@truecourse/ee-*` package at all, and there is no loader making it
 * conditional.
 *
 * The one seam that crosses is `@edition`, the module `main.tsx` imports before
 * rendering: the build points it at the enterprise bundle when the checkout has
 * one, and at the open edition's no-op when it does not. That alias is allowed
 * in exactly one file, which is asserted here.
 *
 * The other two rules are vendor SDK homes: model and provider APIs belong in
 * `packages/llm-api`, and the Claude Agent SDK in `packages/llm-claude-agent`.
 *
 * A lightweight stand-in until a full ESLint config lands with a
 * `no-restricted-imports` rule; it runs in the normal node suite so the
 * boundary can't silently rot.
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

// OSS source roots that must not reach into ee.
const OSS_ROOTS = [
  'apps/dashboard/client/src',
  'apps/dashboard/server/src',
  'apps/landing/src',
  'packages',
];

/** The enterprise bundle: the three features, and nothing else. */
const EE_PACKAGES = ['ee/packages/client', 'ee/packages/server'];

/** The one open file allowed to import the edition module. */
const EDITION_IMPORTER = 'apps/dashboard/client/src/main.tsx';

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

function ossFiles(): string[] {
  const files: string[] = [];
  for (const root of OSS_ROOTS) walk(path.join(repoRoot, root), files);
  return files;
}

/** Every module specifier a file imports, requires, re-exports or type-imports. */
function specifiersOf(file: string, src: string): string[] {
  const source = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier
      && ts.isStringLiteral(node.moduleSpecifier)
    ) {
      found.push(node.moduleSpecifier.text);
    } else if (ts.isExternalModuleReference(node) && ts.isStringLiteral(node.expression)) {
      found.push(node.expression.text);
    } else if (
      ts.isCallExpression(node)
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
      && node.arguments[0]
      && ts.isStringLiteral(node.arguments[0])
    ) {
      found.push(node.arguments[0].text);
    } else if (
      ts.isImportTypeNode(node)
      && ts.isLiteralTypeNode(node.argument)
      && ts.isStringLiteral(node.argument.literal)
    ) {
      found.push(node.argument.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** Does this specifier name enterprise code? */
function reachesEe(specifier: string): boolean {
  return (
    specifier.startsWith('@truecourse/ee-')
    || specifier === 'ee'
    || specifier.startsWith('ee/')
    || /(^|\/)\.\.\/ee\//.test(specifier)
    || specifier.includes('/ee/packages/')
  );
}

// Vendor SDKs whose blast radius the boundary keeps contained.
//
// Model and provider APIs belong in `packages/llm-api`. Dashboard activity
// streaming also uses the SDK's UI transport, with only the named imports
// below allowed. Model access still goes through `@truecourse/shared/llm`.
const AI_SDK_HOME = 'packages/llm-api';

const ACTIVITY_SDK_IMPORTS: Record<string, { values: string[]; types: string[] }> = {
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

describe('the open/enterprise line', () => {
  it('no open source names an ee/ path or an @truecourse/ee-* package', () => {
    const offenders: string[] = [];
    for (const file of ossFiles()) {
      const rel = path.relative(repoRoot, file).split(path.sep).join('/');
      const src = fs.readFileSync(file, 'utf8');
      for (const specifier of specifiersOf(rel, src)) {
        if (reachesEe(specifier)) offenders.push(`${rel}: ${specifier}`);
      }
    }

    expect(
      offenders,
      `Open files reaching into ee/ (register into the shell's registries instead):\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('the edition module is imported by exactly one open file', () => {
    const importers: string[] = [];
    for (const file of ossFiles()) {
      const rel = path.relative(repoRoot, file).split(path.sep).join('/');
      const src = fs.readFileSync(file, 'utf8');
      if (specifiersOf(rel, src).includes('@edition')) importers.push(rel);
    }
    expect(importers).toEqual([EDITION_IMPORTER]);
  });

  it('the open edition has an edition module of its own, so it builds with ee/ absent', () => {
    const stub = path.join(
      repoRoot,
      'apps/dashboard/client/src/preview/shell/open-edition.ts',
    );
    expect(fs.existsSync(stub)).toBe(true);
    expect(fs.readFileSync(stub, 'utf8')).toContain('export function registerEditionFeatures');
  });

  it('the enterprise bundle is the three features, and it registers rather than being imported', () => {
    const present = EE_PACKAGES.filter((pkg) => fs.existsSync(path.join(repoRoot, pkg)));
    expect(present).toEqual(EE_PACKAGES);

    const edition = fs.readFileSync(
      path.join(repoRoot, 'ee/packages/client/src/edition.tsx'),
      'utf8',
    );
    for (const register of [
      'registerSettingsTab',
      'registerRepositoryProvider',
      'registerWorkspaceSwitcher',
    ]) {
      expect(edition).toContain(register);
    }

    const server = fs.readFileSync(
      path.join(repoRoot, 'ee/packages/server/src/index.ts'),
      'utf8',
    );
    expect(server).toContain('registerServerFeature');
  });

  it('the enterprise bundle may import the open tree (the dependency runs one way)', () => {
    const files: string[] = [];
    for (const pkg of EE_PACKAGES) walk(path.join(repoRoot, pkg), files);
    const openImporters = files.filter((file) => {
      const rel = path.relative(repoRoot, file).split(path.sep).join('/');
      return specifiersOf(rel, fs.readFileSync(file, 'utf8')).some(
        (specifier) => specifier.startsWith('@/') || specifier === '@truecourse/dashboard-server',
      );
    });
    expect(openImporters.length).toBeGreaterThan(0);
  });
});

describe('vendor SDK homes', () => {
  it('keeps AI SDK model access in llm-api and permits only activity UI transport imports elsewhere', () => {
    const offenders: string[] = [];
    for (const file of ossFiles()) {
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
    "import { createUIMessageStreamResponse as respond } from 'ai';",
    "import {\n createUIMessageStreamResponse,\n} from 'ai';",
  ])('permits activity transport imports: %s', src => {
    expect(aiSdkImportViolations('apps/dashboard/server/src/routes/sessions.ts', src)).toEqual([]);
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
    expect(aiSdkImportViolations('apps/dashboard/server/src/routes/sessions.ts', src).length).toBeGreaterThan(0);
  });

  it('keeps UI transport imports scoped to their activity adapters', () => {
    const src = "import { DefaultChatTransport } from 'ai';";
    expect(aiSdkImportViolations('packages/core/src/commands/spec-in-process.ts', src)).toHaveLength(1);
    expect(aiSdkImportViolations('packages/shared/src/activity-stream.ts', src)).toHaveLength(1);
  });

  it('only packages/llm-claude-agent references the Claude Agent SDK', () => {
    const offenders: string[] = [];
    for (const file of ossFiles()) {
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

  it('no source imports a cloud blob SDK (@aws-sdk/* / @azure/*)', () => {
    const files = ossFiles();
    for (const pkg of EE_PACKAGES) walk(path.join(repoRoot, pkg), files);

    const offenders: string[] = [];
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      if (STATIC_CLOUD_SDK_IMPORT.test(src)) {
        offenders.push(path.relative(repoRoot, file));
      }
    }

    expect(
      offenders,
      `Files importing a cloud blob SDK (storage is Postgres and the run's own directory):\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('actually scans a non-trivial number of files (guard is wired)', () => {
    expect(ossFiles().length).toBeGreaterThan(50);
  });
});
