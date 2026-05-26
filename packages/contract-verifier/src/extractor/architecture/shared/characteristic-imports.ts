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

import fs from 'node:fs';
import path from 'node:path';
import type { Node as SyntaxNode, Tree } from 'web-tree-sitter';
import { parseFile } from '@truecourse/analyzer';
import type { CodebaseScan, DetectionSignal, ImportRef } from '../types.js';

const TS_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.cache', '.truecourse']);

export function collectImports(rootDir: string): ImportRef[] {
  const out: ImportRef[] = [];
  const visit = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name);
      if (!TS_EXT.has(ext)) continue;
      const source = fs.readFileSync(full, 'utf-8');
      const lang = ext === '.tsx' ? 'tsx' : ext === '.ts' ? 'typescript' : 'javascript';
      let tree: Tree;
      try {
        tree = parseFile(full, source, lang);
      } catch {
        continue;
      }
      for (const m of findImportSpecifiers(tree, source)) {
        out.push({ module: m.module, source: { filePath: full, lineStart: m.line, lineEnd: m.line } });
      }
    }
  };
  visit(rootDir);
  return out;
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
