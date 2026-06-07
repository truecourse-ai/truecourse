/**
 * Auth presence extraction. For each detected route in the codebase,
 * determine whether the route's request flow goes through one of the
 * known auth middleware functions (e.g. `requireBearer`).
 *
 * Algorithm (single-file/cross-file, conservative):
 *
 *   1. Walk every file. Each `<router>.use(<X>, ...)` call is recorded
 *      as a "use edge" pinned to (file, routerVarName, args[]).
 *   2. Aggregate: for each unique routerVarName seen with `use(authFn)`
 *      somewhere, mark that router-var as auth-protected. For every
 *      `routerVar.use(otherIdentifier, ...)` call where `routerVar` is
 *      auth-protected, the `otherIdentifier` (typically an imported
 *      router default) propagates the auth-protected flag.
 *   3. Each route's containing file's local router var inherits the
 *      flag if its file's default export is among the propagated names.
 *
 * Limitations: assumes router export defaults match the imported name.
 * Works for the fixture without further wiring; deeper resolution is
 * Phase-5 polish.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Node as SyntaxNode, Tree } from 'web-tree-sitter';
import { initParsers, parseFile } from '@truecourse/analyzer';
import { trackTree } from './source-walker.js';
import { loadTcIgnore } from '@truecourse/shared';
import { eachParsedSource } from './source-walker.js';
import { fastApiFileHasAuthRouter } from './operation-fastapi.js';

const TS_EXT = new Set(['.ts', '.tsx', '.js', '.jsx']);

const AUTH_MIDDLEWARE_NAMES = new Set([
  'requireBearer',
  'requireAuth',
  'authenticate',
  'authMiddleware',
  'protect',
  'isAuthenticated',
  // 'requireRole' is role-specific (orthogonal to bearer); track separately.
]);

export interface AuthPresenceResult {
  /**
   * Set of file paths whose declared router IS auth-protected. Used by
   * the AuthRequirement comparator to decide drift on each operation.
   */
  protectedFiles: Set<string>;
  /** All files scanned. */
  scannedFiles: string[];
}

interface UseEdge {
  /** The `routerVar` identifier the `.use(...)` was invoked on. */
  routerVar: string;
  /** Identifier-typed args (skip strings, function calls, etc.). */
  args: string[];
  /** Path of the file the call lives in. */
  filePath: string;
}

interface FileImports {
  /** import-binding name → absolute path to the imported file (best-effort). */
  defaults: Map<string, string>;
}

export async function detectAuthPresence(rootDir: string): Promise<AuthPresenceResult> {
  await initParsers();
  const edges: UseEdge[] = [];
  const fileDefaultExports = new Map<string, string>();
  const fileImports = new Map<string, FileImports>();
  const routerVarsByFile = new Map<string, Set<string>>();
  const scanned: string[] = [];
  const tcIgnore = loadTcIgnore(rootDir);

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
      collectFromTree(tree, source, full, edges, fileDefaultExports, fileImports, routerVarsByFile);
    }
  };
  visit(rootDir);

  // Build the auth-protected propagation closure.
  const protectedRouterVars = new Set<string>(); // var-name granularity
  const protectedFiles = new Set<string>();

  // Round 1: any router var that has `.use(authFn)` is protected — and so
  // is its file (its routes are protected).
  for (const e of edges) {
    if (e.args.some((a) => AUTH_MIDDLEWARE_NAMES.has(a))) {
      protectedRouterVars.add(`${e.filePath}::${e.routerVar}`);
      protectedFiles.add(e.filePath);
    }
  }

  // Round 2: propagation. Iterate to fixed point — a protected router
  // mounted with another identifier propagates protection to whatever
  // file the identifier was imported from (default-imports).
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of edges) {
      const key = `${e.filePath}::${e.routerVar}`;
      if (!protectedRouterVars.has(key)) continue;

      const imports = fileImports.get(e.filePath);
      for (const arg of e.args) {
        if (AUTH_MIDDLEWARE_NAMES.has(arg)) continue;
        // Resolve the arg to an imported file via this file's import bindings.
        const importedFile = imports?.defaults.get(arg);
        if (!importedFile) continue;
        if (!protectedFiles.has(importedFile)) {
          protectedFiles.add(importedFile);
          changed = true;
        }
        // Mark the imported file's local router vars as protected so
        // transitive `<X>.use(<Y>)` chains continue propagating.
        const localVars = routerVarsByFile.get(importedFile);
        if (localVars) {
          for (const v of localVars) {
            const k = `${importedFile}::${v}`;
            if (!protectedRouterVars.has(k)) {
              protectedRouterVars.add(k);
              changed = true;
            }
          }
        }
      }
    }
  }

  // Python (FastAPI): a file is auth-protected when one of its routers is
  // declared with an auth dependency (`APIRouter(dependencies=[Depends(require_bearer)])`).
  await eachParsedSource(rootDir, (s) => {
    if (s.lang !== 'python') return;
    scanned.push(s.filePath);
    if (fastApiFileHasAuthRouter(s.source, s.tree)) protectedFiles.add(s.filePath);
  });

  return { protectedFiles, scannedFiles: scanned };
}

/**
 * Resolve an `import` source string ("./controllers/orders.controller")
 * to an absolute file path. Tries the literal path + common TS/JS
 * extensions. Returns null when nothing resolves.
 */
function resolveImportPath(importingFile: string, sourceStr: string): string | null {
  if (!sourceStr.startsWith('.')) return null; // skip absolute / package imports
  const baseRaw = path.resolve(path.dirname(importingFile), sourceStr);
  // Imports under TS/ESM convention often use `.js` to refer to a `.ts`
  // source. Try the literal path first, then replace .js with .ts/.tsx,
  // then bare-name with extensions, then index files.
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

// ---------------------------------------------------------------------------

function collectFromTree(
  tree: Tree,
  source: string,
  filePath: string,
  edges: UseEdge[],
  fileDefaultExports: Map<string, string>,
  fileImports: Map<string, FileImports>,
  routerVarsByFile: Map<string, Set<string>>,
): void {
  const routers = new Set<string>();
  routerVarsByFile.set(filePath, routers);

  const imports: FileImports = { defaults: new Map() };
  fileImports.set(filePath, imports);

  const visit = (node: SyntaxNode): void => {
    // Track router var declarations: `const router = express.Router()`
    // or any binding that we end up using as a base for `.use(...)`.
    if (node.type === 'lexical_declaration' || node.type === 'variable_declaration') {
      for (const decl of node.namedChildren) {
        if (decl.type !== 'variable_declarator') continue;
        const name = decl.childForFieldName('name');
        if (name?.type === 'identifier') {
          routers.add(slice(name, source));
        }
      }
    }

    // `import <name> from '<path>'` — default import binding.
    if (node.type === 'import_statement') {
      const importClause = node.namedChildren.find((c) => c.type === 'import_clause');
      const sourceNode = node.namedChildren.find((c) => c.type === 'string');
      if (importClause && sourceNode) {
        // Default import: import_clause's first named child of type identifier.
        const def = importClause.namedChildren.find((c) => c.type === 'identifier');
        const fragment = sourceNode.namedChildren.find((c) => c.type === 'string_fragment');
        if (def && fragment) {
          const importName = slice(def, source);
          const sourceStr = slice(fragment, source);
          const resolved = resolveImportPath(filePath, sourceStr);
          if (resolved) imports.defaults.set(importName, resolved);
        }
      }
    }

    // `export default <name>` — record the default export's identifier.
    if (node.type === 'export_statement') {
      const value = node.childForFieldName('value');
      if (value?.type === 'identifier') {
        fileDefaultExports.set(filePath, slice(value, source));
      }
    }

    // `<routerVar>.use(<args>...)` — record the use-edge.
    if (node.type === 'call_expression') {
      const fn = node.childForFieldName('function');
      if (fn?.type === 'member_expression') {
        const obj = fn.childForFieldName('object');
        const prop = fn.childForFieldName('property');
        if (obj?.type === 'identifier' && prop && slice(prop, source) === 'use') {
          const routerVar = slice(obj, source);
          const args = node.childForFieldName('arguments');
          const argNames: string[] = [];
          if (args) {
            for (const a of args.namedChildren) {
              if (a.type === 'identifier') argNames.push(slice(a, source));
            }
          }
          edges.push({ routerVar, args: argNames, filePath });
        }
      }
    }

    for (const child of node.namedChildren) visit(child);
  };

  visit(tree.rootNode);
}

function slice(node: SyntaxNode, source: string): string {
  return source.slice(node.startIndex, node.endIndex);
}
