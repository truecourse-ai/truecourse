/**
 * Shared signal collector: characteristic module imports across every
 * TS/JS file under the code dir. Recognizes:
 *
 *   import X from 'mod'           import './x'
 *   import { a } from 'mod'       export { a } from 'mod'
 *   const x = require('mod')      await import('mod')
 *
 * Returns the module specifier of each. Used by detectors whose signals
 * include `from 'pg'`, `from '@trpc/server'`, etc.
 */

import type { Node as SyntaxNode, Tree } from 'web-tree-sitter';
import { eachParsedSource, jsMatchers, type LanguageMatchers, type ParsedSource } from '../../source-walker.js';
import type { CodebaseScan, DetectionSignal, ImportRef } from '../types.js';

const IMPORT_MATCHERS: LanguageMatchers<ImportRef> = {
  ...jsMatchers(jsImportRefs),
  python: pythonImportRefs,
};

export async function collectImports(rootDir: string): Promise<ImportRef[]> {
  const out: ImportRef[] = [];
  await eachParsedSource(rootDir, (s) => {
    const matcher = IMPORT_MATCHERS[s.lang];
    if (matcher) out.push(...matcher(s));
  });
  return out;
}

function jsImportRefs(s: ParsedSource): ImportRef[] {
  return findImportSpecifiers(s.tree, s.source).map((m) => ({
    module: m.module,
    source: { filePath: s.filePath, lineStart: m.line, lineEnd: m.line },
  }));
}

/**
 * Python imports: `import x`, `import x.y as z`, `from pkg import a, b`,
 * `from pkg.sub import c`. The "module" recorded is the top-level
 * package (`sqlalchemy`, `fastapi`) so dependency-style matching works.
 */
function pythonImportRefs(s: ParsedSource): ImportRef[] {
  const out: ImportRef[] = [];
  const push = (mod: string, node: SyntaxNode): void => {
    if (mod) out.push({ module: mod, source: { filePath: s.filePath, lineStart: node.startPosition.row + 1, lineEnd: node.startPosition.row + 1 } });
  };
  const walk = (node: SyntaxNode): void => {
    if (node.type === 'import_from_statement') {
      const moduleName = node.childForFieldName('module_name');
      if (moduleName) push(dottedHead(s.source.slice(moduleName.startIndex, moduleName.endIndex)), node);
    } else if (node.type === 'import_statement') {
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i);
        if (!c) continue;
        if (c.type === 'dotted_name') push(dottedHead(s.source.slice(c.startIndex, c.endIndex)), node);
        else if (c.type === 'aliased_import') {
          const name = c.childForFieldName('name');
          if (name) push(dottedHead(s.source.slice(name.startIndex, name.endIndex)), node);
        }
      }
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i);
      if (c) walk(c);
    }
  };
  walk(s.tree.rootNode);
  return out;
}

/** `sqlalchemy.orm` → `sqlalchemy` (top-level distribution name). */
function dottedHead(dotted: string): string {
  return dotted.trim().split('.')[0] ?? '';
}

function findImportSpecifiers(tree: Tree, source: string): { module: string; line: number }[] {
  const out: { module: string; line: number }[] = [];
  const walk = (node: SyntaxNode): void => {
    // `import ... from 'mod'` / `export ... from 'mod'`
    if (node.type === 'import_statement' || node.type === 'export_statement') {
      const str = node.childForFieldName('source');
      if (str?.type === 'string') {
        out.push({ module: stripQuotes(source.slice(str.startIndex, str.endIndex)), line: str.startPosition.row + 1 });
      }
    }
    // `require('mod')` / `import('mod')`
    if (node.type === 'call_expression') {
      const fn = node.childForFieldName('function');
      const isRequire = fn?.type === 'identifier' && source.slice(fn.startIndex, fn.endIndex) === 'require';
      const isDynImport = fn?.type === 'import';
      if (isRequire || isDynImport) {
        const args = node.childForFieldName('arguments');
        const arg = args?.namedChild(0);
        if (arg?.type === 'string') {
          out.push({ module: stripQuotes(source.slice(arg.startIndex, arg.endIndex)), line: arg.startPosition.row + 1 });
        }
      }
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i);
      if (c) walk(c);
    }
  };
  walk(tree.rootNode);
  return out;
}

function stripQuotes(s: string): string {
  return s.replace(/^['"`]|['"`]$/g, '');
}

/**
 * Imports whose module specifier matches one of `modules` — exact match
 * OR a subpath of a scoped/namespaced package (`@trpc/server` matches a
 * `@trpc/server/adapters` import).
 */
export function importsMatching(scan: CodebaseScan, modules: readonly string[]): DetectionSignal[] {
  const out: DetectionSignal[] = [];
  for (const imp of scan.imports) {
    for (const m of modules) {
      if (imp.module === m || imp.module.startsWith(`${m}/`)) {
        out.push({ kind: 'import', source: imp.source, detail: `import from '${imp.module}'` });
        break;
      }
    }
  }
  return out;
}
