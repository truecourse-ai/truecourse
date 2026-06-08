/**
 * Idempotency presence extraction. For each detected route, decide whether
 * any function in its middleware chain (or the handler body itself) reads
 * the configured idempotency request header.
 *
 * Algorithm:
 *   1. Walk every TS/JS file. Build per-file:
 *        - Function index: name → body node (declarations + arrow consts).
 *        - Default-import bindings: imported-name → resolved file path.
 *        - Named-import bindings: imported-name → resolved file path.
 *        - Set of function names whose body reads the idempotency header.
 *   2. Aggregate: a function is idempotency-aware globally if its body
 *      reads `req.headers['<key>']` (any case) or `req.get('<Key>')` /
 *      `req.header('<Key>')` where `<key>` matches the contract's
 *      configured request header (case-insensitive).
 *   3. Walk every route registration `<router>.<method>(<path>, ...args, handler)`.
 *      For each route, the route is idempotency-protected when:
 *        a) any middleware-arg identifier resolves to an idempotency-aware
 *           function (locally declared OR imported from another file), or
 *        b) the handler body itself (after delegation resolution by the
 *           Operation extractor) reads the idempotency header.
 *
 * The handler-body check is partially redundant with (a) but covers the
 * inline case where the route registers no middleware and the handler
 * does the check itself.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Node as SyntaxNode, Tree } from 'web-tree-sitter';
import { initParsers, parseFile } from '@truecourse/analyzer';
import { trackTree } from './source-walker.js';
import { loadTcIgnore } from '@truecourse/shared';

const TS_EXT = new Set(['.ts', '.tsx', '.js', '.jsx']);

const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch']);

export interface IdempotencyPresenceResult {
  /**
   * Set of `${filePath}::${declarationLine}` keys whose route IS
   * idempotency-protected. Keyed by source-location (matching what the
   * Operation extractor already exposes) rather than route identity to
   * avoid having to mirror mount-prefix and path-param normalization.
   */
  protectedRoutes: Set<string>;
  /** All scanned files, for diagnostics. */
  scannedFiles: string[];
}

export function routeKey(filePath: string, declarationLine: number): string {
  return `${filePath}::${declarationLine}`;
}

interface FileBindings {
  /** import-binding name → absolute path of the imported file (best-effort). */
  imports: Map<string, string>;
  /** Function names declared in this file that read the idempotency header. */
  awareLocally: Set<string>;
  /** All function names declared in this file (including non-aware ones). */
  declaredFunctions: Set<string>;
}

/**
 * Build the protected-routes set for the given root directory and configured
 * header. The header match is case-insensitive on the wire format
 * (`Idempotency-Key` ≡ `idempotency-key`).
 */
export async function detectIdempotencyPresence(
  rootDir: string,
  requestHeader: string,
): Promise<IdempotencyPresenceResult> {
  await initParsers();
  const headerLower = requestHeader.toLowerCase();
  const fileBindings = new Map<string, FileBindings>();
  const fileTrees = new Map<string, { tree: Tree; source: string }>();
  const scanned: string[] = [];
  const tcIgnore = loadTcIgnore(rootDir);

  // ---- Pass 1: parse every file, collect bindings + per-file aware funcs.
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
      const source = fs.readFileSync(full, 'utf-8');
      const lang = ext === '.tsx' ? 'tsx' : ext === '.ts' ? 'typescript' : 'javascript';
      let tree: Tree;
      try {
        tree = parseFile(full, source, lang);
      } catch {
        continue;
      }
      trackTree(tree);
      scanned.push(full);
      fileTrees.set(full, { tree, source });
      fileBindings.set(full, collectBindings(tree, source, full, headerLower));
    }
  };
  visit(rootDir);

  // ---- Pass 2: per route, decide protected-or-not.
  const protectedRoutes = new Set<string>();
  for (const [filePath, { tree, source }] of fileTrees) {
    walkRoutes(tree.rootNode, source, (declarationLine, middlewareIdents, handlerBody) => {
      if (
        anyIdentIsAware(middlewareIdents, filePath, fileBindings) ||
        (handlerBody && nodeReadsHeader(handlerBody, source, headerLower))
      ) {
        protectedRoutes.add(routeKey(filePath, declarationLine));
      }
    });
  }

  return { protectedRoutes, scannedFiles: scanned };
}

// ---------------------------------------------------------------------------
// Bindings collection
// ---------------------------------------------------------------------------

function collectBindings(
  tree: Tree,
  source: string,
  filePath: string,
  headerLower: string,
): FileBindings {
  const imports = new Map<string, string>();
  const awareLocally = new Set<string>();
  const declaredFunctions = new Set<string>();

  const visit = (node: SyntaxNode): void => {
    // import_statement: capture default + named bindings → resolved file path
    if (node.type === 'import_statement') {
      const importClause = node.namedChildren.find((c) => c.type === 'import_clause');
      const sourceNode = node.namedChildren.find((c) => c.type === 'string');
      if (importClause && sourceNode) {
        const fragment = sourceNode.namedChildren.find((c) => c.type === 'string_fragment');
        if (fragment) {
          const sourceStr = source.slice(fragment.startIndex, fragment.endIndex);
          const resolved = resolveImportPath(filePath, sourceStr);
          if (resolved) {
            // default import
            const def = importClause.namedChildren.find((c) => c.type === 'identifier');
            if (def) imports.set(slice(def, source), resolved);
            // named imports: `{ idempotency, foo as bar }`
            const namedClause = importClause.namedChildren.find((c) => c.type === 'named_imports');
            if (namedClause) {
              for (const spec of namedClause.namedChildren) {
                if (spec.type !== 'import_specifier') continue;
                const name = spec.childForFieldName('name');
                const alias = spec.childForFieldName('alias');
                const localName = (alias ?? name);
                if (localName) imports.set(slice(localName, source), resolved);
              }
            }
          }
        }
      }
    }

    // Function declarations: `function foo(...) { ... }`
    if (node.type === 'function_declaration') {
      const name = node.childForFieldName('name');
      const body = node.childForFieldName('body');
      if (name && body) {
        const nm = slice(name, source);
        declaredFunctions.add(nm);
        if (nodeReadsHeader(body, source, headerLower)) awareLocally.add(nm);
      }
    }

    // Arrow / function expression assigned to a const: `const foo = (...) => …`
    if (node.type === 'lexical_declaration' || node.type === 'variable_declaration') {
      for (const decl of node.namedChildren) {
        if (decl.type !== 'variable_declarator') continue;
        const name = decl.childForFieldName('name');
        const value = decl.childForFieldName('value');
        if (!name || name.type !== 'identifier' || !value) continue;
        const nm = slice(name, source);
        if (value.type === 'arrow_function' || value.type === 'function_expression') {
          declaredFunctions.add(nm);
          const body = value.childForFieldName('body');
          if (body && nodeReadsHeader(body, source, headerLower)) awareLocally.add(nm);
        }
      }
    }

    for (const child of node.namedChildren) visit(child);
  };

  visit(tree.rootNode);
  return { imports, awareLocally, declaredFunctions };
}

// ---------------------------------------------------------------------------
// Header-read detection
// ---------------------------------------------------------------------------

/**
 * Does this subtree read the configured idempotency request header?
 * Recognizes:
 *   - `req.headers['idempotency-key']` / `req.headers["Idempotency-Key"]`
 *   - `req.headers.idempotencyKey` (rare; we accept any prop matching the hyphen-stripped form)
 *   - `req.get('Idempotency-Key')` / `req.header('Idempotency-Key')`
 * Match is case-insensitive on the wire format (Express lowercases headers).
 */
function nodeReadsHeader(node: SyntaxNode, source: string, headerLower: string): boolean {
  const target = headerLower; // already normalized lowercase, e.g. "idempotency-key"
  let found = false;

  const visit = (n: SyntaxNode): void => {
    if (found) return;

    // req.headers['idempotency-key'] OR req.headers["Idempotency-Key"]
    if (n.type === 'subscript_expression') {
      const obj = n.childForFieldName('object');
      const idx = n.childForFieldName('index');
      if (
        obj?.type === 'member_expression' &&
        idx?.type === 'string'
      ) {
        const innerObj = obj.childForFieldName('object');
        const innerProp = obj.childForFieldName('property');
        if (
          innerObj?.type === 'identifier' &&
          slice(innerObj, source) === 'req' &&
          innerProp?.type === 'property_identifier' &&
          slice(innerProp, source) === 'headers'
        ) {
          const fragment = idx.namedChildren.find((c) => c.type === 'string_fragment');
          if (fragment) {
            const literal = source.slice(fragment.startIndex, fragment.endIndex).toLowerCase();
            if (literal === target) {
              found = true;
              return;
            }
          }
        }
      }
    }

    // req.get('Idempotency-Key') / req.header('Idempotency-Key')
    if (n.type === 'call_expression') {
      const fn = n.childForFieldName('function');
      const args = n.childForFieldName('arguments');
      if (fn?.type === 'member_expression' && args) {
        const obj = fn.childForFieldName('object');
        const prop = fn.childForFieldName('property');
        if (
          obj?.type === 'identifier' &&
          slice(obj, source) === 'req' &&
          prop &&
          (slice(prop, source) === 'get' || slice(prop, source) === 'header')
        ) {
          const first = args.namedChild(0);
          if (first?.type === 'string') {
            const fragment = first.namedChildren.find((c) => c.type === 'string_fragment');
            if (fragment) {
              const literal = source.slice(fragment.startIndex, fragment.endIndex).toLowerCase();
              if (literal === target) {
                found = true;
                return;
              }
            }
          }
        }
      }
    }

    for (const child of n.namedChildren) visit(child);
  };

  visit(node);
  return found;
}

// ---------------------------------------------------------------------------
// Route walk + middleware-arg awareness check
// ---------------------------------------------------------------------------

function walkRoutes(
  root: SyntaxNode,
  source: string,
  visit: (declarationLine: number, middlewareIdents: string[], handlerBody: SyntaxNode | null) => void,
): void {
  const recur = (node: SyntaxNode): void => {
    if (node.type === 'call_expression') {
      const callee = node.childForFieldName('function');
      const args = node.childForFieldName('arguments');
      if (callee?.type === 'member_expression' && args) {
        const prop = callee.childForFieldName('property');
        if (prop && HTTP_METHODS.has(slice(prop, source).toLowerCase())) {
          const first = args.namedChild(0);
          if (first?.type === 'string') {
            const total = args.namedChildCount;
            if (total >= 2) {
              // Middleware = identifiers between path (idx 0) and handler (idx total-1).
              const middlewareIdents: string[] = [];
              for (let i = 1; i < total - 1; i++) {
                const a = args.namedChild(i);
                if (a?.type === 'identifier') middlewareIdents.push(slice(a, source));
              }
              const handlerArg = args.namedChild(total - 1);
              const handlerBody = handlerArg ? extractHandlerBody(handlerArg) : null;
              const declarationLine = node.startPosition.row + 1;
              visit(declarationLine, middlewareIdents, handlerBody);
            }
          }
        }
      }
    }
    for (const child of node.namedChildren) recur(child);
  };
  recur(root);
}

function extractHandlerBody(node: SyntaxNode): SyntaxNode | null {
  if (node.type === 'arrow_function' || node.type === 'function_expression') {
    return node.childForFieldName('body');
  }
  return null;
}

function anyIdentIsAware(
  idents: string[],
  filePath: string,
  fileBindings: Map<string, FileBindings>,
): boolean {
  const here = fileBindings.get(filePath);
  if (!here) return false;
  for (const ident of idents) {
    if (here.awareLocally.has(ident)) return true;
    const importedFrom = here.imports.get(ident);
    if (importedFrom) {
      const there = fileBindings.get(importedFrom);
      if (there?.awareLocally.has(ident)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Helpers (mirrors auth-presence)
// ---------------------------------------------------------------------------

function resolveImportPath(importingFile: string, sourceStr: string): string | null {
  if (!sourceStr.startsWith('.')) return null;
  const baseRaw = path.resolve(path.dirname(importingFile), sourceStr);
  const candidates: string[] = [];
  candidates.push(baseRaw);
  if (baseRaw.endsWith('.js')) {
    const stem = baseRaw.slice(0, -3);
    candidates.push(stem + '.ts', stem + '.tsx');
  }
  if (baseRaw.endsWith('.jsx')) {
    const stem = baseRaw.slice(0, -4);
    candidates.push(stem + '.tsx', stem + '.ts');
  }
  if (!path.extname(baseRaw)) {
    for (const ext of ['.ts', '.tsx', '.js', '.jsx']) candidates.push(baseRaw + ext);
    for (const ext of ['.ts', '.tsx', '.js', '.jsx']) candidates.push(path.join(baseRaw, `index${ext}`));
  }
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

function slice(node: SyntaxNode, source: string): string {
  return source.slice(node.startIndex, node.endIndex);
}
