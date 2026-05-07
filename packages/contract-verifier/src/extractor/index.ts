/**
 * Code-side extractors. Each artifact kind has its own extractor that
 * reads source files and produces typed contracts in the same shape the
 * spec-side lifter produces.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Node as SyntaxNode, Tree } from 'web-tree-sitter';
import { initParsers, parseFile } from '@truecourse/analyzer';
import { extractOperationsFromFile, type ExtractedOperation } from './operation.js';
export { detectAuthPresence } from './auth-presence.js';
export type { AuthPresenceResult } from './auth-presence.js';
export { detectIdempotencyPresence } from './idempotency-presence.js';
export type { IdempotencyPresenceResult } from './idempotency-presence.js';

export type { ExtractedOperation } from './operation.js';

const TS_EXT = new Set(['.ts', '.tsx', '.js', '.jsx']);

/**
 * Walk a directory recursively, parse each TS/JS file, and run the
 * Operation extractor over it. Returns a flat list of extracted
 * operations across all files.
 *
 * Caller must `await initParsers()` once before use, OR rely on this
 * helper which awaits it implicitly (cached after first call).
 */
export async function extractOperationsFromDir(rootDir: string): Promise<ExtractedOperation[]> {
  await initParsers();
  const out: ExtractedOperation[] = [];
  const mountPrefixes: string[] = [];

  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name);
      if (!TS_EXT.has(ext)) continue;
      const source = fs.readFileSync(full, 'utf-8');
      const lang =
        ext === '.ts' || ext === '.tsx' ? (ext === '.tsx' ? 'tsx' : 'typescript') : 'javascript';
      try {
        const tree = parseFile(full, source, lang);
        out.push(...extractOperationsFromFile(full, source, tree));
        mountPrefixes.push(...collectMountPrefixes(tree, source));
      } catch {
        // Parse failures are silent — the verifier flags them via a
        // separate diagnostic channel later. Don't crash the whole
        // extraction pass on one bad file.
      }
    }
  };
  visit(rootDir);

  return applyMountPrefixes(out, [...new Set(mountPrefixes)]);
}

// ---------------------------------------------------------------------------
// Mount-prefix detection
// ---------------------------------------------------------------------------
//
// Express routers can be nested via `<router>.use('/prefix', subRouter)`.
// The route's full URL is the concatenation of all prefixes from the
// outermost mount down to the route registration. For v1, the heuristic
// is simpler: collect every `*.use('/prefix', ...)` call where the first
// argument is a string literal. If we find any non-trivial prefixes,
// prepend each to every extracted route, producing one operation per
// route × per prefix. The verifier matches on identity, so spec entries
// like `POST /api/orders` resolve to the prefixed code-side variant.
//
// Limits: doesn't follow import/export chains; multi-prefix nesting
// (e.g. `/api/v2/...`) only works if both prefixes are detected as
// independent `.use(...)` calls.
//
// Phase-5 polish: real mount-graph resolution via cross-file import
// tracking + variable scoping.
// ---------------------------------------------------------------------------

function collectMountPrefixes(tree: Tree, source: string): string[] {
  const prefixes: string[] = [];
  const visit = (node: SyntaxNode): void => {
    if (node.type === 'call_expression') {
      const fn = node.childForFieldName('function');
      if (fn?.type === 'member_expression') {
        const prop = fn.childForFieldName('property');
        if (prop && source.slice(prop.startIndex, prop.endIndex) === 'use') {
          const args = node.childForFieldName('arguments');
          const first = args?.namedChild(0);
          if (first?.type === 'string') {
            const fragment = first.namedChildren.find((c) => c.type === 'string_fragment');
            if (fragment) {
              const text = source.slice(fragment.startIndex, fragment.endIndex);
              if (text.startsWith('/') && text.length > 1) prefixes.push(text);
            }
          }
        }
      }
    }
    for (const child of node.namedChildren) visit(child);
  };
  visit(tree.rootNode);
  return prefixes;
}

function applyMountPrefixes(
  ops: ExtractedOperation[],
  prefixes: string[],
): ExtractedOperation[] {
  if (prefixes.length === 0) return ops;
  const out: ExtractedOperation[] = [...ops];
  for (const op of ops) {
    for (const prefix of prefixes) {
      // Avoid double-prefixing if the path already starts with this prefix.
      if (op.contract.path.startsWith(prefix)) continue;
      const newPath = `${prefix}${op.contract.path}`;
      out.push({
        ...op,
        identity: `${op.contract.method} ${newPath}`,
        contract: { ...op.contract, path: newPath },
        // observed is shared across variants — it reflects the same
        // handler body either way.
      });
    }
  }
  return out;
}
