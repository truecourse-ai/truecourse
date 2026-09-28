/**
 * The server's services sit BELOW its routes, pinned.
 *
 * A route and an MCP tool are both adapters over the services, so a service
 * never reaches up into `routes/`: what a route file holds is HTTP (parse a
 * request, shape a response), and logic a service needs belongs in a service.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVICES_DIR = 'apps/dashboard/server/src/services';

/** Every module specifier a file imports, re-exports, requires or dynamically imports. */
function specifiersOf(file: string, src: string): string[] {
  const source = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      found.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      found.push(node.arguments[0].text);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      found.push(node.argument.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** Does this specifier, from a file in `services/`, reach the server's routes? */
function reachesRoutes(specifier: string): boolean {
  return /^\.\.\/routes(\/|$)/.test(specifier) || /(^|\/)server\/src\/routes\//.test(specifier);
}

function serviceFiles(): string[] {
  const dir = path.join(repoRoot, SERVICES_DIR);
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.(ts|tsx|js|mjs)$/.test(e.name))
    .map((e) => path.join(e.parentPath, e.name));
}

describe('services sit below routes', () => {
  it('no service imports from routes/', () => {
    const offenders: string[] = [];
    for (const file of serviceFiles()) {
      const rel = path.relative(repoRoot, file).split(path.sep).join('/');
      for (const specifier of specifiersOf(rel, fs.readFileSync(file, 'utf8'))) {
        if (reachesRoutes(specifier)) offenders.push(`${rel}: ${specifier}`);
      }
    }
    expect(
      offenders,
      `Services importing from routes/ (move the logic into a service):\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it.each([
    "import { hostedDependenciesView } from '../routes/guard-dependencies-hosted.js';",
    "import type { RepoLinkStore } from '../routes/repos.js';",
    "export { x } from '../routes/context.js';",
    "const m = await import('../routes/guard.js');",
  ])('refuses: %s', (src) => {
    expect(specifiersOf('x.ts', src).some(reachesRoutes)).toBe(true);
  });

  it('permits a sibling service', () => {
    expect(specifiersOf('x.ts', "import { run } from './refusals.service.js';").some(reachesRoutes)).toBe(false);
  });

  it('actually scans the services (guard is wired)', () => {
    expect(serviceFiles().length).toBeGreaterThan(10);
  });
});
