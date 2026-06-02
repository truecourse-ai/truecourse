/**
 * Mount-graph resolver for Express-style route trees.
 *
 * Express composes route trees via `<parent>.use('/prefix', <child>)`,
 * where parent and child are router/app identifiers that may live in
 * different files. To produce the URLs an HTTP client would actually
 * hit, we have to follow the chain from each route's router up to its
 * mount points, concatenating prefixes along the way.
 *
 * Pipeline:
 *
 *   1. Per file, scan the AST for:
 *        - Router/app declarations (`const X = Router()`, `const X = express()`)
 *        - Route registrations (`X.<method>(...)`)
 *        - Mount calls (`<parent>.use('/prefix', <child>)`)
 *        - Imports + exports of those identifiers
 *   2. Resolve every cross-file identifier to its declaration site,
 *      producing a stable global router id `(file, localName)`.
 *   3. For each route, walk the mount graph upward from its router to
 *      every reachable root. Each leaf-to-root path produces one full
 *      URL via path concatenation. Routes on routers that nothing
 *      mounts fall back to their declared (relative) path.
 *
 * The output is a list of `ExtractedOperation` rewritten with the
 * full URLs — one variant per resolved mount path. Routes whose router
 * we couldn't tie to the graph (computed receivers, unknown imports)
 * pass through unchanged.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Node as SyntaxNode, Tree } from 'web-tree-sitter';
import type { ExtractedOperation } from './operation.js';

// ---------------------------------------------------------------------------
// Per-file analysis
// ---------------------------------------------------------------------------

export interface RouterDeclaration {
  /** Local identifier in the declaring file. */
  localName: string;
}

export interface MountEdgeRaw {
  parentLocal: string;
  childLocal: string;
  prefix: string;
}

export interface ImportRecord {
  /** Local alias used inside the importing file. */
  localName: string;
  /** Absolute path of the source module (resolved on disk). */
  sourceFile: string;
  /** Imported export name; `'default'` for `import X from '…'`. */
  importedName: string;
}

export interface ExportRecord {
  /** Public name (`'default'` for default export). */
  exportName: string;
  /** Local declaration this export refers to. */
  localName: string;
}

export interface FileAnalysis {
  filePath: string;
  declarations: RouterDeclaration[];
  mounts: MountEdgeRaw[];
  imports: ImportRecord[];
  exports: ExportRecord[];
}

const ROUTER_FACTORIES = new Set(['Router', 'express']);

export function analyzeRouterFile(filePath: string, source: string, tree: Tree): FileAnalysis {
  const declarations: RouterDeclaration[] = [];
  const mounts: MountEdgeRaw[] = [];
  const imports: ImportRecord[] = [];
  const exports: ExportRecord[] = [];

  const visit = (node: SyntaxNode): void => {
    collectDeclarations(node, source, declarations);
    collectMounts(node, source, mounts);
    collectImports(node, source, filePath, imports);
    collectExports(node, source, exports);
    for (const child of node.namedChildren) visit(child);
  };
  visit(tree.rootNode);

  return { filePath, declarations, mounts, imports, exports };
}

function sliceText(node: SyntaxNode, source: string): string {
  return source.slice(node.startIndex, node.endIndex);
}

/**
 * Match `const X = Router()`, `const X = express.Router()`, or
 * `const X = express()` — anything that produces a router-shaped
 * value. We don't try to verify the import is actually `express`;
 * the factory name is enough signal in practice.
 */
function collectDeclarations(
  node: SyntaxNode,
  source: string,
  out: RouterDeclaration[],
): void {
  if (node.type !== 'variable_declarator') return;
  const name = node.childForFieldName('name');
  const value = node.childForFieldName('value');
  if (!name || !value) return;
  if (name.type !== 'identifier') return;
  if (!isRouterFactoryCall(value, source)) return;
  out.push({ localName: sliceText(name, source) });
}

function isRouterFactoryCall(node: SyntaxNode, source: string): boolean {
  if (node.type !== 'call_expression') return false;
  const fn = node.childForFieldName('function');
  if (!fn) return false;
  if (fn.type === 'identifier') {
    return ROUTER_FACTORIES.has(sliceText(fn, source));
  }
  if (fn.type === 'member_expression') {
    const prop = fn.childForFieldName('property');
    if (!prop) return false;
    return ROUTER_FACTORIES.has(sliceText(prop, source));
  }
  return false;
}

/**
 * Match `<parent>.use(...)` calls. The first arg may be a string
 * literal (the mount prefix) or omitted (mount at the parent's root).
 * Subsequent identifier args are candidate children — Express accepts
 * a list of middleware + sub-routers under the same prefix:
 *
 *   app.use('/api', requireAuth, ordersRouter)
 *
 * Any number of identifier args (after the optional string prefix) are
 * emitted as candidate edges; the graph builder filters out the ones
 * that don't resolve to a real router declaration, so middleware
 * functions silently drop out.
 *
 * Computed receivers (`getApp().use(...)`), array literals, and
 * spread args are skipped.
 */
function collectMounts(node: SyntaxNode, source: string, out: MountEdgeRaw[]): void {
  if (node.type !== 'call_expression') return;
  const fn = node.childForFieldName('function');
  if (fn?.type !== 'member_expression') return;
  const prop = fn.childForFieldName('property');
  if (!prop || sliceText(prop, source) !== 'use') return;
  const parent = fn.childForFieldName('object');
  if (parent?.type !== 'identifier') return;

  const args = node.childForFieldName('arguments');
  if (!args || args.namedChildCount === 0) return;

  // Prefix is the first arg when it's a string literal; otherwise the
  // mount is at the parent's root (empty prefix).
  let argIdx = 0;
  let prefix = '';
  const first = args.namedChild(0);
  if (first?.type === 'string') {
    const s = readStringLiteralText(first, source);
    if (s === null || !s.startsWith('/')) return;
    prefix = s;
    argIdx = 1;
  }

  const parentName = sliceText(parent, source);
  for (let i = argIdx; i < args.namedChildCount; i++) {
    const arg = args.namedChild(i);
    if (arg?.type !== 'identifier') continue;
    out.push({
      parentLocal: parentName,
      childLocal: sliceText(arg, source),
      prefix,
    });
  }
}

function readStringLiteralText(node: SyntaxNode, source: string): string | null {
  if (node.type !== 'string') return null;
  const fragment = node.namedChildren.find((c) => c.type === 'string_fragment');
  if (!fragment) return null;
  return source.slice(fragment.startIndex, fragment.endIndex);
}

/**
 * Walk an `import_statement` node and record every imported name,
 * resolving the source specifier to an absolute on-disk path. Bare
 * imports (third-party packages) are dropped — they can't introduce
 * routers we'd see in the graph.
 */
function collectImports(
  node: SyntaxNode,
  source: string,
  filePath: string,
  out: ImportRecord[],
): void {
  if (node.type !== 'import_statement') return;
  const sourceNode = node.childForFieldName('source');
  if (!sourceNode) return;
  const spec = readStringLiteralText(sourceNode, source);
  if (spec === null) return;
  const resolved = resolveImportPath(filePath, spec);
  if (!resolved) return;

  const importClause = node.namedChildren.find((c) => c.type === 'import_clause');
  if (!importClause) return;

  for (const child of importClause.namedChildren) {
    if (child.type === 'identifier') {
      // `import X from '…'` — default import.
      out.push({
        localName: sliceText(child, source),
        sourceFile: resolved,
        importedName: 'default',
      });
    } else if (child.type === 'named_imports') {
      for (const spec of child.namedChildren) {
        if (spec.type !== 'import_specifier') continue;
        const name = spec.childForFieldName('name');
        const alias = spec.childForFieldName('alias');
        if (!name) continue;
        const importedName = sliceText(name, source);
        const localName = alias ? sliceText(alias, source) : importedName;
        out.push({ localName, sourceFile: resolved, importedName });
      }
    } else if (child.type === 'namespace_import') {
      // `import * as X from '…'` — we don't track namespace alias use yet.
    }
  }
}

function resolveImportPath(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const baseDir = path.dirname(fromFile);
  const noExt = spec.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '');
  const candidates = [
    noExt + '.ts',
    noExt + '.tsx',
    noExt + '.js',
    noExt + '.jsx',
    path.join(noExt, 'index.ts'),
    path.join(noExt, 'index.tsx'),
    path.join(noExt, 'index.js'),
    path.join(noExt, 'index.jsx'),
  ];
  for (const c of candidates) {
    const abs = path.resolve(baseDir, c);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
  }
  return null;
}

/**
 * Match the export forms that bring router identifiers into the
 * cross-file namespace:
 *   - `export const X = …`           → exportName = X
 *   - `export default X`             → exportName = 'default'
 *   - `export default <expr>`        → declaration is anonymous; skipped
 *   - `export { X, Y }`              → one record per name
 *   - `export { X as Y }`            → exportName = Y, localName = X
 */
function collectExports(node: SyntaxNode, source: string, out: ExportRecord[]): void {
  if (node.type !== 'export_statement') return;

  // `export default …`
  const value = node.childForFieldName('value');
  if (value) {
    if (value.type === 'identifier') {
      out.push({ exportName: 'default', localName: sliceText(value, source) });
    }
    return;
  }

  // `export const X = …`
  const decl = node.childForFieldName('declaration');
  if (decl) {
    if (decl.type === 'lexical_declaration' || decl.type === 'variable_declaration') {
      for (const v of decl.namedChildren) {
        if (v.type !== 'variable_declarator') continue;
        const name = v.childForFieldName('name');
        if (name?.type === 'identifier') {
          const local = sliceText(name, source);
          out.push({ exportName: local, localName: local });
        }
      }
    } else if (decl.type === 'function_declaration') {
      const name = decl.childForFieldName('name');
      if (name?.type === 'identifier') {
        const local = sliceText(name, source);
        out.push({ exportName: local, localName: local });
      }
    }
    return;
  }

  // `export { X, Y as Z }`
  const clause = node.namedChildren.find((c) => c.type === 'export_clause');
  if (clause) {
    for (const spec of clause.namedChildren) {
      if (spec.type !== 'export_specifier') continue;
      const name = spec.childForFieldName('name');
      const alias = spec.childForFieldName('alias');
      if (!name) continue;
      const localName = sliceText(name, source);
      const exportName = alias ? sliceText(alias, source) : localName;
      out.push({ exportName, localName });
    }
  }
}

// ---------------------------------------------------------------------------
// Cross-file graph
// ---------------------------------------------------------------------------

/** A canonical router id: the file + local name where the router is declared. */
export interface RouterId {
  file: string;
  localName: string;
}

function rid(file: string, localName: string): string {
  return `${file}::${localName}`;
}

export interface MountGraph {
  /** Edges keyed by child router id → list of (parent id, prefix). */
  parentsOf: Map<string, Array<{ parent: string; prefix: string }>>;
  /** Set of router ids we've seen declared anywhere. */
  knownRouters: Set<string>;
}

export function buildMountGraph(files: FileAnalysis[]): MountGraph {
  // Index files by absolute path so we can chase imports.
  const byFile = new Map<string, FileAnalysis>();
  for (const f of files) byFile.set(f.filePath, f);

  const knownRouters = new Set<string>();
  for (const f of files) {
    for (const d of f.declarations) knownRouters.add(rid(f.filePath, d.localName));
  }

  /**
   * Resolve a `(file, localName)` reference to its canonical declaration
   * site. Walks the import → export trail; bails out on cycles, unknown
   * symbols, or external (bare) modules.
   */
  function resolveLocal(
    file: string,
    localName: string,
    seen: Set<string> = new Set(),
  ): RouterId | null {
    const key = rid(file, localName);
    if (seen.has(key)) return null;
    seen.add(key);

    const f = byFile.get(file);
    if (!f) return null;

    if (f.declarations.some((d) => d.localName === localName)) {
      return { file, localName };
    }

    const imp = f.imports.find((i) => i.localName === localName);
    if (!imp) return null;

    const target = byFile.get(imp.sourceFile);
    if (!target) return null;
    const exp = target.exports.find((e) => e.exportName === imp.importedName);
    if (!exp) return null;
    return resolveLocal(imp.sourceFile, exp.localName, seen);
  }

  const parentsOf = new Map<string, Array<{ parent: string; prefix: string }>>();
  for (const f of files) {
    for (const m of f.mounts) {
      // The parent must be declared somewhere we can reach (otherwise
      // we can't compose anything sensible). The child must be
      // resolvable to a real declaration too.
      const parent = resolveLocal(f.filePath, m.parentLocal);
      const child = resolveLocal(f.filePath, m.childLocal);
      if (!parent || !child) continue;
      const childKey = rid(child.file, child.localName);
      const list = parentsOf.get(childKey) ?? [];
      list.push({ parent: rid(parent.file, parent.localName), prefix: m.prefix });
      parentsOf.set(childKey, list);
    }
  }

  return { parentsOf, knownRouters };
}

// ---------------------------------------------------------------------------
// URL resolution
// ---------------------------------------------------------------------------

/**
 * For each route, walk the mount graph upward from its router to every
 * reachable "root" (a router with no parents in the graph). Each leaf-
 * to-root path yields one full URL — emit one ExtractedOperation per
 * such URL.
 *
 * Routes whose router we can't pin to the graph (computed receiver,
 * external import) pass through unchanged with their relative path.
 */
export function rewriteOperationsWithMounts(
  ops: ExtractedOperation[],
  files: FileAnalysis[],
  graph: MountGraph,
): ExtractedOperation[] {
  const byFile = new Map<string, FileAnalysis>();
  for (const f of files) byFile.set(f.filePath, f);

  const out: ExtractedOperation[] = [];
  for (const op of ops) {
    const fullPaths = resolveFullPaths(op, byFile, graph);
    if (fullPaths.length === 0) {
      // No resolvable mount → leave the route's declared path alone.
      out.push(op);
      continue;
    }
    const seen = new Set<string>();
    for (const fullPath of fullPaths) {
      if (seen.has(fullPath)) continue;
      seen.add(fullPath);
      out.push({
        ...op,
        identity: `${op.contract.method} ${fullPath}`,
        contract: { ...op.contract, path: fullPath },
      });
    }
  }
  return out;
}

function resolveFullPaths(
  op: ExtractedOperation,
  byFile: Map<string, FileAnalysis>,
  graph: MountGraph,
): string[] {
  if (!op.routerName) return [];

  // Resolve op.routerName in op.filePath to a canonical declaration.
  const file = byFile.get(op.filePath);
  if (!file) return [];

  const decl = file.declarations.find((d) => d.localName === op.routerName);
  let declId: string;
  if (decl) {
    declId = rid(op.filePath, op.routerName);
  } else {
    // The router was imported into the route-declaring file. Resolve.
    const imp = file.imports.find((i) => i.localName === op.routerName);
    if (!imp) return [];
    const target = byFile.get(imp.sourceFile);
    if (!target) return [];
    const exp = target.exports.find((e) => e.exportName === imp.importedName);
    if (!exp) return [];
    declId = rid(imp.sourceFile, exp.localName);
  }

  // Walk upward, collecting every leaf-to-root path's prefix chain.
  const results: string[] = [];
  const walk = (node: string, suffix: string, seen: Set<string>): void => {
    if (seen.has(node)) return;
    const next = new Set(seen);
    next.add(node);
    const parents = graph.parentsOf.get(node);
    if (!parents || parents.length === 0) {
      // Root reached. Emit if the chain produced any prefix, or if
      // this node IS the route's own router (no mount at all).
      if (suffix) results.push(suffix);
      return;
    }
    for (const { parent, prefix } of parents) {
      const composed = joinPath(prefix, suffix || op.contract.path);
      walk(parent, composed, next);
    }
  };
  walk(declId, '', new Set());

  return results;
}

/**
 * Compose a parent prefix with a child suffix into a single URL,
 * collapsing redundant slashes. `/health` + `/` → `/health`;
 * `/api/v1` + `/articles` → `/api/v1/articles`.
 */
function joinPath(prefix: string, suffix: string): string {
  if (!prefix || prefix === '/') return suffix || '/';
  if (!suffix || suffix === '/') return prefix;
  const a = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  const b = suffix.startsWith('/') ? suffix : '/' + suffix;
  return a + b;
}
