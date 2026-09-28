/**
 * The MCP tools' layering, pinned.
 *
 * A dashboard route and an MCP tool must run the same business logic, so a
 * tool is an adapter and nothing more: it parses its arguments, calls a shared
 * function, and shapes the answer. What makes that hold is what a tool can
 * reach. A file in `apps/dashboard/server/src/mcp/` may import:
 *
 *   - its own `mcp/` siblings;
 *   - the server's services (`../services/*.service.js`), which the routes call too;
 *   - `@truecourse/shared`, the MCP SDK and zod;
 *   - the core READ surface: `@truecourse/core/commands/guard-read`, and from
 *     it only reads (`read*`, `list*`) and types — its writes go through a
 *     service, where the side effects live.
 *
 * Nothing else: no `../routes/*`, no auth or middleware (the HTTP half is
 * `routes/mcp.ts`), no data-store, no other core module, no ee.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MCP_DIR = 'apps/dashboard/server/src/mcp';

/** The core modules that are the tools' read surface. */
const CORE_READ_SURFACE = ['@truecourse/core/commands/guard-read'];

/** What a named import from the read surface may be called. */
const READ_NAME = /^(read|list)[A-Z]/;

interface Import {
  specifier: string;
  /** Named value imports (type-only ones excluded). */
  values: string[];
  /** A default, namespace or side-effect import, or a require/dynamic import. */
  whole: boolean;
}

function importsOf(file: string, src: string): Import[] {
  const source = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const found: Import[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const values =
        clause && !clause.isTypeOnly && bindings && ts.isNamedImports(bindings)
          ? bindings.elements.filter((e) => !e.isTypeOnly).map((e) => (e.propertyName ?? e.name).text)
          : [];
      const whole =
        !clause || (!clause.isTypeOnly && (!!clause.name || (!!bindings && ts.isNamespaceImport(bindings))));
      found.push({ specifier: node.moduleSpecifier.text, values, whole });
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      found.push({ specifier: node.moduleSpecifier.text, values: [], whole: !node.isTypeOnly && !node.exportClause });
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      found.push({ specifier: node.arguments[0].text, values: [], whole: true });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** Why this import is not allowed in an MCP file, or null when it is. */
function mcpImportViolation(imp: Import): string | null {
  const s = imp.specifier;
  if (s.startsWith('./') && !s.includes('/..')) return null;
  if (/^\.\.\/services\/[a-z0-9-]+\.service\.js$/.test(s)) return null;
  if (s === '@truecourse/shared' || s === 'zod') return null;
  if (s.startsWith('@modelcontextprotocol/sdk/')) return null;
  if (CORE_READ_SURFACE.includes(s)) {
    if (imp.whole) return `${s}: import only named reads, never the whole module`;
    const writes = imp.values.filter((name) => !READ_NAME.test(name));
    return writes.length > 0 ? `${s}: ${writes.join(', ')} is not a read; call its service` : null;
  }
  return `${s}: not the tools' layer (a service, shared, the MCP SDK, zod or ${CORE_READ_SURFACE.join(', ')})`;
}

function mcpFiles(): string[] {
  const dir = path.join(repoRoot, MCP_DIR);
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.(ts|tsx|js|mjs)$/.test(e.name))
    .map((e) => path.join(e.parentPath, e.name));
}

describe('the MCP tools are adapters over the shared logic', () => {
  it('no MCP file imports past the services, shared, the SDK, zod and the core read surface', () => {
    const offenders: string[] = [];
    for (const file of mcpFiles()) {
      const rel = path.relative(repoRoot, file).split(path.sep).join('/');
      for (const imp of importsOf(rel, fs.readFileSync(file, 'utf8'))) {
        const why = mcpImportViolation(imp);
        if (why) offenders.push(`${rel}: ${why}`);
      }
    }
    expect(
      offenders,
      `MCP files reaching past their layer (move the logic into a service the route calls too):\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it.each([
    "import { createApp } from '../routes/repos.js';",
    "import type { RepoLinkStore } from '../routes/repos.js';",
    "import { actorContext } from '../middleware/actor.js';",
    "import { PgRepositoryStore } from '@truecourse/data-store';",
    "import { log } from '@truecourse/core/lib/logger';",
    "import { eeServerFeatures } from '@truecourse/ee-server';",
    "import { dismissGuardFlow } from '@truecourse/core/commands/guard-read';",
    "import * as guard from '@truecourse/core/commands/guard-read';",
    "import { buildDocSectionIndex } from '@truecourse/guard-runner';",
    "const m = await import('../routes/guard.js');",
  ])('refuses: %s', (src) => {
    const violations = importsOf('x.ts', src).map(mcpImportViolation).filter(Boolean);
    expect(violations.length).toBeGreaterThan(0);
  });

  it.each([
    "import { run } from './caller.js';",
    "import { listSources } from '../services/context-sources.service.js';",
    "import { readGuardHistory, type GuardFlowsView } from '@truecourse/core/commands/guard-read';",
    "import { z } from 'zod';",
    "import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';",
  ])('permits: %s', (src) => {
    expect(importsOf('x.ts', src).map(mcpImportViolation).filter(Boolean)).toEqual([]);
  });

  it('actually scans the tools (guard is wired)', () => {
    expect(mcpFiles().length).toBeGreaterThanOrEqual(3);
  });
});
