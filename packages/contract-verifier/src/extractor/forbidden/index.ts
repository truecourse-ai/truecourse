/**
 * Code-side presence detectors for ForbiddenArtifact comparator.
 *
 * One function per category — each scans the code dir and returns a
 * list of matches. The comparator uses the matches to emit
 * `forbidden.${category}.${pattern}.present` drifts.
 *
 * Coverage is JS/TS only:
 *   - file-glob:    fs walk + minimatch
 *   - env-var:      tree-sitter scan of process.env.X / Deno.env.get / import.meta.env.X
 *   - dependency:   parse package.json deps trees
 *   - feature-flag: union of env-var detection + grep in JSON/YAML config files
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Node as SyntaxNode, Tree } from 'web-tree-sitter';
import { initParsers, parseFile } from '@truecourse/analyzer';
import { minimatch } from '../../comparator/minimatch.js';

export interface ForbiddenMatch {
  filePath: string;
  lineStart?: number;
  lineEnd?: number;
  /** Verbatim slice that matched. */
  snippet?: string;
}

const TS_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.cache', '.truecourse']);

// ---------------------------------------------------------------------------
// file-glob detector
// ---------------------------------------------------------------------------

/**
 * Find all files in `rootDir` whose repo-relative path matches the
 * minimatch pattern. Returns one ForbiddenMatch per matching file.
 */
export function detectForbiddenFiles(rootDir: string, pattern: string): ForbiddenMatch[] {
  const out: ForbiddenMatch[] = [];
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
      const rel = path.relative(rootDir, full);
      if (minimatch(rel, pattern)) {
        out.push({ filePath: full });
      }
    }
  };
  visit(rootDir);
  return out;
}

// ---------------------------------------------------------------------------
// env-var detector
// ---------------------------------------------------------------------------

/**
 * Find every read of `process.env.<NAME>`, `Deno.env.get('<NAME>')`,
 * or `import.meta.env.<NAME>` matching `name`. Returns matches with
 * file + line for drift display.
 */
export async function detectForbiddenEnvVar(rootDir: string, name: string): Promise<ForbiddenMatch[]> {
  await initParsers();
  const out: ForbiddenMatch[] = [];
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
      // Cheap pre-filter — skip parse if name not in source.
      if (!source.includes(name)) continue;
      const lang =
        ext === '.tsx' ? 'tsx' : ext === '.ts' ? 'typescript' : 'javascript';
      try {
        const tree = parseFile(full, source, lang);
        for (const match of findEnvVarReads(tree, name)) {
          out.push({
            filePath: full,
            lineStart: match.startPosition.row + 1,
            lineEnd: match.endPosition.row + 1,
            snippet: source.slice(match.startIndex, Math.min(match.endIndex, match.startIndex + 80)),
          });
        }
      } catch {
        // Parse failure non-fatal.
      }
    }
  };
  visit(rootDir);
  return out;
}

function findEnvVarReads(tree: Tree, name: string): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  walk(tree.rootNode, (node) => {
    if (matchProcessEnv(node, name) || matchImportMetaEnv(node, name) || matchDenoEnvGet(node, name)) {
      out.push(node);
      return false;
    }
    return true;
  });
  return out;
}

/** `process.env.NAME` — a member_expression chain. */
function matchProcessEnv(node: SyntaxNode, name: string): boolean {
  if (node.type !== 'member_expression') return false;
  const prop = node.childForFieldName('property')?.text;
  if (prop !== name) return false;
  const obj = node.childForFieldName('object');
  if (obj?.type !== 'member_expression') return false;
  return obj.childForFieldName('property')?.text === 'env'
    && obj.childForFieldName('object')?.text === 'process';
}

/** `import.meta.env.NAME` */
function matchImportMetaEnv(node: SyntaxNode, name: string): boolean {
  if (node.type !== 'member_expression') return false;
  const prop = node.childForFieldName('property')?.text;
  if (prop !== name) return false;
  const obj = node.childForFieldName('object');
  if (obj?.type !== 'member_expression') return false;
  if (obj.childForFieldName('property')?.text !== 'env') return false;
  const inner = obj.childForFieldName('object');
  // inner is `import.meta` — member_expression with property 'meta' on
  // an import identifier (tree-sitter sometimes represents `import` as
  // `import` keyword via a special node).
  return inner?.text === 'import.meta';
}

/** `Deno.env.get('NAME')` */
function matchDenoEnvGet(node: SyntaxNode, name: string): boolean {
  if (node.type !== 'call_expression') return false;
  const fn = node.childForFieldName('function');
  if (fn?.type !== 'member_expression') return false;
  if (fn.childForFieldName('property')?.text !== 'get') return false;
  const recv = fn.childForFieldName('object');
  if (recv?.type !== 'member_expression') return false;
  if (recv.childForFieldName('property')?.text !== 'env') return false;
  if (recv.childForFieldName('object')?.text !== 'Deno') return false;
  // Check that arg is the name we're looking for.
  const args = node.childForFieldName('arguments');
  if (!args) return false;
  for (let i = 0; i < args.namedChildCount; i++) {
    const arg = args.namedChild(i);
    if (arg?.type === 'string' && arg.text.slice(1, -1) === name) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// dependency detector
// ---------------------------------------------------------------------------

/**
 * Find every package.json (root + workspaces) and check whether
 * `name` appears in dependencies / devDependencies / peerDependencies.
 * Returns one match per package.json that declares it.
 */
export function detectForbiddenDependency(rootDir: string, name: string): ForbiddenMatch[] {
  const out: ForbiddenMatch[] = [];
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
      if (entry.name !== 'package.json') continue;
      let pkg: Record<string, unknown>;
      try {
        pkg = JSON.parse(fs.readFileSync(full, 'utf-8'));
      } catch {
        continue;
      }
      for (const key of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        const deps = pkg[key];
        if (deps && typeof deps === 'object' && name in (deps as Record<string, unknown>)) {
          out.push({
            filePath: full,
            snippet: `"${name}": ${JSON.stringify((deps as Record<string, string>)[name])}  (${key})`,
          });
        }
      }
    }
  };
  visit(rootDir);
  return out;
}

// ---------------------------------------------------------------------------
// feature-flag detector
// ---------------------------------------------------------------------------

/**
 * Feature flags are typically named env vars OR config keys. Strategy:
 * try the env-var detector first; if that finds nothing, fall back to
 * a textual scan of JSON/YAML/TS config files looking for the flag
 * name as a string literal.
 */
export async function detectForbiddenFeatureFlag(rootDir: string, name: string): Promise<ForbiddenMatch[]> {
  const envMatches = await detectForbiddenEnvVar(rootDir, name);
  if (envMatches.length > 0) return envMatches;
  return detectFlagInConfigFiles(rootDir, name);
}

function detectFlagInConfigFiles(rootDir: string, name: string): ForbiddenMatch[] {
  const out: ForbiddenMatch[] = [];
  const CONFIG_EXT = new Set(['.json', '.yaml', '.yml', '.toml', '.env']);
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
      const ext = path.extname(entry.name);
      if (!CONFIG_EXT.has(ext)) continue;
      let source: string;
      try {
        source = fs.readFileSync(full, 'utf-8');
      } catch {
        continue;
      }
      const lines = source.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(name)) {
          out.push({
            filePath: full,
            lineStart: i + 1,
            lineEnd: i + 1,
            snippet: lines[i].trim().slice(0, 120),
          });
        }
      }
    }
  };
  visit(rootDir);
  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function walk(node: SyntaxNode, visit: (n: SyntaxNode) => boolean | void): void {
  const recurse = visit(node);
  if (recurse === false) return;
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c) walk(c, visit);
  }
}
