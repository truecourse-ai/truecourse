/**
 * File-based route extraction. Frameworks like Astro, Next.js (Pages and
 * App routers), Remix and SvelteKit don't declare routes with imperative
 * `router.get(...)` calls — instead, the file's location on disk *is*
 * the URL, and named exports (`GET`, `POST`, etc.) define the methods.
 *
 * This extractor walks well-known route directories, derives the URL
 * from each file's path, looks for HTTP-method-named exports inside,
 * and emits one `ExtractedOperation` per (file, method) pair. The
 * downstream comparator pipeline doesn't change — these operations
 * slot into the same drift-detection path the Express extractor feeds.
 *
 * Conventions covered:
 *
 *   Next.js Pages Router   pages/api/users/[id].ts        → /api/users/{id}
 *   Next.js App Router     app/api/users/[id]/route.ts    → /api/users/{id}
 *   Astro Pages            src/pages/articles/[slug].ts   → /articles/{slug}
 *   SvelteKit              src/routes/api/x/+server.ts    → /api/x
 *
 * What we DON'T cover:
 *
 *   - Default-export handlers that switch on `req.method` (older
 *     Next.js Pages style). Without an explicit per-method export,
 *     attribution is ambiguous; we'd emit one Operation per HTTP
 *     method even when only some are implemented. False positives we
 *     don't want.
 *   - Catch-all segments (`[...slug]`). Treated as `{slug}` for now —
 *     the wildcard matcher would need richer semantics in the
 *     comparator. The drift surface is "endpoint missing" either way,
 *     just less precise on the path.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Node as SyntaxNode, Tree } from 'web-tree-sitter';
import { initParsers, parseFile } from '@truecourse/analyzer';
import { trackTree } from './source-walker.js';
import { loadTcIgnore } from '@truecourse/shared';
import type { OperationContract } from '../types/index.js';
import { extractResponsesFromBody, collectHandlerObservationsFromBody } from './operation.js';
import type { ExtractedOperation } from './operation.js';

const TS_EXT = new Set(['.ts', '.tsx', '.js', '.jsx']);
const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'options', 'head']);

interface RouteRoot {
  /** Directory to scan, relative to codeDir. */
  dir: string;
  /** How to derive the URL from a file's path under `dir`. */
  shape: 'next-pages' | 'next-app' | 'astro-pages' | 'sveltekit';
}

const ROUTE_ROOTS: RouteRoot[] = [
  { dir: 'pages/api', shape: 'next-pages' },
  { dir: 'src/pages/api', shape: 'next-pages' },
  { dir: 'app/api', shape: 'next-app' },
  { dir: 'src/app/api', shape: 'next-app' },
  // Astro: `src/pages/**` is broad; we still scan because that's where
  // Astro endpoints live. Pages also serves UI components written in
  // .astro files (which we skip anyway since our lexer is TS/JS-only).
  { dir: 'src/pages', shape: 'astro-pages' },
  { dir: 'src/routes', shape: 'sveltekit' },
];

export async function extractFileBasedRoutesFromDir(rootDir: string): Promise<ExtractedOperation[]> {
  await initParsers();
  const out: ExtractedOperation[] = [];
  for (const root of ROUTE_ROOTS) {
    // Find every occurrence of the route-root directory anywhere in the
    // tree, not just at rootDir. Real monorepos place these under
    // `frontend/`, `apps/<name>/`, `packages/<name>/` etc.
    for (const matched of findDirs(rootDir, root.dir)) {
      walkRoot(matched, root, out);
    }
  }
  return out;
}

/**
 * Walk the tree rooted at `rootDir` looking for directories whose path
 * (relative to some ancestor) matches `wantedRel`. Returns absolute paths.
 *
 * Stops descending into `node_modules`, `.git`, `dist`, `build`, `.next`
 * to keep the traversal fast on big repos.
 */
function findDirs(rootDir: string, wantedRel: string): string[] {
  const results: string[] = [];
  const wantedSegments = wantedRel.split('/');
  const tcIgnore = loadTcIgnore(rootDir);

  const visit = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (
        entry.name === 'node_modules' ||
        entry.name === '.git' ||
        entry.name === 'dist' ||
        entry.name === 'build' ||
        entry.name === '.next' ||
        entry.name === '.turbo'
      ) continue;
      if (!entry.isDirectory()) continue;
      const full = path.join(dir, entry.name);
      if (tcIgnore.ignores(full)) continue;
      // Match: does the trail ending at `full` match the wanted path?
      const match = path.join(...wantedSegments);
      if (full.endsWith(path.sep + match) || full === match) {
        results.push(full);
        // Don't descend into a matched root — its contents are leaf
        // files we'll walk separately. (Avoids re-matching nested
        // src/pages within an already-matched src/pages.)
        continue;
      }
      visit(full);
    }
  };
  visit(rootDir);
  return results;
}

// ---------------------------------------------------------------------------
// Walk a route root, treating each file as one URL.
// ---------------------------------------------------------------------------

function walkRoot(rootAbs: string, root: RouteRoot, out: ExtractedOperation[]): void {
  const tcIgnore = loadTcIgnore(rootAbs);
  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (tcIgnore.ignores(full)) continue;
      if (entry.isDirectory()) {
        visit(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name);
      if (!TS_EXT.has(ext)) continue;

      // Per-shape file gating: Next App and SvelteKit have specific
      // route-file conventions; Next Pages and Astro accept any file.
      if (root.shape === 'next-app' && entry.name !== 'route.ts' && entry.name !== 'route.js' && entry.name !== 'route.tsx' && entry.name !== 'route.jsx') {
        continue;
      }
      if (root.shape === 'sveltekit' && !/^\+server\.(t|j)sx?$/.test(entry.name)) {
        continue;
      }

      const relUnderRoot = path.relative(rootAbs, full);
      const url = deriveUrl(relUnderRoot, root);
      if (url === null) continue;

      const source = fs.readFileSync(full, 'utf-8');
      const lang = ext === '.tsx' ? 'tsx' : ext === '.ts' ? 'typescript' : 'javascript';
      let tree: Tree;
      try {
        tree = parseFile(full, source, lang);
      } catch {
        continue;
      }
      trackTree(tree);
      const exports = collectHttpMethodExports(tree.rootNode, source);
      for (const exp of exports) {
        const contract: OperationContract = {
          protocol: 'http',
          method: exp.method.toUpperCase(),
          path: url,
          tags: [],
          responses: extractResponsesFromBody(exp.body, source),
        };
        out.push({
          identity: `${exp.method.toUpperCase()} ${url}`,
          contract,
          filePath: full,
          declarationLine: exp.line,
          observed: collectHandlerObservationsFromBody(exp.body, source),
          handlerBody: exp.body,
          handlerSource: source,
        });
      }
    }
  };
  visit(rootAbs);
}

// ---------------------------------------------------------------------------
// URL derivation per shape
// ---------------------------------------------------------------------------

function deriveUrl(relPath: string, root: RouteRoot): string | null {
  // Strip extension.
  const noExt = relPath.replace(/\.(t|j)sx?$/, '');
  // Replace OS path separator with forward slash for URL.
  const segments = noExt.split(path.sep);

  switch (root.shape) {
    case 'next-pages':
      // pages/api/users.ts        → /api/users
      // pages/api/users/index.ts  → /api/users
      // pages/api/users/[id].ts   → /api/users/{id}
      return '/' + 'api/' + segmentsToUrl(segments, { stripIndex: true });
    case 'next-app':
      // app/api/users/route.ts          → /api/users
      // app/api/users/[id]/route.ts     → /api/users/{id}
      // The trailing 'route' segment is the convention marker; strip it.
      if (segments[segments.length - 1] !== 'route') return null;
      return '/' + 'api/' + segmentsToUrl(segments.slice(0, -1), { stripIndex: false });
    case 'astro-pages':
      // src/pages/articles.ts        → /articles
      // src/pages/articles/index.ts  → /articles
      // src/pages/articles/[slug].ts → /articles/{slug}
      return '/' + segmentsToUrl(segments, { stripIndex: true });
    case 'sveltekit':
      // src/routes/api/x/+server.ts → /api/x
      // The trailing '+server' is the convention marker.
      if (segments[segments.length - 1] !== '+server') return null;
      return '/' + segmentsToUrl(segments.slice(0, -1), { stripIndex: false });
  }
}

function segmentsToUrl(segments: string[], opts: { stripIndex: boolean }): string {
  const out: string[] = [];
  for (const seg of segments) {
    if (opts.stripIndex && seg === 'index') continue;
    // [id] → {id};  [...slug] → {slug} (catch-all collapses to a single
    // path-param; richer wildcard matching is a future extension)
    const dyn = /^\[\.\.\.(.+)\]$/.exec(seg);
    if (dyn) {
      out.push(`{${dyn[1]}}`);
      continue;
    }
    const single = /^\[(.+)\]$/.exec(seg);
    if (single) {
      out.push(`{${single[1]}}`);
      continue;
    }
    out.push(seg);
  }
  return out.join('/');
}

// ---------------------------------------------------------------------------
// Find named exports whose name is an HTTP method
// ---------------------------------------------------------------------------

interface MethodExport {
  method: string;          // lowercase
  body: SyntaxNode;        // the function/arrow body to walk
  line: number;            // 1-indexed declaration line
}

function collectHttpMethodExports(root: SyntaxNode, source: string): MethodExport[] {
  const out: MethodExport[] = [];
  const visit = (node: SyntaxNode): void => {
    // export function GET(...) { … }
    // export async function GET(...) { … }
    if (node.type === 'export_statement') {
      for (const child of node.namedChildren) {
        if (child.type === 'function_declaration') {
          const name = child.childForFieldName('name');
          if (name) {
            const id = source.slice(name.startIndex, name.endIndex).toLowerCase();
            if (HTTP_METHODS.has(id)) {
              const body = child.childForFieldName('body');
              if (body) out.push({ method: id, body, line: child.startPosition.row + 1 });
            }
          }
        }
        // export const GET = (...) => { … }
        // export const GET = async (...) => { … }
        if (child.type === 'lexical_declaration' || child.type === 'variable_declaration') {
          for (const decl of child.namedChildren) {
            if (decl.type !== 'variable_declarator') continue;
            const name = decl.childForFieldName('name');
            const value = decl.childForFieldName('value');
            if (!name || name.type !== 'identifier' || !value) continue;
            const id = source.slice(name.startIndex, name.endIndex).toLowerCase();
            if (!HTTP_METHODS.has(id)) continue;
            if (value.type === 'arrow_function' || value.type === 'function_expression') {
              const body = value.childForFieldName('body');
              if (body) out.push({ method: id, body, line: decl.startPosition.row + 1 });
            }
          }
        }
      }
    }
    for (const child of node.namedChildren) visit(child);
  };
  visit(root);
  return out;
}
